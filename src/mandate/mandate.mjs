// Phase 3 — Binding mandate: the consequence.
//
// Agent authority = f(settled reputation). An agent may only hold/execute up to the mandate its
// EARNED, SETTLED reputation justifies. Escalation-proof: attempting to unlock a higher
// permission tier has NO effect above the mandate — direct refutation of the Bankr post-mortem
// ("spending limits didn't apply because the attacker had unlocked a higher tier first").

// Tiers an agent could try to unlock (MetaMask Agent Wallet / permission tier analogy).
export const TIERS = Object.freeze({
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
});

// How much settled USD reputation earns each authority tier.
const MANDATE_TABLE = Object.freeze([
  { minScore: 0, tier: TIERS.none, maxSpendUsd: 0 },
  { minScore: 50, tier: TIERS.low, maxSpendUsd: 10 },
  { minScore: 500, tier: TIERS.medium, maxSpendUsd: 100 },
  { minScore: 2500, tier: TIERS.high, maxSpendUsd: 1000 },
]);

function mandateForScore(score) {
  let m = MANDATE_TABLE[0];
  for (const row of MANDATE_TABLE) if (score >= row.minScore) m = row;
  return m;
}

/**
 * The escalation-proof mandate check. Any claimed higher tier is CAPPED at what settled
 * reputation earned. This runs on EVERY spend/action, not once at setup.
 *
 * @param {number} score current on-chain reputation score
 * @param {{requestedTier?:number, requestedSpendUsd:number, action?:string}} attempt
 * @returns {{allowed:boolean, effectiveTier:number, maxSpendUsd:number, reason:string}}
 */
export function enforceMandate(score, attempt) {
  const { tier, maxSpendUsd } = mandateForScore(score);
  const requestedTier = attempt.requestedTier ?? tier;
  // escalation-proof: requested tier above the earned mandate is clamped to the mandate
  const effectiveTier = Math.min(requestedTier, tier);
  const allowed = attempt.requestedSpendUsd <= maxSpendUsd;
  let reason;
  if (requestedTier > tier && !allowed) {
    reason = `requested tier ${requestedTier} capped to earned tier ${tier} (escalation-proof); spend $${attempt.requestedSpendUsd} exceeds mandate max $${maxSpendUsd}`;
  } else if (requestedTier > tier) {
    reason = `requested tier ${requestedTier} capped to earned tier ${tier} (escalation-proof)`;
  } else if (!allowed) {
    reason = `spend $${attempt.requestedSpendUsd} exceeds mandate max $${maxSpendUsd} for settled score ${score}`;
  } else {
    reason = `mandate satisfied (score ${score} => tier ${tier}, max $${maxSpendUsd})`;
  }
  return { allowed, effectiveTier, maxSpendUsd, reason };
}