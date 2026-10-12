// Merit API backend — the bridge the hire-then-settle UI talks to.
//
// Endpoints (all JSON, CORS-open so the static SPA can be hosted separately):
//   GET  /api/agents              -> every agent with LIVE score + mandate + receipt trail
//   GET  /api/agent/:id           -> one agent (same shape as a member of /api/agents)
//   GET  /api/score/:id           -> score + components + re-derivation string (stranger proof)
//   POST /api/mandate/enforce     -> { agentId, requestedTier?, requestedSpendUsd } -> verdict
//   POST /api/settle              -> { agentId, payer, amountUsd, signature? } -> settles a receipt
//   GET  /api/meta                -> chain config + honest capability flags (what's live vs demo)
//   GET  /health                  -> liveness
//
// HONESTY CONTRACT (from docs/rubric.md + public/design.md §7):
//   - Scores are computed by src/reputation/onchain-score.mjs over SETTLED ledger rows only.
//   - If a funded executor key + Monad RPC are present, settle() broadcasts a REAL on-chain
//     receipt tx to the deployed MeritReputation contract and only records on err===null.
//   - If not, the API reports mode:"demo" and the UI labels it plainly. It NEVER claims on-chain.

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { writeReceipt, reconcileReceipt, receiptsForAgent, receiptExistsForPayment, appendAudit, readChallenge } from "../receipt/ledger.mjs";
import { onchainScore, scoreJustification } from "../reputation/onchain-score.mjs";
import { enforceMandate, TIERS } from "../mandate/mandate.mjs";
import { MERIT_CONTRACTS_TESTNET } from "../monad/merit-contracts.mjs";
import { MONAD } from "../monad/config.mjs";
import { hasExecutor, settleOnChain } from "../monad/settle.mjs";
import {
  registerClient, verifyClientAssertion, createRegistrationChallenge, createPaymentChallenge, passkeyAddress,
  P256_PRECOMPILE, P256_METHOD,
} from "../identity/passkey.mjs";
import { PaymentVerifier } from "../payments/verify.mjs";
import { FacilitatorClient } from "../x402/facilitator.mjs";
import { publicClient } from "../monad/erc8004.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dir, "..", "..", "public");
const PORT = process.env.MERIT_API_PORT || process.env.PORT || 8130;

const MAX_BODY = 100_000; // bytes cap on any request body (bounded payload size)
const rateBuckets = new Map(); // simple per-IP sliding rate limit (in-memory; restarts reset it)
function rateLimit(key, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const b = rateBuckets.get(key);
  if (!b || now - b.t > windowMs) { rateBuckets.set(key, { count: 1, t: now }); return true; }
  b.count += 1;
  return b.count <= limit;
}

// The agent registry the API exposes. Mirrors public/app.js seedAgents() + the deployed
// Merit contracts' agentIds (1 = the live demo agent whose scoreOf(1) reads on-chain).
// `receipts` here are the DEMO ledger rows (honest: they are written to the receipt DB and
// scored by the same engine). On-chain reads override the score when a contract is reachable.
export const REGISTRY = [
  {
    id: 1, name: "Frax Data Oracle", area: "market data", uri: "ipfs://merit-live-demo",
    addr: MERIT_CONTRACTS_TESTNET.reputation, desc: "Streams real-time on-chain pricing for trading agents. Settled calls only.",
    seed: { puppets: 50, real: [
      { payer: "0xB8A9f1c0e2a7d4b6f8c1a2e3d4b5c6a7e8f90123", verify: true, amountUsd: 120 },
      { payer: "0xC3F2a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2", verify: true, amountUsd: 80 },
      { payer: "0xD31E9f8e7d6c5b4a39281706f5e4d3c2b1a09876", verify: true, amountUsd: 45 },
    ] },
  },
  {
    id: 2, name: "Vault Guard", area: "risk & policy", uri: "ipfs://merit-vault-guard",
    addr: "0x7A2e5c1b9d8f3e4a6b2c0d1e5f7a8b9c0d1e2f34", desc: "Audits execution intents against policy before any spend. Trust = money that got blocked.",
    seed: { puppets: 8, real: [
      { payer: "0xE551b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3", verify: true, amountUsd: 60 },
      { payer: "0xF0A42b3c4d5e6f708192a3b4c5d6e7f8091a2b3c", verify: true, amountUsd: 30 },
    ] },
  },
  {
    id: 3, name: "Rebalance Bot", area: "portfolio ops", uri: "ipfs://merit-rebalance-bot",
    addr: "0x4B8d1e2f3a4b5c6d7e8f9012345678abcdef0912", desc: "Rebalances under its bound mandate — can never spend past what it has earned.",
    seed: { puppets: 20, real: [
      { payer: "0x9C119a8b7c6d5e4f302132435465768798a0b1c2", verify: true, amountUsd: 15 },
    ] },
  },
  {
    id: 4, name: "comms-agent", area: "summaries", uri: "ipfs://merit-comms-agent",
    addr: "0xD01e3f4a5b6c7d8e9f0a1b2c3d4e5f60718293a4", desc: "A freshly-registered agent with no settled history. Score 0 until it closes real calls.",
    seed: { puppets: 0, real: [] },
  },
];

const agentById = (id) => REGISTRY.find((a) => String(a.id) === String(id));

/** Write the demo ledger rows for an agent if its ledger is empty (idempotent). */
export async function ensureSeeded(agentId) {
  const a = agentById(agentId);
  if (!a) return;
  const existing = await receiptsForAgent(a.id);
  if (existing.length) return;
  for (let i = 0; i < a.seed.puppets; i++) {
    await writeReceipt({
      agentId: a.id, payer: `pup-${a.id}-${i}`, payerVerified: false,
      amountUsd: 0.0001, outcome: "delivered", status: "settled",
      deliverableHash: `0xdemo-pup-${a.id}-${i}`,
      source: "seed", // seed rows are demo-only; they never reach the trusted (on-chain) score
    });
  }
  for (const r of a.seed.real) {
    await writeReceipt({
      agentId: a.id, payer: r.payer, payerVerified: true,
      amountUsd: r.amountUsd, outcome: "delivered", status: "settled",
      deliverableHash: `0xdemo-${a.id}-${r.payer.slice(2, 10)}`,
      txHash: `0xdemotx${a.id}${r.payer.slice(2, 10)}`,
      chainId: MONAD.testnet.chainId,
      verifyMethod: "seed-demo", // labeled: seeded demo history, not a live assertion
      source: "seed",
    });
  }
}

/** Live score/mandate for one agent: on-chain contract read first, ledger fallback. */
export async function agentView(a) {
  const all = await receiptsForAgent(a.id);
  const rows = all.filter((r) => r.status === "settled");
  // TRUSTED score derives ONLY from live on-chain receipts (source='live') OR the contract read.
  // Demo/seed rows (source='seed'/'demo') NEVER feed the trusted score — they are the labelled demo.
  const trusted = onchainScore(rows.filter((r) => r.source === "live"));
  const s = onchainScore(rows); // display score (ledger demo narrative when not live-on-chain)
  const m = mandateFor(s.score);
  const TIER_NAMES = ["none", "low", "medium", "high"];
  let source = "ledger-demo";
  let onchain = null;
  let onchainMandate = null;
  if (hasExecutor() && a.id === 1) {
    // Only agentId 1 is the deployed live agent; read the contract for the authoritative score.
    try {
      const { onchainScoreOf, onchainMandateOf } = await import("../monad/merit-contracts.mjs");
      onchain = await onchainScoreOf(a.id);
      onchainMandate = await onchainMandateOf(a.id);
      source = onchain ? "chain" : "ledger-demo";
    } catch { /* honest fallback to ledger */ }
  }
  const mandate = source === "chain" && onchainMandate
    ? { tier: TIER_NAMES.indexOf(onchainMandate.tier), maxSpendUsd: onchainMandate.maxSpendUsd, tierName: onchainMandate.tier }
    : { tier: m.tier, maxSpendUsd: m.max, tierName: TIER_NAMES[m.tier] };
  return {
    id: a.id, agentId: a.id, name: a.name, area: a.area, uri: a.uri, addr: a.addr, desc: a.desc,
    score: source === "chain" && onchain ? { scoreUsd: onchain.scoreUsd, ...onchain } : {
      scoreUsd: s.score,
      settledUsd: s.components.settledUsd,
      effectivelySettledUsd: s.components.effectivelySettledUsd,
      distinctVerifiedClients: s.components.distinctVerifiedClients,
      sybilDetected: s.sybil.detected,
    },
    trustedScore: source === "chain" && onchain ? onchain.scoreUsd : trusted.score,
    scoreSource: source, // 'chain' = trusted on-chain read · 'ledger-demo' = labelled demo
    sybil: s.sybil,
    mandate,
    source,
    rederive: scoreJustification(rows),
    receipts: rows.map((r) => ({
      id: r.id, payer: r.payer, verified: !!r.payerVerified, amountUsd: r.amountUsd,
      delivered: r.outcome === "delivered", hash: r.deliverableHash, txHash: r.txHash,
      status: r.status, verifyMethod: r.verifyMethod ?? null, source: r.source ?? "seed",
    })),
  };
}

function mandateFor(score) {
  const T = [
    { tier: 0, max: 0 }, { tier: 1, max: 10 }, { tier: 2, max: 100 }, { tier: 3, max: 1000 },
  ];
  let m = T[0];
  for (const row of T) if (score >= [0, 50, 500, 2500][row.tier]) m = row;
  return m;
}

function cors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,payment-signature,x-payment");
}
function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  let b = "";
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > MAX_BODY) throw Object.assign(new Error("request body too large"), { status: 413 });
    b += c;
  }
  try { return JSON.parse(b || "{}"); } catch { return {}; }
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); return res.end(); }

  try {
    if (p === "/health") return json(res, 200, { ok: true, mode: hasExecutor() ? "live" : "demo" });

    if (p === "/api/meta") {
      return json(res, 200, {
        ok: true,
        mode: hasExecutor() ? "live" : "demo",
        network: hasExecutor() ? "monad testnet" : "in-browser demo ledger",
        chainId: MONAD.testnet.chainId,
        contracts: MERIT_CONTRACTS_TESTNET,
        verifiedClientBonusUsd: 5,
        sybilStakeUsd: 0.5,
        tiers: TIERS,
        // The verified-client rail: a client proves identity with a P-256 passkey assertion
        // checked by Monad's native precompile. This is what a "distinct verified client" IS.
        p256: {
          spec: "EIP-7951",
          precompile: P256_PRECOMPILE,
          method: P256_METHOD,
          howItWorks: "client registers a P-256 passkey (pubX,pubY) -> signs the payment challenge -> server verifies via eth_call to 0x0100 -> only then payerVerified=true",
        },
      });
    }

    if (p === "/api/agents" && req.method === "GET") {
      for (const a of REGISTRY) await ensureSeeded(a.id);
      const agents = [];
      for (const a of REGISTRY) agents.push(await agentView(a));
      return json(res, 200, { ok: true, agents });
    }

    const mA = p.match(/^\/api\/agent\/(\d+)$/);
    if (mA && req.method === "GET") {
      await ensureSeeded(Number(mA[1]));
      const a = agentById(mA[1]);
      if (!a) return json(res, 404, { ok: false, error: "no such agent" });
      return json(res, 200, { ok: true, agent: await agentView(a) });
    }

    const mS = p.match(/^\/api\/score\/(\d+)$/);
    if (mS && req.method === "GET") {
      await ensureSeeded(Number(mS[1]));
      const a = agentById(mS[1]);
      if (!a) return json(res, 404, { ok: false, error: "no such agent" });
      const v = await agentView(a);
      return json(res, 200, { ok: true, agentId: v.id, score: v.score, mandate: v.mandate, rederive: v.rederive });
    }

    if (p === "/api/mandate/enforce" && req.method === "POST") {
      const b = await readBody(req);
      await ensureSeeded(b.agentId ?? 1);
      const a = agentById(b.agentId ?? 1) || REGISTRY[0];
      const v = await agentView(a);
      const verdict = enforceMandate(v.score.scoreUsd, {
        requestedTier: b.requestedTier, requestedSpendUsd: b.requestedSpendUsd ?? 0,
      });
      return json(res, 200, { ok: true, agentId: v.id, score: v.score.scoreUsd, ...verdict });
    }

    // --- Passkey registration: server-issued challenge -> proof-of-possession -> IMMUTABLE bind ---
    if (p === "/api/passkey/challenge" && req.method === "POST") {
      if (!rateLimit(`rk:${req.socket.remoteAddress}:challenge`, 20)) return json(res, 429, { ok: false, error: "rate limited" });
      const b = await readBody(req);
      if (!b.clientId) return json(res, 400, { ok: false, error: "clientId required" });
      const c = await createRegistrationChallenge({ clientId: String(b.clientId) });
      return json(res, 200, { ok: true, challengeId: c.challengeId, message: c.message, method: P256_METHOD, ttlSeconds: 300 });
    }

    if (p === "/api/passkey/register" && req.method === "POST") {
      if (!rateLimit(`rk:${req.socket.remoteAddress}:register`, 20)) return json(res, 429, { ok: false, error: "rate limited" });
      const b = await readBody(req);
      if (!b.clientId || !b.pubX || !b.pubY || !b.challengeId || !b.passkey?.r || !b.passkey?.s)
        return json(res, 400, { ok: false, error: "clientId, pubX, pubY, challengeId, passkey{r,s} required" });
      const r = await registerClient({
        clientId: String(b.clientId), pubX: b.pubX, pubY: b.pubY, challengeId: b.challengeId,
        r: b.passkey.r, s: b.passkey.s, network: process.env.MERIT_NETWORK || "testnet", label: b.label ?? null,
      });
      if (!r.ok) return json(res, r.reason && /already|immutable/.test(r.reason) ? 409 : 400, { ok: false, error: r.reason });
      return json(res, 200, { ok: true, client: r.client, method: P256_METHOD });
    }

    if ((p === "/api/settle" || p === "/tools/call") && req.method === "POST") {
      if (!rateLimit(`rk:${req.socket.remoteAddress}:settle`, 30)) return json(res, 429, { ok: false, error: "rate limited" });
      const b = await readBody(req);
      const sig = req.headers["payment-signature"] || req.headers["x-payment"] || b.signature || null;
      const agentId = Number(b.agentId ?? 1);
      const amountUsd = Number(b.amountUsd ?? 0);
      const amountMicroUsd = Math.round(amountUsd * 1e6);
      const network = process.env.MERIT_NETWORK || "testnet";
      const clientId = b.clientId ? String(b.clientId) : null;

      // No payment signature -> issue a server-side, bound, expiring, single-use challenge (never free).
      if (!sig) {
        const challenge = clientId
          ? await createPaymentChallenge({ clientId, agentId, amountMicroUsd, network })
          : null;
        const c = {
          x402Version: 2, scheme: "exact", network: `eip155:${MONAD.testnet.chainId}`,
          recipient: `merit-agent-${agentId}`, amountMicroUsd,
          verifiedClient: {
            method: P256_METHOD, precompile: P256_PRECOMPILE,
            register: "1) POST /api/passkey/challenge {clientId} -> 2) POST /api/passkey/register {clientId,pubX,pubY,challengeId,passkey:{r,s}}",
            challenge: challenge ? { challengeId: challenge.challengeId, message: challenge.message } : null,
            submit: "replay with PAYMENT-SIGNATURE header + body { challengeId, clientId, paymentId, passkey:{ r, s } }",
            note: "an unverified payer's money still settles — it just does not earn the verified-client floor",
          },
        };
        cors(res);
        res.writeHead(402, {
          "content-type": "application/json",
          "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(c)).toString("base64"),
          "WWW-Authenticate": 'Payment realm="merit"',
        });
        return res.end(JSON.stringify({ ok: false, error: "payment_required", challenge: c }));
      }

      if (!(amountUsd > 0)) return json(res, 400, { ok: false, error: "amountUsd must be > 0" });
      if (!clientId) return json(res, 400, { ok: false, error: "clientId required to settle" });

      // Binding: the settle params must match the issued challenge (agent, amount, network).
      const chal = b.challengeId ? await readChallenge(b.challengeId) : null;
      if (!chal) return json(res, 400, { ok: false, error: "challengeId required / not found" });
      if (chal.purpose !== "settle") return json(res, 400, { ok: false, error: "wrong challenge purpose" });
      if (chal.clientId !== clientId) return json(res, 400, { ok: false, error: "challenge bound to another clientId" });
      if (chal.agentId === null || Number(chal.agentId) !== agentId || Number(chal.amountMicroUsd) !== amountMicroUsd)
        return json(res, 400, { ok: false, error: "settle params do not match the issued challenge" });
      if (chal.network && chal.network !== network) return json(res, 400, { ok: false, error: "payment on a different network" });

      // --- VERIFIED-CLIENT GATE (consumes the challenge ONCE atomically — replay blocked) ----
      const vr = await verifyClientAssertion({ challengeId: b.challengeId, clientId, r: b.passkey?.r, s: b.passkey?.s, network });
      const verified = vr.verified, verifyMethod = verified ? vr.method : null, verifyNote = vr.reason;
      let payer = b.payer || "0xbuyer";
      if (verified && vr.pubkey) payer = passkeyAddress(vr.pubkey);

      // --- IDEMPOTENCY: exactly one trusted receipt per paymentId (fabricated duplicate blocked) ---
      const paymentId = String(b.paymentId || b.nonce || "").slice(0, 64);
      if (!paymentId) return json(res, 400, { ok: false, error: "paymentId required for idempotency" });
      if (await receiptExistsForPayment(paymentId)) {
        return json(res, 409, { ok: false, error: "paymentId already settled (replay blocked)", verified });
      }

      const liveMode = hasExecutor();
      const verifier = new PaymentVerifier({
        facilitator: new FacilitatorClient({ chainId: MONAD.testnet.chainId }),
        publicClient: publicClient(network), network,
      });

      // Paid state machine (fail closed). We do NOT trust a client-supplied signature/status.
      let state = liveMode ? "pending" : "settled";
      let outcome = null;
      let txHash = null, onChainOk = false, mode = liveMode ? "live" : "demo";
      let verifierOk = true, verifierReason = null;

      if (liveMode) {
        const v = await verifier.verifySignature({ payload: b.payload ?? null, signature: sig, chainId: MONAD.testnet.chainId });
        if (!v.verified) {
          verifierOk = false; verifierReason = v.reason; state = "refused";
        } else {
          const r = await settleOnChain({ agentId, payer, amountMicroUsd, verified, delivered: true });
          txHash = r.txHash; onChainOk = r.ok;
          if (!onChainOk) { verifierOk = false; verifierReason = r.reason || "settlement failed on-chain"; state = "refused"; }
          else { state = "settled"; outcome = "delivered"; }
        }
      } else {
        // honest demo mode: no executor key -> clearly-labelled demo receipt, never a trusted
        // on-chain score. The receipt still flows through the passkey + idempotency gates above.
        outcome = null; // demo receipts carry no delivery outcome in the trusted field
        txHash = null;
      }

      const pending = {
        agentId, payer, payerVerified: verified ? 1 : 0, amountUsd,
        deliverableHash: b.deliverableHash || `0x${Buffer.from(payer + amountUsd + Date.now()).toString("hex").slice(0, 64)}`,
        outcome, txHash, chainId: MONAD.testnet.chainId, status: state,
        verifyMethod, paymentId, source: liveMode ? "live" : "demo",
      };
      const receiptId = (await writeReceipt(pending)).id;
      await appendAudit({
        entity: "receipt", entityId: String(receiptId),
        from_state: liveMode ? "PAYMENT_SUBMITTED" : "demo_issued", to_state: state,
        detail: `${verifierOk ? "" : `verifier: ${verifierReason}; `}verified=${verified} mode=${mode} paymentId=${paymentId}`,
      });

      const a = agentById(agentId);
      const v = await agentView(a);
      return json(res, 200, {
        ok: true, mode, status: state, receiptId, txHash, agentId, amountUsd,
        verified, verifyMethod, verifyNote, paymentId,
        verifierOk, verifierReason,
        newScore: v.score.scoreUsd, newMandate: v.mandate,
      });
    }

    // Serve the static UI too, so `node src/api/server.mjs` is a single-process demo.
        // Landing at / (marketing) · product at /app (live ledger) — one design system, both pages.
        let file = p === "/" ? "/landing.html" : p;
        if (p === "/app" || p === "/app/") file = "/app.html";
        const full = join(PUBLIC, file.replace(/\.\./g, ""));
        if (existsSync(full) && !p.startsWith("/api")) {
      const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
      const ext = full.slice(full.lastIndexOf("."));
      res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
      return res.end(readFileSync(full));
    }

    return json(res, 404, { ok: false, error: "not found", path: p });
  } catch (e) {
    const code = Number.isInteger(e?.status) ? e.status : 500;
    return json(res, code, { ok: false, error: e.message });
  }
}

export function startApi(port = PORT) {
  const server = createServer((req, res) => handle(req, res));
  server.listen(port, () => console.log(`Merit API + UI on http://127.0.0.1:${server.address().port} (mode=${hasExecutor() ? "live" : "demo"}) · verified-client rail=${P256_METHOD}@${P256_PRECOMPILE}`));
  return server;
}

// Allow `node src/api/server.mjs` to run the server directly.
if (import.meta.url === `file://${process.argv[1]}`) startApi();
