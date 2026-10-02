// Phase 2 — On-chain anchored reputation, re-derivable by a stranger.
//
// The Merit property VCs reward: given the settled-receipt graph + this transparent algorithm,
// ANY outsider can recompute any agent's score with generic tooling. Nothing is hidden behind
// our server. The score and its component facts are re-derivable from on-chain data alone.

import { detectSybil } from "./sybil-guard.mjs";

export const VERIFIED_CLIENT_BONUS_USD = 5;

/**
 * @param {Array<{payer:string, payerVerified:boolean, amountUsd:number, delivered:boolean}>} rows
 *   `rows` are the SETTLED on-chain receipts (status==='settled') for one agent, filtered upstream.
 * @returns {{score:number, components:object, sybil:object}}
 */
export function onchainScore(rows) {
  // normalize field aliases (DB uses payer/payerVerified; demo used payerId/verified)
  const receipts = rows.map((r) => ({
    payer: r.payer ?? r.payerId,
    verified: r.payerVerified ? true : !!r.verified,
    amountUsd: r.amountUsd,
    delivered: r.delivered ?? true,
  }));

  const sybil = detectSybil(receipts.map((r) => ({ ...r, payerId: r.payer })));

  let effective;
  if (sybil.detected) {
    const clusterIds = new Set(
      receipts.filter((r) => !r.verified && r.amountUsd < 0.5).map((r) => r.payer),
    );
    effective = receipts.filter((r) => !clusterIds.has(r.payer));
  } else {
    effective = receipts;
  }

  const settledUsd = receipts.filter((r) => r.delivered).reduce((s, r) => s + r.amountUsd, 0);
  const effectivelySettledUsd = effective.filter((r) => r.delivered).reduce((s, r) => s + r.amountUsd, 0);
  const distinctVerified = new Set(effective.filter((r) => r.verified && r.delivered).map((r) => r.payer)).size;

  return {
    score: effectivelySettledUsd + distinctVerified * VERIFIED_CLIENT_BONUS_USD,
    components: { settledUsd, effectivelySettledUsd, distinctVerifiedClients: distinctVerified },
    sybil,
  };
}

/**
 * Re-derivation string: the command the docs embed so a judge can recompute a score
 * from the on-chain receipt graph using generic tooling (Envio indexer output + this file).
 */
export function scoreJustification(rows) {
  const s = onchainScore(rows);
  return [
    `score = effectivelySettledUsd + distinctVerifiedClients * ${VERIFIED_CLIENT_BONUS_USD}`,
    `= ${s.components.effectivelySettledUsd} + ${s.components.distinctVerifiedClients} * ${VERIFIED_CLIENT_BONUS_USD}`,
    `= ${s.score}`,
    s.sybil.detected ? `(sybil cluster of ${s.sybil.clusterSize} unverified dust payers suppressed to $0)` : "(no sybil cluster)",
  ].join("\n");
}