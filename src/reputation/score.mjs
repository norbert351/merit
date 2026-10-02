// Merit scoring engine — the moat.
//
// A reputation computed ONLY from money that actually settled, weighted by
// DISTINCT VERIFIED client identity, with sybil clusters zeroed. Every fact is
// re-derivable from the settled-receipt graph (Phase 2 on-chain anchor), so a
// score can be recomputed by a stranger with generic tooling.
//
// Remove the weighting below and sock-puppet agents run the system. That is
// the proof bar (see Plan.md §0 anti-thesis test).

import { detectSybil } from "./sybil-guard.mjs";

const VERIFIED_CLIENT_BONUS_USD = 5; // a distinct verified real client is worth a floor
const SYBIL_SUPPRESS_FACTOR = 0; // sybil cluster contributes literally nothing

/**
 * @param {Array<{payerId:string, verified:boolean, amountUsd:number, delivered:boolean}>} receipts
 * @returns {{score:number, components:{settledUsd:number,distinctVerifiedClients:number,effectivelySettledUsd:number}, sybil:object}}
 */
export function scoreAgent(receipts) {
  const all = Array.isArray(receipts) ? receipts : [];
  // 1) settled money only — a promising-but-unpaid agent scores 0.
  const settledUsd = all.reduce((s, r) => s + (r.delivered ? r.amountUsd || 0 : 0), 0);
  // 2) sybil cluster detection (unverified + sub-stake + >=4)
  const sybil = detectSybil(all);
  if (sybil.detected) {
    // zero the dust cluster's contribution entirely
    const clusterIds = new Set(
      all
        .filter((r) => !r.verified && (r.amountUsd || 0) < 0.5)
        .map((r) => r.payerId),
    );
    const effectiveReceipts = all.filter((r) => !clusterIds.has(r.payerId));
    const effectivelySettledUsd = effectiveReceipts.reduce(
      (s, r) => s + (r.delivered ? r.amountUsd || 0 : 0),
      0,
    );
    const distinctVerifiedClients = new Set(
      effectiveReceipts.filter((r) => r.verified && r.delivered).map((r) => r.payerId),
    ).size;
    const score =
      effectivelySettledUsd + distinctVerifiedClients * VERIFIED_CLIENT_BONUS_USD;
    return {
      score,
      components: {
        settledUsd,
        distinctVerifiedClients,
        effectivelySettledUsd,
      },
      sybil,
    };
  }
  // 3) no sybil: settled money + distinct settled verified-client floor
  const distinctVerifiedClients = new Set(
    all.filter((r) => r.verified && r.delivered).map((r) => r.payerId),
  ).size;
  const score = settledUsd + distinctVerifiedClients * VERIFIED_CLIENT_BONUS_USD;
  return {
    score,
    components: { settledUsd, distinctVerifiedClients, effectivelySettledUsd: settledUsd },
    sybil,
  };
}