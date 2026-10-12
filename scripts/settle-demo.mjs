// Merit — end-to-end "verified client" settlement over the LIVE HTTP product surface.
//
// Proves the paid path PAST the challenge (not just at it):
//   1. generate a P-256 passkey, register it      POST /api/passkey/register
//   2. request the challenge (no signature)       POST /api/settle  -> HTTP 402 + PAYMENT-REQUIRED
//   3. sign the challenge message with the passkey
//   4. replay WITH the assertion                  -> settles + verified=true (precompile 0x0100)
//   5. read the score back                        GET  /api/score/:id
//
// Then a negative control: the SAME flow with a forged signature must settle as UNVERIFIED.
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

line(`\n═══ Merit verified-client settlement — ${BASE} ═══\n`);

// 1) register a passkey
const pk = await generatePasskey();
const clientId = `client-${Date.now().toString(36)}`;
const reg = await postJson("/api/passkey/register", { clientId, pubX: pk.pubX, pubY: pk.pubY, label: "e2e verified client" });
line(`1. register passkey     -> ${reg.status}  clientId=${clientId}  derived-identity=${reg.json?.client?.address}`);

// 2) challenge (no payment signature)
const c = await postJson("/api/settle", { agentId: AGENT, amountUsd: AMOUNT, clientId, nonce: "e2e-1" });
line(`2. request challenge    -> ${c.status} ${c.json?.error}   PAYMENT-REQUIRED=${c.headers.get("payment-required") ? "present" : "MISSING"}`);
const signMessage = c.json?.challenge?.verifiedClient?.signMessage;
line(`   sign this message    -> ${signMessage}`);

// 3) sign the challenge with the passkey
const { r, s } = await pk.sign(signMessage);

// 4) replay with the assertion
const settle = await postJson("/api/settle",
  { agentId: AGENT, amountUsd: AMOUNT, clientId, nonce: "e2e-1", passkey: { r, s } },
  { "payment-signature": "0x" + "ab".repeat(32) });
line(`3. settle WITH passkey  -> ${settle.status}  status=${settle.json?.status}  verified=${settle.json?.verified}  method=${settle.json?.verifyMethod}`);
line(`   note: ${settle.json?.verifyNote}`);
line(`   newScore=${settle.json?.newScore}  mandate.tier=${settle.json?.newMandate?.tierName}`);

// 5) negative control — forged signature, same client
const forged = { r, s: "0x" + s.slice(2, -2) + (s.slice(-2) === "ff" ? "00" : "ff") };
const bad = await postJson("/api/settle",
  { agentId: AGENT, amountUsd: AMOUNT, clientId, nonce: "e2e-2", passkey: forged },
  { "payment-signature": "0x" + "ab".repeat(32) });
line(`4. settle FORGED sig    -> ${bad.status}  verified=${bad.json?.verified}  (must be false)`);
line(`   note: ${bad.json?.verifyNote}`);

const ok = settle.json?.verified === true && bad.json?.verified === false;
line(`\n${ok ? "✅ PAID LOOP PROVEN" : "❌ loop failed"}: valid passkey verified via 0x0100; forged signature refused.\n`);
process.exit(ok ? 0 : 1);
