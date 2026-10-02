// Sybil guard: suppress feedback clusters that are cheap to fake.
//
// The whole point of Merit: reputation must be buyable-proof against sock
// puppets. A group of low-stake, UNVERIFIED payer wallets that all praise one
// agent is the canonical sybil attack (ERC-8004 spec names it: "Sybil attacks
// are possible, inflating the reputation of fake agents"). We detect and zero
// those clusters so they contribute nothing to a score.

const MIN_VERIFIED_STAKE_USD = 0.5; // a real settlement a stranger actually paid

/**
 * @param {Array<{payerId:string, verified:boolean, amountUsd:number, delivered:boolean}>} receipts
 * @returns {{clusterSize:number, detected:boolean, suppressReason?:string}}
 *
 * A cluster is a set of payers who all paid ONE agent with (a) no verified
 * identity AND (b) below a meaningful stake. If the cluster is large (>=4) and
 * all members are unverified + dust, treat it as a sybil group.
 */
export function detectSybil(receipts) {
  const flagged = receipts.filter(
    (r) => !r.verified && (r.amountUsd || 0) < MIN_VERIFIED_STAKE_USD,
  );
  if (flagged.length >= 4) {
    return {
      clusterSize: flagged.length,
      detected: true,
      suppressReason: `${flagged.length} unverified sub-stake payers — probable sock-puppet cluster`,
    };
  }
  return { clusterSize: flagged.length, detected: false };
}