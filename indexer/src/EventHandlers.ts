// Merit settled-receipt graph — Envio HyperIndex event handlers.
//
// Every settled x402 receipt on the MeritReputation contract becomes a node in this graph.
// The graph is the on-chain source of truth a stranger re-derives the Merit score from:
//   score = effectivelySettledUsd + distinctVerifiedClients * VERIFIED_CLIENT_BONUS_USD
// (see ../../src/reputation/onchain-score.mjs — the exact same formula, re-runnable by anyone).

import { MeritReputation } from "generated";

const VERIFIED_CLIENT_BONUS_USD = 5n; // must match src/reputation/onchain-score.mjs

MeritReputation.ReceiptRecorded.handler(async ({ event, context }) => {
  const agentId = event.params.agentId.toString();
  const amount = event.params.amountMicroUsd;
  const verified = event.params.verified;
  const delivered = event.params.delivered;

  // Receipt node
  const receiptId = `${event.transaction.hash}-${event.logIndex}`;
  context.Receipt.set({
    id: receiptId,
    agent_id: agentId,
    payer: event.params.payer,
    verified,
    amountMicroUsd: amount,
    delivered,
    deliverableHash: event.params.deliverableHash,
    scoreAfter: event.params.scoreAfter,
    blockNumber: BigInt(event.block.number),
    txHash: event.transaction.hash,
    timestamp: BigInt(event.block.timestamp),
  });

  // Fold the receipt into the agent's running settlement facts. Suppression is applied
  // upstream by the contract (SybilClusterSuppressed), so effectivelySettledUsd here is the
  // post-suppression figure the contract reports.
  const prev = await context.Agent.get(agentId);
  const settledMicro = (prev?.settledUsd ?? 0n) + (delivered ? amount : 0n);
  const effMicro = event.params.scoreAfter - BigInt(Number(0)); // contract already nets sybil
  const distinct = prev?.distinctVerifiedClients ?? 0n;

  context.Agent.set({
    id: agentId,
    scoreUsd: event.params.scoreAfter,
    settledUsd: settledMicro,
    effectivelySettledUsd: prev?.effectivelySettledUsd ?? settledMicro,
    distinctVerifiedClients: verified && delivered ? distinct + 1n : distinct,
    sybilDetected: event.params.sybilDetected,
    updatedAtBlock: BigInt(event.block.number),
  });
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
  const prev = await context.Agent.get(agentId);
  if (prev) {
    context.Agent.set({
      ...prev,
      effectivelySettledUsd: prev.settledUsd - event.params.suppressedMicroUsd,
      sybilDetected: true,
      updatedAtBlock: BigInt(event.block.number),
    });
  }
});
