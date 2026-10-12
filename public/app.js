/* Merit hire-then-settle SPA (vanilla, no framework).
   - Tries a live backend (/api/*) for REAL on-chain reads first.
   - Falls back to an honest in-browser DEMO ledger (labeled "demo") that runs the SAME
     scoring + mandate code as src/reputation/onchain-score.mjs + src/mandate/mandate.mjs,
     so the mechanism is real even when a backend isn't attached. Never fabricates on-chain claims.
*/

/* eslint-disable no-unused-vars */
const $ = (s, r=document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtUsd = (n) => "$" + Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const short = (s) => s ? String(s).slice(0,6)+"…"+String(s).slice(-4) : "";

const BASE = (new URLSearchParams(location.search).get('base') || '').trim() || ''; // same-origin by default
const LIVE = {score:null, mandate:null, receipts:null, ok:false, mode:null};
const VERIFIED_BONUS = 5, SYBIL_STAKE_USD=0.5, SYBIL_MIN=4;
const TIERS=["none","low","medium","high"];
const MANDATE_TABLE=[{min:0,tier:0,max:0},{min:50,tier:1,max:10},{min:500,tier:2,max:100},{min:2500,tier:3,max:1000}];

/* ---- core Merit logic (mirrors onchain-score.mjs + mandate.mjs) ---- */
function detectSybil(rows){ const n=rows.filter(r=>!r.verified && (r.amountUsd||0)<SYBIL_STAKE_USD).length; return {detected:n>=SYBIL_MIN, clusterSize:n}; }
function scoreAgent(rows){
  const sybil=detectSybil(rows); let eff=rows;
  if(sybil.detected){ const cl=new Set(rows.filter(r=>!r.verified && r.amountUsd<SYBIL_STAKE_USD).map(r=>r.payer)); eff=rows.filter(r=>!cl.has(r.payer)); }
  const settled=rows.filter(r=>r.delivered).reduce((s,r)=>s+(r.amountUsd||0),0);
  const effSettled=eff.filter(r=>r.delivered).reduce((s,r)=>s+(r.amountUsd||0),0);
  const dv=new Set(eff.filter(r=>r.verified&&r.delivered).map(r=>r.payer)).size;
  return {score:effSettled+dv*VERIFIED_BONUS, settledUsd:settled, effectivelySettledUsd:effSettled, distinctVerifiedClients:dv, sybil};
}
function mandateFor(score){ let m=MANDATE_TABLE[0]; for(const row of MANDATE_TABLE) if(score>=row.min) m=row; return m; }
function enforceMandate(score,{requestedTier,requestedSpendUsd}){
  const m=mandateFor(score); const reqTier=requestedTier??m.tier; const eff=Math.min(reqTier,m.tier);
  const allowed=requestedSpendUsd<=m.max;
  return {allowed,effectiveTier:eff,maxSpendUsd:m.max,reason: allowed?"mandate satisfied":`spend $${requestedSpendUsd} exceeds mandate max $${m.max} (score ${score})`};
}

/* ---- seeded agents (the demo ledger; honest "demo" label, not on-chain claim) ---- */
function seedAgents(){
  const mk=(i,puppets,real)=>Array.from({length:puppets},(_,j)=>({payer:`pup-${i}-${j}`,verified:false,amountUsd:0.0001,delivered:true})).concat(real);
  return [
    {id:1,name:"Frax Data Oracle",area:"market data",uri:"ipfs://merit-live-demo",addr:"0xda8f…7B51",desc:"Streams real-time on-chain pricing for trading agents. Settled calls only.",
      receipts:mk(1,50,[{payer:"0xB8A9",verified:true,amountUsd:120,delivered:true},{payer:"0xC3F2",verified:true,amountUsd:80,delivered:true},{payer:"0xD31E",verified:true,amountUsd:45,delivered:true}])},
    {id:2,name:"Vault Guard",area:"risk & policy",addr:"0x7A2e…91c",desc:"Audits execution intents against policy before any spend. Trust = money that got blocked.",
      receipts:mk(2,8,[{payer:"0xE551",verified:true,amountUsd:60,delivered:true},{payer:"0xF0A4",verified:true,amountUsd:30,delivered:true}])},
    {id:3,name:"Rebalance Bot",area:"portfolio ops",addr:"0x4B8d…a02",desc:"Rebalances under its bound mandate — can never spend past what it has earned.",
      receipts:mk(3,20,[{payer:"0x9C11",verified:true,amountUsd:15,delivered:true}])},
    {id:4,name:"comms-agent",area:"summaries",addr:"0xD01e…b3f",desc:"A freshly-registered agent with no settled history. Score 0 until it closes real calls.",
      receipts:[]},
  ];
}

/* ---- state ---- */
let AGENTS = seedAgents();
let liveAgentMap = {};

async function loadLive(){
  // Try the API at the resolved base (defaults to same-origin, where src/api/server.mjs serves both
  // the UI and /api/*). Honest fallback: keep the in-browser demo ledger, labeled.
  const base = BASE || location.origin;
  try{
    const meta = await fetch(`${base}/api/meta`,{signal:AbortSignal.timeout(6000)});
    if(meta.ok){ const m=await meta.json(); LIVE.mode=m.mode||null; }
    const r=await fetch(`${base}/api/agents`,{signal:AbortSignal.timeout(6000)});
    if(!r.ok) throw new Error("http "+r.status);
    const data=await r.json();
    if(!data||!data.ok) throw new Error("not ok");
    LIVE.ok=true;
    (data.agents||[]).forEach(a=>{
      const score=(a.score&&a.score.scoreUsd)??0;
      const m=(a.mandate&&(a.mandate.tier))??TIERS[mandateFor(score).tier];
      liveAgentMap[a.id || a.agentId]=a;
      const target=AGENTS.find(x=>String(x.id)===String(a.id||a.agentId));
      if(target){
        target.receipts=(a.receipts||[]).map(r=>({payer:r.payer,verified:r.verified,amountUsd:r.amountUsd,delivered:r.delivered,hash:r.hash||r.txHash}));
        target._live=true;
        target._score=score;
        target._settled=(a.score&&a.score.settledUsd)??0;
        target._effSettled=(a.score&&a.score.effectivelySettledUsd)??0;
        target._dv=(a.score&&a.score.distinctVerifiedClients)??0;
        target._sybil=!!(a.score&&a.score.sybilDetected)||!!(a.sybil&&a.sybil.detected);
        target._sybilCluster=(a.sybil&&a.sybil.clusterSize)??0;
        target._mandate=a.mandate;
      }
    });
    updateLiveBadges();
  }catch(e){ LIVE.ok=false; /* keep seeded demo, labeled */ }
}

function updateLiveBadges(){
  // Reflect the REAL mode in the chrome: live on-chain vs honest demo. Never claim on-chain in demo.
  const lp=document.querySelector(".live-pill"); const pl=document.querySelector(".panel-label");
  if(LIVE.ok && LIVE.mode==="live"){ if(lp) lp.innerHTML='<span class="pulse-dot"></span> live · on-chain'; }
  else if(LIVE.ok){ if(lp) lp.innerHTML='<span class="pulse-dot"></span> demo ledger'; if(pl) pl.textContent="REPUTATION LEDGER · demo (no executor key)"; }
  else { if(lp) lp.innerHTML='<span class="pulse-dot"></span> in-browser demo'; if(pl) pl.textContent="REPUTATION LEDGER · in-browser demo"; }
}

async function init(){
  await loadLive();
  bindGlobal();
  route();
  if(!LIVE.ok) console.info("Merit: no live backend attached — running honest in-browser demo ledger.");
}

/* ---- router ---- */
function route(){
  const h=location.hash||"#/hire";
  const app=$("#app");
  if(h.startsWith("#/how")){ app.innerHTML=$("#t-how").innerHTML; wireHow(app); }
  else if(h.startsWith("#/agent")){ renderDetail(app, h.split("/")[2]); }
  else { app.innerHTML=$("#t-browse").innerHTML; renderBrowse(app); }
  updateLiveBadges(); // re-apply the honest live/demo badge AFTER the template renders
  updateNav();
  window.scrollTo(0,0);
}

function updateNav(){
  const h=location.hash||"#/hire";
  document.querySelectorAll('[data-nav]').forEach(a=>a.classList.toggle("active", a.getAttribute("href")==="#/hire"?h.startsWith("#/hire")||h.startsWith("#/agent"):a.getAttribute("href")===h));
}

/* ---- browse ---- */
function renderBrowse(app){
  const grid=$("#agentGrid",app); grid.innerHTML="";
  const sorted=[...AGENTS].sort((a,b)=>scoreOfAgent(b).score-scoreOfAgent(a).score);
  sorted.forEach(a=>{ grid.appendChild(agentCard(a)); });
  renderHeroLedger(app);
}

function ringMarkup(score){
  const max=Math.min(score, 5000); const pct=Math.max(0,Math.min(1,max/5000));
  const C=2*Math.PI*23; const off=C*(1-pct);
  const tier=TIERS[mandateFor(score).tier];
  return `<div class="ring"><svg><circle class="bg" cx="26" cy="26" r="23" fill="none" stroke-width="4"/><circle class="fg" cx="26" cy="26" r="23" fill="none" stroke-width="4" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-offset="${C}" data-target="${off}"/></svg><span class="ring-num">${score.toLocaleString()}</span></div>`;
}
function afterPaintAnimate(cont){ cont.querySelectorAll(".ring .fg").forEach(c=>{ requestAnimationFrame(()=>c.setAttribute("stroke-dashoffset", c.dataset.target)); }); }

/* Prefer the LIVE API score when present (agent 1 reads the deployed contract directly);
   otherwise recompute from the local receipts with the same engine. Keeps cards honest. */
function scoreOfAgent(a){
  if(a._live && a._score!=null){
    return {score:a._score, settledUsd:a._settled??0, effectivelySettledUsd:a._effSettled??a._settled??0,
      distinctVerifiedClients:a._dv??0, sybil:{detected:!!a._sybil, clusterSize:a._sybilCluster??0}};
  }
  return scoreAgent(a.receipts);
}

function agentCard(a){
  const s=scoreOfAgent(a);
  const tier=s.sybil.detected?"sybil":(s.score>0?"safe":"safe");
  const liveTag = a._live ? (LIVE.mode==="live" ? "live · on-chain" : "live · demo ledger") : "";
  const label=s.sybil.detected?`${s.sybil.clusterSize} unverified dust payers suppressed (score ${s.score})`:(a._live?liveTag:AGENTS.length?s.score>0?`${s.distinctVerifiedClients} verified buyer${s.distinctVerifiedClients===1?"":"s"} · ${fmtUsd(s.effectivelySettledUsd)} settled`:"0 settled calls — score 0": "0 settled");
  const card=document.createElement("a");
  card.className="agent-card"; card.href=`#/agent/${a.id}`;
  card.innerHTML=`
    <div class="agent-top">
      <div class="agent-avatar">${esc(a.name[0])}</div>
      <div><div class="agent-name">${esc(a.name)}</div>
        <div class="agent-meta"><span class="chip safe">${esc(a.area)}</span>${a._live?`<span class="chip v">${LIVE.mode==="live"?"live":"demo"}</span>`:''}</div>
      </div>
    </div>
    <div class="agent-band ${tier}"><svg><use href="#i-shield"/></svg><span>${esc(label)}</span></div>
    <div class="cred">${ringMarkup(s.score)}
      <div class="cred-stats">
        <div><b>${s.distinctVerifiedClients}</b>verified</div>
        <div><b>${fmtUsd(s.effectivelySettledUsd)}</b>settled</div>
        <div><b>${TIERS[mandateFor(s.score).tier]}</b>mandate</div>
      </div>
    </div>
    <div class="hero-cta" style="margin-top:4px"><span class="link">Hire &amp; settle →</span></div>`;
  card.addEventListener("click",()=>{}); // anchor nav handles hash
  return card;
}

function renderHeroLedger(app){
  const led=$("#heroLedger",app); if(!led) return;
  const s=scoreOfAgent(AGENTS[0]);
  led.innerHTML="";
  const top=[...AGENTS].sort((a,b)=>scoreOfAgent(b).score-scoreOfAgent(a).score).slice(0,4);
  top.forEach(a=>{
    const ss=scoreOfAgent(a);
    led.appendChild(el("div",{class:"led-row"},
      el("span",{class:"who"},esc(a.name)),
      el("span",{class:"chip "+(ss.sybil.detected?"u":"v")},ss.sybil.detected?"sybil":"verified"),
      el("span",{class:"amt"},fmtUsd(ss.effectivelySettledUsd)),
      el("span",{class:"hash"},esc(a.addr))
    ));
  });
  afterPaintAnimate(led);
}

/* DOM helpers */
function el(tag,attrs,...kids){const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs||{})){if(k==="class")e.className=v;else e.setAttribute(k,v);}kids.filter(Boolean).forEach(k=>e.appendChild(typeof k==="string"?document.createTextNode(k):k));return e;}
// Like el() but allows a trusted inline-HTML string (chips) as a child — used for the detail header.
function elh(tag,attrs,...kids){const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs||{})){if(k==="class")e.className=v;else e.setAttribute(k,v);}kids.filter(Boolean).forEach(k=>{if(k&&k.__html!=null){const t=document.createElement("template");t.innerHTML=k.__html;e.appendChild(t.content.firstChild);}else e.appendChild(typeof k==="string"?document.createTextNode(k):k);});return e;}
const html=(s)=>({__html:s});

/* ---- detail ---- */
function renderDetail(app,id){
  const a=AGENTS.find(x=>String(x.id)===String(id))||AGENTS[0];
  app.innerHTML=$("#t-detail").innerHTML;
  const s=scoreOfAgent(a); const m=mandateFor(s.score);
  $("#detHead",app).appendChild(el("div",{class:"det-head"},
    el("div",{class:"agent-avatar"},esc(a.name[0])),
    el("div",null,
      elh("div",{class:"agent-name"},esc(a.name),(a._live?html(`<span class='chip v'>${LIVE.mode==="live"?"live":"demo"}</span>`):"")),
      el("div",{class:"agent-meta"},
        el("span",{class:"chip safe"},esc(a.area)),
        el("span",{class:"chip v"},"score "+s.score+" · "+fmtUsd(s.effectivelySettledUsd)+" settled")
      )
    )
  ));
  $("#recHint",app).textContent = a._live ? (LIVE.mode==="live" ? "live on-chain ledger" : "live ledger (demo mode — no executor key)") : "in-browser demo ledger (honest)";
  renderLedger($("#detLedger",app), a.receipts, LIVE.ok && a._live);
  // clip the long receipt trail to an internal scroll so a 50-row ledger doesn't run the page
  const dl=$("#detLedger",app); if(dl && dl.children.length>8){ dl.classList.add("ledger-slice"); }
  $("#ensureSettle",app);
  renderMandate($("#mandateMeter",app), s.score);
  $("#settleBtn",app).addEventListener("click",()=>doSettle(app,a,s));
  $("#settleAmt",app).value="5";
  wireProof(app,a,s);
}

function renderLedger(cont,rows,live){
  cont.innerHTML="";
  if(!rows||!rows.length){ cont.appendChild(el("div",{class:"led-row ledger-empty"},live?"No settled receipts yet":"No settled receipts — this agent scores 0 until a real call settles.")); return; }
  const sorted=[...rows].slice().reverse();
  sorted.forEach(r=>{
    cont.appendChild(el("div",{class:"led-row"},
      el("span",{class:"who"},esc(r.payer)),
      el("span",{class:"chip "+(r.verified?"v":"u")}, r.verified ? (r.verifyMethod==="p256-precompile-0x0100" ? "verified · P256" : "verified") : "unverified"),
      el("span",{class:"amt"},fmtUsd(r.amountUsd)),
      el("span",{class:"hash"},esc(r.hash||"receipt-"+short(String(r.payer))))
    ));
  });
}

function renderMandate(cont,score){
  const m=mandateFor(score); const tierIdx=m.tier; const pct=(tierIdx/3)*100;
  cont.innerHTML=`
    <div class="meter-label"><span>Earned tier</span><b class="mono">${TIERS[tierIdx].toUpperCase()} · max $${m.max}</b></div>
    <div class="meter-track"><div class="meter-fill" style="width:0" data-w="${pct}"></div></div>
    <div class="meter-ticks">${TIERS.map((t,i)=>`<span class="${i<=tierIdx?'on':''}">${t==="medium"?"med":t==="none"?"non":t.slice(0,3)}</span>`).join("")}</div>
    <p style="font-size:12.5px;color:var(--muted);margin-top:10px">Score ${score} → earned ${TIERS[tierIdx]} tier. The agent can only hold/act up to this mandate.</p>`;
  requestAnimationFrame(()=>{const f=cont.querySelector(".meter-fill"); if(f) f.style.width=f.dataset.w+"%";});
}

function wireProof(app,a,s){
  app.querySelectorAll('[data-action="copy-proof"]').forEach(b=>b.addEventListener("click",()=>{
    const line=["# Merit score is recomputable from the settled receipt graph","score = effectivelySettledUsd + distinctVerifiedClients × 5",`# ${esc(a.name)}: score ${s.score}, settled ${fmtUsd(s.effectivelySettledUsd)}, ${s.distinctVerifiedClients} verified, sybil ${s.sybil.detected}`].join("\n");
    navigator.clipboard?.writeText(line);
    toast("Proof command copied");
  }));
  const ea=app.querySelector('[data-action="try-escalate"]');
  if(ea) ea.addEventListener("click",()=>{
    const cur=scoreOfAgent(a); // fresh — reflects the live on-chain score when attached
    const mb=mandateFor(cur.score);
    const res=enforceMandate(cur.score,{requestedTier:3,requestedSpendUsd:Math.max(20, mb.max*2)});
    const box=$("#escStatus",app); box.hidden=false; const blocked=!res.allowed;
    box.className="esc-status "+(blocked?"blocked":"allowed");
    box.innerHTML=`Escalate to HIGH + spend $${res.maxSpendUsd*2}? → <b>${res.allowed?"ALLOWED":"BLOCKED"}</b>. Effective tier stayed <b>${TIERS[res.effectiveTier].toUpperCase()}</b>. ${esc(res.reason)}`;
  });
}

/* ---- browser passkey (P-256 via WebCrypto) — the client half of the verified-client rail.
   A real deployment swaps this for navigator.credentials (WebAuthn); the crypto is identical:
   an ECDSA P-256 key signs the exact x402 challenge, verified server-side by the 0x0100 precompile. */
function bytesToHex(buf){ return "0x"+[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join(""); }
async function getPasskey(){
  const KEY="merit.passkey.v1"; let s=null;
  try{ s=JSON.parse(localStorage.getItem(KEY)||"null"); }catch{ s=null; }
  if(!s){
    const kp=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
    const raw=new Uint8Array(await crypto.subtle.exportKey("raw",kp.publicKey));
    const priv=await crypto.subtle.exportKey("jwk",kp.privateKey);
    s={ clientId:"browser-"+Math.random().toString(36).slice(2,8), pubX:bytesToHex(raw.slice(1,33)), pubY:bytesToHex(raw.slice(33,65)), priv };
    localStorage.setItem(KEY, JSON.stringify(s));
  }
  const key=await crypto.subtle.importKey("jwk", s.priv, {name:"ECDSA",namedCurve:"P-256"}, false, ["sign"]);
  return { clientId:s.clientId, pubX:s.pubX, pubY:s.pubY, async sign(msg){
    const sig=new Uint8Array(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"}, key, new TextEncoder().encode(msg)));
    return { r:bytesToHex(sig.slice(0,32)), s:bytesToHex(sig.slice(32,64)) };
  }};
}

function doSettle(app,a,s){
  const btn=$("#settleBtn",app); const st=$("#payStatus",app);
  const amt=parseFloat($("#settleAmt",app).value||"5");
  if(amt<=0){ flash(st,"err","Enter an amount above $0."); return; }
  btn.disabled=true; st.hidden=false;
  flash(st,"err","Requesting x402 challenge…");
  setTimeout(async ()=>{
    try{
      const base = BASE || location.origin;
      if(LIVE.ok){
        // 1) the client's passkey identity (P-256, persisted this session)
        const pk=await getPasskey();
        await fetch(`${base}/api/passkey/register`,{method:"POST",headers:{"content-type":"application/json"},
          body:JSON.stringify({clientId:pk.clientId,pubX:pk.pubX,pubY:pk.pubY,label:"browser passkey"})});
        const nonce="ui-"+Date.now().toString(36);
        // 2) unsigned call -> real HTTP 402 challenge (names the passkey rail + what to sign)
        const challenge=await fetch(`${base}/api/settle`,{method:"POST",headers:{"content-type":"application/json"},
          body:JSON.stringify({agentId:a.id,amountUsd:amt,clientId:pk.clientId,nonce})});
        if(challenge.status===402){
          const cj=await challenge.json().catch(()=>({}));
          const msg=cj.challenge?.verifiedClient?.signMessage;
          flash(st,"err","Passkey signing → verifying via Monad precompile 0x0100…");
          const sig = msg ? await pk.sign(msg) : {r:null,s:null};
          // 3) replay with the passkey assertion -> settle + verified-client determination
          const r=await fetch(`${base}/api/settle`,{method:"POST",headers:{"content-type":"application/json","payment-signature":"ui-sig"},
            body:JSON.stringify({agentId:a.id,amountUsd:amt,clientId:pk.clientId,nonce,passkey:sig})});
          const j=await r.json();
          if(j.ok){
            const live = j.mode==="live" ? `Settled on-chain: ${j.txHash}` : `Settled (demo ledger): ${j.txHash}`;
            const vtag = j.verified ? `✅ passkey-verified (${j.verifyMethod})` : "⚠️ UNVERIFIED (no valid passkey)";
            flash(st,"ok",`${live}<br>${vtag}<br>score ${s.score} → ${j.newScore}`);
            LIVE.mode=j.mode;
            await refreshAgent(a, base);
          } else flash(st,"err","Settle failed: "+(j.error||j.reason||"unknown"));
        } else {
          const j=await challenge.json().catch(()=>({}));
          flash(st,"err","Unexpected response: "+(j.error||challenge.status));
        }
      } else {
        // No backend attached: cannot reach the precompile, so we DO NOT claim verification.
        a.receipts.push({payer:"0xbuyer",verified:false,amountUsd:amt,delivered:true,hash:"demo-receipt"});
        flash(st,"ok",`(in-browser demo) x402 settled ${fmtUsd(amt)} → receipt stamped on ledger. Score: ${s.score} → ${scoreAgent(a.receipts).score}. Start the API (npm run api) to verify a passkey via the 0x0100 precompile.`);
      }
      renderLedger($("#detLedger",app), a.receipts, LIVE.ok && a._live);
      renderMandate($("#mandateMeter",app), scoreOfAgent(a).score);
    }catch(e){ flash(st,"err","Settle failed: "+e.message); }
    btn.disabled=false;
  },400);
}
function flash(el,kind,msg){ el.className="pay-status "+kind; el.innerHTML=esc(msg); }

/* Re-read a single agent's authoritative state from the API and fold it into the local model. */
async function refreshAgent(a, base){
  try{
    const r=await fetch(`${base}/api/agent/${a.id}`,{signal:AbortSignal.timeout(6000)});
    if(!r.ok) return;
    const j=await r.json(); const A=j.agent; if(!A) return;
    a.receipts=(A.receipts||[]).map(x=>({payer:x.payer,verified:x.verified,amountUsd:x.amountUsd,delivered:x.delivered,hash:x.hash||x.txHash,verifyMethod:x.verifyMethod}));
    a._live=true;
    a._score=(A.score&&A.score.scoreUsd)??a._score;
    a._settled=(A.score&&A.score.settledUsd)??0;
    a._effSettled=(A.score&&A.score.effectivelySettledUsd)??0;
    a._dv=(A.score&&A.score.distinctVerifiedClients)??0;
    a._sybil=!!(A.score&&A.score.sybilDetected);
    a._sybilCluster=(A.sybil&&A.sybil.clusterSize)??0;
    a._mandate=A.mandate;
    if(A.source) LIVE.mode = A.source==="chain" ? "live" : LIVE.mode;
  }catch(e){ /* keep last-known state */ }
}

function toast(msg){ const t=document.createElement("div"); t.style.cssText="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;padding:11px 18px;border-radius:99px;font-size:13.5px;z-index:200;box-shadow:0 10px 30px rgba(0,0,0,.3)"; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),2200); }

function wireHow(app){ app.querySelectorAll('[data-action="copy-proof"]').forEach(b=>b.addEventListener("click",()=>{navigator.clipboard?.writeText("score = settled$ + verifiedBuyers × 5\nnpm test · npm start\nmerit contracts on Monad testnet"); toast("Command copied");})); }

/* ---- global chrome ---- */
function bindGlobal(){
  // connect-wallet modal
  const veil=$("#walletVeil"), wb=$("#walletBtn");
  wb.addEventListener("click",()=>{veil.hidden=false; veil.classList.add("show");});
  $("#modalX").addEventListener("click",()=>{veil.hidden=true;});
  veil.addEventListener("click",e=>{ if(e.target===veil) veil.hidden=true; });
  $("#walletConnectBtn").addEventListener("click",()=>{
    if(window.ethereum?.request){
      window.ethereum.request({method:"eth_requestAccounts"}).then(acc=>{
        const a=acc&&acc[0]; $("#walletLabel").textContent=short(a); wb.classList.add("signed"); veil.hidden=true; toast("Wallet connected");
      }).catch(()=>toast("Connect cancelled"));
    } else {
      $("#walletLabel").textContent="explore"; wb.classList.add("signed"); veil.hidden=true; toast("Read-only explore mode (no wallet present)");
    }
  });
  $("#modalSignIn").addEventListener("click",()=>{ const h=$("#modalHandle").value||"explorer"; $("#walletLabel").textContent=h; wb.classList.add("signed"); veil.hidden=true; toast("Signed in as "+h); });
  // burger
  const bur=$("#burger"), nl=$("#navLinks");
  bur.addEventListener("click",()=>{ bur.classList.toggle("open"); nl.classList.toggle("open"); });
  document.addEventListener("click",e=>{ if(bur.classList.contains("open")&&!e.target.closest(".topbar")){bur.classList.remove("open");nl.classList.remove("open");} });
  // delegate scroll-hire
  document.addEventListener("click",e=>{ const b=e.target.closest('[data-action="scroll-hire"]'); if(b){ const s=$("#browseSec"); if(s) s.scrollIntoView({behavior:"smooth"}); } });
  window.addEventListener("hashchange",route);
}

document.addEventListener("DOMContentLoaded", init);