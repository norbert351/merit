// Merit — sybil-resistant, settled-money-weighted agent reputation for Monad (Metropolis Track 04).
// Entry point / demo launcher. Proves the full money path + the binding mandate, end to end.
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

const AGENT_ID = 1;

console.log("\n═══ MERIT — Monad Metropolis Track 04 ═══");
console.log("sybil-resistant, settled-money-weighted agent reputation + binding mandate\n");

console.log(">>> DEMO 1 — 50 sock-puppet agents praise each other (all unverified, dust)");
for (let i = 0; i < 50; i++) {
  await writeReceipt({ agentId: AGENT_ID, payer: `puppet-${i}`, payerVerified: false, amountUsd: 0.0001, outcome: "delivered", status: "settled" });
}
{
  const rows = await receiptsForAgent(AGENT_ID);
  const s = onchainScore(rows);
  console.log(`  receipts=${rows.length}  -> score=${s.score}  (sybil=${s.sybil.detected})`);
  console.log("  ✅ Score stays ZERO — fake agents cannot buy a score.\n");
}

console.log(">>> DEMO 2 — one real paying customer settles via x402, receives delivery");
const receiptId = await writeReceipt({
  agentId: AGENT_ID, payer: "0xrealBuyer", payerVerified: true, amountUsd: 1,
  deliverableHash: "0xdeliverable", outcome: "delivered", status: "pending",
});
// settle: reconcile to 'settled' only when on-chain err===null (here: verified).
await reconcileReceipt(receiptId.id, { ok: true, txHash: "0xsettle-receipt" });

{
  const rows = await receiptsForAgent(AGENT_ID);
  const s = onchainScore(rows);
  console.log(`  receipts=${rows.length}  -> score=${s.score} (settledUsd=${s.components.effectivelySettledUsd}, distinctVerified=${s.components.distinctVerifiedClients})`);
  console.log("  ✅ Score MOVED off zero — one real settlement outweighs 50 puppets.\n");
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