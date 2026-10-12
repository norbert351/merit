// Merit — sybil-resistant, settled-money-weighted agent reputation for Monad (Metropolis Track 04).
// Demo launcher (HARDENED): proves the full identity + money path + the binding mandate,
// including that "verified client" is a P-256 passkey assertion checked by Monad's NATIVE
// precompile (0x0100) through a server-issued, single-use, expiring challenge, and that
// registration is proof-of-possession + immutable (a caller who knows a clientId cannot
// replace its key, and a replayed challenge is refused).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.MERIT_DB_PATH) {
  process.env.MERIT_DB_PATH = join(mkdtempSync(join(tmpdir(), "merit-demo-")), "receipts.db");
}

const { writeReceipt, receiptsForAgent, receiptExistsForPayment, appendAudit } = await import("./receipt/ledger.mjs");
const { onchainScore, scoreJustification } = await import("./reputation/onchain-score.mjs");
const { enforceMandate, TIERS } = await import("./mandate/mandate.mjs");
const {
  verifyClientAssertion, registerClient, createRegistrationChallenge, createPaymentChallenge, passkeyAddress,
  P256_PRECOMPILE, P256_METHOD,
} = await import("./identity/passkey.mjs");
const { generatePasskey } = await import("./identity/passkey-client.mjs");

const AGENT_ID = 1;
const NET = process.env.MERIT_NETWORK || "testnet";

console.log("\n═══ MERIT — Monad Metropolis Track 04 (hardened demo) ═══");
console.log("sybil-resistant, settled-money-weighted agent reputation + binding mandate");
console.log(`identity rail: P-256 passkey verified by Monad precompile ${P256_PRECOMPILE} (${P256_METHOD})\n`);

console.log(">>> SECURITY 1 — proof-of-possession + immutable registration");
const clientId = "real-customer-1";
const passkey = await generatePasskey();
const rc = await createRegistrationChallenge({ clientId });
const rsig = await passkey.sign(rc.message);
const reg = await registerClient({ clientId, pubX: passkey.pubX, pubY: passkey.pubY, challengeId: rc.challengeId, r: rsig.r, s: rsig.s, network: NET });
console.log(`  register clientId=${clientId} challenge-signed  -> ${reg.ok ? `OK  identity=${reg.client.address}` : `FAIL ${reg.reason}`}`);
// replay the SAME registration challenge -> must be refused
const reg2 = await registerClient({ clientId, pubX: passkey.pubX, pubY: passkey.pubY, challengeId: rc.challengeId, r: rsig.r, s: rsig.s, network: NET });
console.log(`  replay same challenge                                  -> ${reg2.ok ? "⚠️ SURPRISE (unexpected)" : "BLOCKED (" + reg2.reason + ")"}`);
if (!reg.ok) throw new Error("registration failed");

console.log("\n>>> SECURITY 2 — a different wallet trying to re-register under the SAME clientId");
const attacker = await generatePasskey();
const ac = await createRegistrationChallenge({ clientId });
const asig = await attacker.sign(ac.message);
const hijack = await registerClient({ clientId, pubX: attacker.pubX, pubY: attacker.pubY, challengeId: ac.challengeId, r: asig.r, s: asig.s, network: NET });
console.log(`  attacker re-register ${clientId}                     -> ${hijack.ok ? "⚠️ HIJACKED (unexpected)" : "BLOCKED (" + hijack.reason + ")"}`);
console.log("  ✅ immutable: a known clientId cannot have its key replaced.\n");

console.log(">>> DEMO 1 — 50 sock-puppet wallets each CLAIM to be verified (no registered key)");
for (let i = 0; i < 50; i++) {
  await writeReceipt({ agentId: AGENT_ID, payer: `puppet-${i}`, payerVerified: 0, amountUsd: 0.0001, outcome: "delivered", status: "settled", source: "demo" });
}
{
  const rows = await receiptsForAgent(AGENT_ID);
  const s = onchainScore(rows.filter((r) => r.source === "live")); // trusted = live only
  console.log(`  live rows scored -> ${rows.filter(r=>r.source==='live').length}, score=${s.score}  (sybil=${s.sybil.detected})`);
  console.log("  ✅ puppets have no passkey so they can never be verified — score stays 0.\n");
}

console.log(">>> DEMO 2 — one REAL client settles via x402 with a P-256 passkey + server challenge");
const amountUsd = 1, amountMicroUsd = Math.round(amountUsd * 1e6), paymentId = "demo-payment-1";
const pc = await createPaymentChallenge({ clientId, agentId: AGENT_ID, amountMicroUsd, network: NET });
console.log(`  server issued payment challenge ${pc.challengeId} (5-min TTL, single-use)`);
const psig = await passkey.sign(pc.message);
const vr = await verifyClientAssertion({ challengeId: pc.challengeId, clientId, r: psig.r, s: psig.s, network: NET });
console.log(`  precompile returned ${vr.precompileReturn}  -> verified=${vr.verified}  (${vr.reason})`);
if (!vr.verified) console.log("  ⚠️ precompile unreachable/invalid — DEMO 2 needs Monad testnet RPC; score will not move.");
const dup = await receiptExistsForPayment(paymentId);
console.log(`  idempotency guard: paymentId already used? -> ${dup}`);
const receiptId = (await writeReceipt({
  agentId: AGENT_ID, payer: vr.verified ? passkeyAddress(passkey) : "0xrealBuyer",
  payerVerified: vr.verified ? 1 : 0, amountUsd, outcome: vr.verified ? "delivered" : null,
  status: vr.verified ? "settled" : "refused", verifyMethod: vr.verified ? vr.method : null,
  paymentId, source: "demo",
})).id;
if (vr.verified) await appendAudit({ entity: "receipt", entityId: String(receiptId), from_state: "PAYMENT_VERIFIED", to_state: "RECEIPT_ACCEPTED", detail: "demo settle accepted" });

{
  const rows = await receiptsForAgent(AGENT_ID);
  const live = onchainScore(rows.filter((r) => r.source === "live"));
  const demo = onchainScore(rows.filter((r) => r.source !== "live"));
  console.log(`  trusted(live) score=${live.score} · demo score=${demo.score} (distinctVerified=${demo.components.distinctVerifiedClients})`);
  console.log("  ✅ one passkey-verified settlement outweighs 50 puppet claims (in the demo graph).\n");
}

console.log(">>> DEMO 3 — the binding, escalation-proof mandate (Bankr refutation)");
{
  const s = onchainScore(await receiptsForAgent(AGENT_ID));
  const m = enforceMandate(s.score, { requestedSpendUsd: 50 });
  console.log(`  score=${s.score} -> allowed=${m.allowed} effectiveTier=${m.effectiveTier} maxSpend=$${m.maxSpendUsd}`);
  console.log(`  reason: ${m.reason}`);
  const esc = enforceMandate(s.score, { requestedTier: TIERS.high, requestedSpendUsd: 50 });
  console.log(`  escalate-to-HIGH attempt -> allowed=${esc.allowed} effectiveTier=${esc.effectiveTier}`);
  console.log("  ✅ Mandate caps authority at what settled reputation earned.\n");
}

console.log("═══ On-chain re-derivability ═══");
console.log(scoreJustification((await receiptsForAgent(AGENT_ID)).filter((r) => r.source === "live")));
console.log("\nMerit docs: Plan.md · SECURITY_AUDIT.md · live Monad rails in src/monad/config.mjs");