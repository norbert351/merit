// The two winning demos, as tests — deterministic, on-chain-able, no fabrication.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreAgent } from "../src/reputation/score.mjs";

// 50 sock-puppet agents that all praise each other, all unverified, all dust.
function sockPuppets(n = 50) {
  return Array.from({ length: n }, (_, i) => ({
    payerId: `puppet-${i}`,
    verified: false,
    amountUsd: 0.0001, // under the stake floor
    delivered: true, // they "pay" and "get a result" — but it costs nothing
  }));
}

test("DEMO 1 — 50 sock puppets praising each other does NOT move the score", () => {
  const puppets = sockPuppets(50);
  const { score, components, sybil } = scoreAgent(puppets);
  assert.equal(sybil.detected, true, `sybil cluster detected (n=${sybil.clusterSize})`);
  assert.equal(components.effectivelySettledUsd, 0, "dust cluster fully suppressed");
  assert.equal(score, 0, "50 fake agents cannot buy a score");
});

test("DEMO 2 — one real paying customer settling via x402 moves the score", () => {
  // 50 puppets fail...
  const puppets = sockPuppets(50);
  // ...then one REAL verified customer actually settles $1 and gets delivery.
  const realPayer = {
    payerId: "0xverifiedBuyer",
    verified: true, // P256/WebAuthn / Cleanverse CVI verified identity
    amountUsd: 1.0,
    delivered: true,
  };
  const { score, components, sybil } = scoreAgent([...puppets, realPayer]);
  assert.equal(sybil.detected, true, "puppet cluster still flagged");
  assert.equal(components.distinctVerifiedClients, 1, "one distinct verified client");
  assert.ok(score >= 1 + 5, `score moved off zero (got ${score}); mandate unlocks`);
});

test("a promising-but-unpaid agent scores 0 (settled money only)", () => {
  // Someone promises to pay a lot but never delivers → no score.
  const { score, components } = scoreAgent([
    { payerId: "0xpromiser", verified: true, amountUsd: 100_000, delivered: false },
  ]);
  assert.equal(components.settledUsd, 0);
  assert.equal(score, 0, "a promise is not reputation");
});