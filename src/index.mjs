// Merit entry point (placeholder until Phase 1).
// Phase 1 wires: ERC-8004 registration + paid-MCP/x402 gateway + receipt graph.
console.log("merit — sybil-resistant agent reputation. Plan in Plan.md; moat core + tests are live.");
try {
  const { scoreAgent } = await import("./reputation/score.mjs");
  console.log("moat core loaded OK; score of 50 sock-puppets =", scoreAgent(
    Array.from({ length: 50 }, (_, i) => ({ payerId: `p${i}`, verified: false, amountUsd: 0.0001, delivered: true })),
  ).score);
} catch (e) {
  console.error("boot error", e);
  process.exit(1);
}