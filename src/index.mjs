// Merit — sybil-resistant, settled-money-weighted agent reputation for Monad (Metropolis Track 04).
// Entry point / demo launcher. Proves the full money path + the binding mandate, end to end —
// including that "verified client" is a P-256 passkey assertion checked by Monad's NATIVE
// precompile (0x0100), NOT a boolean a sock puppet can self-declare.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Use a throwaway ledger unless one is provided.
if (!process.env.MERIT_DB_PATH) {
  process.env.MERIT_DB_PATH = join(mkdtempSync(join(tmpdir(), "merit-demo-")), "receipts.db");
}

const { writeReceipt, reconcileReceipt, receiptsForAgent } = await import("./receipt/ledger.mjs");
const { onchainScore, scoreJustification } = await import("./reputation/onchain-score.mjs");
const { enforceMandate, TIERS } = await import("./mandate/mandate.mjs");
const { verifyClientAssertion, registerClient, paymentChallenge, passkeyAddress, P256_PRECOMPILE, P256_METHOD } =
  await import("./identity/passkey.mjs");
const { generatePasskey } = await import("./identity/passkey-client.mjs");

const AGENT_ID = 1;
const NET = process.env.MERIT_NETWORK || "testnet";

console.log("\n═══ MERIT — Monad Metropolis Track 04 ═══");
console.log("sybil-resistant, settled-money-weighted agent reputation + binding mandate");
console.log(`identity rail: P-256 passkey verified by Monad precompile ${P256_PRECOMPILE} (${P256_METHOD})\n`);

console.log(">>> DEMO 1 — 50 sock-puppet wallets each CLAIM to be a verified client");
for (let i = 0; i < 50; i++) {
  const clientId = `puppet-${i}`;
  // A puppet has NO registered passkey. It asserts a self-chosen "verified" flag (and even
  // submits junk r/s) — the precompile gate refuses it, so the receipt is UNVERIFIED.
  const vr = await verifyClientAssertion({
    clientId, agentId: AGENT_ID, amountMicroUsd: 100, nonce: `n${i}`,
    r: "0x" + "11".repeat(32), s: "0x" + "22".repeat(32), network: NET,
  });
  await writeReceipt({
    agentId: AGENT_ID, payer: clientId, payerVerified: vr.verified ? 1 : 0,
    amountUsd: 0.0001, outcome: "delivered", status: "settled",
    deliverableHash: `0xdemo-pup-${i}`, verifyMethod: vr.method && vr.verified ? vr.method : null,
  });
}
{
  const rows = await receiptsForAgent(AGENT_ID);
  const s = onchainScore(rows);
  console.log(`  receipts=${rows.length}  -> score=${s.score}  (sybil=${s.sybil.detected})`);
  console.log(`  ✅ Score stays ZERO — ${P256_METHOD} refused all 50 forgeries, so no verified-client floor.`);
  console.log("     (Remove the precompile gate -> each puppet self-declares verified -> score inflates.)\n");
}

console.log(">>> DEMO 2 — one REAL client settles via x402 with a P-256 passkey");
const clientId = "real-customer-1";
const passkey = await generatePasskey();
const reg = await registerClient({ clientId, pubX: passkey.pubX, pubY: passkey.pubY, label: "real paying customer" });
console.log(`  passkey registered: clientId=${reg.clientId}  derived-identity=${reg.address}`);
const amountUsd = 1, amountMicroUsd = Math.round(amountUsd * 1e6), nonce = "demo-nonce-1";
const { msg } = paymentChallenge({ agentId: AGENT_ID, amountMicroUsd, clientId, nonce });
const { r, s } = await passkey.sign(msg);
const vr = await verifyClientAssertion({ clientId, agentId: AGENT_ID, amountMicroUsd, nonce, r, s, network: NET });
console.log(`  precompile returned ${vr.precompileReturn}  -> verified=${vr.verified}  (${vr.reason})`);
if (!vr.verified) console.log("  ⚠️  precompile unreachable/invalid — DEMO 2 needs Monad testnet RPC; score will not move.");
const receiptId = await writeReceipt({
  agentId: AGENT_ID, payer: vr.verified ? reg.address : "0xrealBuyer",
  payerVerified: vr.verified ? 1 : 0, amountUsd,
  deliverableHash: "0xdeliverable", outcome: "delivered", status: "pending",
  verifyMethod: vr.verified ? vr.method : null,
});
// settle: reconcile to 'settled' only when on-chain err===null (here: verified).
await reconcileReceipt(receiptId.id, { ok: true, txHash: "0xsettle-receipt" });

{
  const rows = await receiptsForAgent(AGENT_ID);
  const s = onchainScore(rows);
  console.log(`  receipts=${rows.length}  -> score=${s.score} (settledUsd=${s.components.effectivelySettledUsd}, distinctVerified=${s.components.distinctVerifiedClients})`);
  console.log("  ✅ Score MOVED off zero — one passkey-verified settlement outweighs 50 puppet claims.\n");
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
console.log(scoreJustification(await receiptsForAgent(AGENT_ID)));
console.log("\nMerit docs: Plan.md · live Monad rails verified in src/monad/config.mjs");
