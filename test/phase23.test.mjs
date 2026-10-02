// Phase 2 + Phase 3 tests: on-chain re-derivable score + the binding, escalation-proof mandate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { onchainScore, scoreJustification } from "../src/reputation/onchain-score.mjs";
import { enforceMandate, TIERS } from "../src/mandate/mandate.mjs";

const puppets = Array.from({ length: 50 }, (_, i) => ({
  payer: `puppet-${i}`, payerVerified: false, amountUsd: 0.0001, delivered: true,
}));

test("PHASE2 — score is re-derivable from on-chain receipt rows (the VC-rewarded property)", () => {
  const rows = [
    ...puppets,
    { payer: "0xreal1", payerVerified: true, amountUsd: 100, delivered: true },
    { payer: "0xreal2", payerVerified: true, amountUsd: 50, delivered: true },
  ];
  const s = onchainScore(rows);
  // settled money + distinct verified client floor, sybil cluster suppressed
  assert.equal(s.components.effectivelySettledUsd, 150);
  assert.equal(s.components.distinctVerifiedClients, 2);
  assert.equal(s.score, 150 + 2 * 5); // 160
  // justification is a transparent string a stranger can follow
  assert.match(scoreJustification(rows), /score = effectivelySettledUsd/);
});

test("PHASE2 — promising-but-unpaid (delivered=false) contributes nothing", () => {
  const s = onchainScore([{ payer: "0xpromiser", payerVerified: true, amountUsd: 100000, delivered: false }]);
  assert.equal(s.components.effectivelySettledUsd, 0);
  assert.equal(s.score, 0, "a promise is not reputation");
});

test("PHASE3 — low score => mandate grants none/low; spend over mandate is denied", () => {
  // zero settled reputation: no authority at all
  const none = enforceMandate(0, { requestedSpendUsd: 1 });
  assert.equal(none.allowed, false);
  assert.equal(none.effectiveTier, TIERS.none);

  // score 100 => low tier, max $10
  const low = enforceMandate(100, { requestedSpendUsd: 5 });
  assert.equal(low.allowed, true);
  assert.equal(low.effectiveTier, TIERS.low);
  assert.equal(low.maxSpendUsd, 10);
  const denied = enforceMandate(100, { requestedSpendUsd: 99 });
  assert.equal(denied.allowed, false, "spend above earned mandate denied");
});

test("PHASE3 — escalation-proof: a higher requested tier is capped to the earned mandate", () => {
  // attacker unlocks tier HIGH but only has score for LOW (100) => still capped at LOW
  const attempt = enforceMandate(100, { requestedTier: TIERS.high, requestedSpendUsd: 50 });
  assert.equal(attempt.allowed, false, "even after 'escalation', a 50x spend fails");
  assert.equal(attempt.effectiveTier, TIERS.low, "requested HIGH is clamped to earned LOW");
  assert.match(attempt.reason, /capped to earned tier/, "reason states the escalation-proof clamp");
});

test("PHASE3 — earning reputation raises the binding mandate", () => {
  const poor = enforceMandate(100, { requestedSpendUsd: 50 });
  assert.equal(poor.allowed, false);
  // real settled history pushes score high (2500+) => mandate allows it
  const rich = enforceMandate(3000, { requestedSpendUsd: 50 });
  assert.equal(rich.allowed, true);
  assert.equal(rich.effectiveTier, TIERS.high);
});