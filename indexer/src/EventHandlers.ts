// Merit settled-receipt graph — Envio HyperIndex event handlers.
//
// Deterministic reconstruction of the canonical on-chain score from the complete event history.
//   canonical score (micro-USD) = effectivelySettledMicroUsd + distinctVerifiedClients * 5 * 1e6
// The contract emits `scoreAfter` = post-receipt effective settled (micro-USD), so the indexer
// ADDS the distinct-verified bonus to reproduce the exact `scoreOf` value a stranger reads from
// the contract. Handlers are idempotent (keyed by tx-log) and rebuild cleanly from the deployment
// block. This is the bounty layer; the authoritative value is always on-chain `scoreOf`.

import { MeritReputation } from "generated";

const VERIFIED_CLIENT_BONUS_USD = 5n;
const SCALE = 1_000_000n;

/** Distinct verified + delivered payers for an agent, from the indexed receipts (deterministic). */
async function distinctVerifiedPayers(agentId, context) {
  const receipts = await context.Receipt.getMulti({ where: { agent_id: { eq: agentId } } });
  const seen = new Set();
  for (const r of receipts) if (r.verified && r.delivered) seen.add(String(r.payer));
  return BigInt(seen.size);
}

MeritReputation.ReceiptRecorded.handler(async ({ event, context }) => {
  const agentId = event.params.agentId.toString();
  const receiptId = `${event.transaction.hash}-${event.logIndex}`;
  const amount = event.params.amountMicroUsd;
  const delivered = event.params.delivered;

  // Receipt node (idempotent: same tx-log can't create a second node).
  context.Receipt.set({
    id: receiptId,
    agent_id: agentId,
    payer: event.params.payer,
    verified: event.params.verified,
    amountMicroUsd: amount,
    delivered,
    deliverableHash: event.params.deliverableHash,
    scoreAfter: event.params.scoreAfter,          // post-receipt effective settled (micro-USD)
    blockNumber: BigInt(event.block.number),
    txHash: event.transaction.hash,
    timestamp: BigInt(event.block.timestamp),
  });

  // Accumulate settlement facts. `scoreAfter` is the CONTRACT's post-suppression effective
  // settled (micro-USD), so effectivelySettledUsd tracks it; settledUsd accumulates delivered
  // amounts pre-suppression.
  const prev = await context.Agent.get(agentId);
  const settledMicro = (prev?.settledUsd ?? 0n) + (delivered ? amount : 0n);
  const effMicro = prev?.effectivelySettledUsd === undefined
    ? event.params.scoreAfter
    : prev.effectivelySettledUsd > event.params.scoreAfter ? prev.effectivelySettledUsd /* monotonic */ : event.params.scoreAfter;
  const distinct = await distinctVerifiedPayers(agentId, context);

  context.Agent.set({
    id: agentId,
    scoreUsd: effMicro + distinct * VERIFIED_CLIENT_BONUS_USD * SCALE, // CANONICAL score, matches scoreOf
    settledUsd: settledMicro,
    effectivelySettledUsd: effMicro,
    distinctVerifiedClients: distinct,
    sybilDetected: event.params.sybilDetected,
    updatedAtBlock: BigInt(event.block.number),
  });

  // Sybil suppression is netted by the contract in `scoreAfter`; keep a cross-referenced log too.
  if (event.params.sybilDetected) {
    const q = event.transaction.hash + "-" + event.logIndex + "-syb";
    if (!(await context.SybilSuppression.get(q))) {
      context.SybilSuppression.set({ id: q, agent_id: agentId, clusterSize: 0n, suppressedMicroUsd: 0n, blockNumber: BigInt(event.block.number), timestamp: BigInt(event.block.timestamp) });
    }
  }
});

MeritReputation.SybilClusterSuppressed.handler(async ({ event, context }) => {
  const agentId = event.params.agentId.toString();
  context.SybilSuppression.set({
    id: `${event.transaction.hash}-${event.logIndex}`,
    agent_id: agentId,
    clusterSize: event.params.clusterSize,
    suppressedMicroUsd: event.params.suppressedMicroUsd,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
  });
  // Recompute the canonical score after suppression.
  const prev = await context.Agent.get(agentId);
  if (prev) {
    const eff = prev.effectivelySettledUsd >= event.params.suppressedMicroUsd
      ? prev.effectivelySettledUsd - event.params.suppressedMicroUsd : 0n;
    const distinct = await distinctVerifiedPayers(agentId, context);
    context.Agent.set({ ...prev, effectivelySettledUsd: eff, scoreUsd: eff + distinct * VERIFIED_CLIENT_BONUS_USD * SCALE, sybilDetected: true, updatedAtBlock: BigInt(event.block.number) });
  }
});