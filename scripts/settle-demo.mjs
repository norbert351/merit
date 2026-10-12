// Merit — end-to-end "verified client" settlement over the LIVE HTTP product surface (HARDENED).
//
// Proves the paid path PAST the challenge (not just at it):
//   1. register a P-256 passkey (proof-of-possession via a server challenge)
//   2. request a server-issued payment challenge  POST /api/settle  -> HTTP 402 + challenge
//   3. sign the challenge message with the passkey
//   4. replay WITH challengeId + paymentId + assertion  -> settle + verified (precompile 0x0100)
//   5. read the score back                            GET /api/score/:id
// Then negative controls: replaying the challenge and a forged signature must both be refused.
//
//   BASE=http://127.0.0.1:8130 node scripts/settle-demo.mjs
import { generatePasskey } from "../src/identity/passkey-client.mjs";

const BASE = process.env.BASE || "http://127.0.0.1:8130";
const AGENT = Number(process.env.AGENT || 4);
const AMOUNT = Number(process.env.AMOUNT || 3);
const line = (s) => console.log(s);

async function postJson(p, body, headers = {}) {
  const r = await fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, headers: r.headers, json: j };
}

line(`\n═══ Merit verified-client settlement (hardened) — ${BASE} ═══\n`);

// 1) register a passkey with proof-of-possession via a server challenge
const pk = await generatePasskey();
const clientId = `client-${Date.now().toString(36)}`;
const regCh = await postJson("/api/passkey/challenge", { clientId });
const regSig = await pk.sign(regCh.json.message);
const reg = await postJson("/api/passkey/register", { clientId, pubX: pk.pubX, pubY: pk.pubY, challengeId: regCh.json.challengeId, passkey: regSig });
line(`1. register passkey       -> ${reg.status}  clientId=${clientId}  identity=${reg.json?.client?.address}`);
if (reg.json?.ok !== true) { line("❌ registration failed: " + (reg.json?.error || reg.json?.reason)); process.exit(1); }

// 2) request a server-issued payment challenge
const c = await postJson("/api/settle", { agentId: AGENT, amountUsd: AMOUNT, clientId });
line(`2. request challenge      -> ${c.status} ${c.json?.error}  PAYMENT-REQUIRED=${c.headers.get("payment-required") ? "present" : "MISSING"}`);
const { challengeId, message } = c.json?.challenge?.verifiedClient?.challenge || {};
line(`   sign this message      -> ${message}`);

// 3/4) sign the challenge + replay WITH challengeId + paymentId + assertion
const { r, s } = await pk.sign(message);
const paymentId = `e2e-${Date.now().toString(36)}`;
const settle = await postJson("/api/settle",
  { agentId: AGENT, amountUsd: AMOUNT, clientId, challengeId, paymentId, passkey: { r, s } },
  { "payment-signature": "0x" + "ab".repeat(32) });
line(`3. settle WITH passkey    -> ${settle.status}${settle.json?.status ? "  status=" + settle.json.status : ""}  verified=${settle.json?.verified}  method=${settle.json?.verifyMethod}`);
line(`   note: ${settle.json?.verifyNote}\n   newScore=${settle.json?.newScore}  mandate.tier=${settle.json?.newMandate?.tierName}`);

// 5a) replay the SAME challenge -> must be blocked (single-use)
const replay = await postJson("/api/settle",
  { agentId: AGENT, amountUsd: AMOUNT, clientId, challengeId, paymentId: "e2e-" + Date.now().toString(36) + "-b", passkey: { r, s } },
  { "payment-signature": "0x" + "ab".repeat(32) });
line(`4. replay same challenge  -> ${replay.status} ${replay.json?.error || replay.json?.verifyNote}`);

// 5b) duplicate paymentId -> must be blocked (idempotency)
const dupCh = await postJson("/api/settle", { agentId: AGENT, amountUsd: AMOUNT, clientId });
const dupSig = await pk.sign(dupCh.json?.challenge?.verifiedClient?.challenge?.message);
const dup = await postJson("/api/settle",
  { agentId: AGENT, amountUsd: AMOUNT, clientId, challengeId: dupCh.json?.challenge?.verifiedClient?.challenge?.challengeId, paymentId, passkey: dupSig },
  { "payment-signature": "0x" + "ab".repeat(32) });
line(`5. duplicate paymentId    -> ${dup.status} ${dup.json?.error || dup.json?.verifyNote}`);

// 5c) forged signature -> verified=false
const forgeCh = await postJson("/api/settle", { agentId: AGENT, amountUsd: AMOUNT, clientId });
const forgeSig = await pk.sign(forgeCh.json?.challenge?.verifiedClient?.challenge?.message);
const forged = await postJson("/api/settle",
  { agentId: AGENT, amountUsd: AMOUNT, clientId, challengeId: forgeCh.json?.challenge?.verifiedClient?.challenge?.challengeId, paymentId: "e2e-" + Date.now().toString(36) + "-f", passkey: { r, s: "0x" + forgeSig.s.slice(2, -2) + (forgeSig.s.slice(-2) === "ff" ? "00" : "ff") } },
  { "payment-signature": "0x" + "ab".repeat(32) });
line(`6. settle FORGED sig      -> ${forged.status}  verified=${forged.json?.verified}  (must be false)`);

const ok = settle.json?.verified === true && replay.json?.verifyNote && /used|expired/i.test(replay.json?.verifyNote || "") && dup.json?.error && /replay|already/i.test(dup.json?.error || "") && forged.json?.verified === false;
line(`\n${ok ? "✅ HARDENED PAID LOOP PROVEN" : "❌ loop failed"}: verified via 0x0100; forged refused; challenge replay + duplicate paymentId blocked.\n`);
process.exit(ok ? 0 : 1);