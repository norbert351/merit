// Seed the receipt ledger with the 4 demo agents (idempotent). Useful before a demo/judging
// session so GET /api/agents has a populated graph without waiting for live settlements.
//
//   node src/api/seed.mjs
//
// Uses the same ensureSeeded() the API calls, so the seeded rows are exactly what the UI shows.
import { REGISTRY, ensureSeeded, agentView } from "./server.mjs";

console.log("Seeding Merit receipt ledger…");
for (const a of REGISTRY) {
  await ensureSeeded(a.id);
  const v = await agentView(a);
  console.log(
    `  agent ${v.id} ${v.name.padEnd(18)} score=${v.score.scoreUsd}  settled=$${v.score.effectivelySettledUsd}  ` +
    `verified=${v.score.distinctVerifiedClients}  sybil=${v.sybil.detected}  receipts=${v.receipts.length}`,
  );
}
console.log("done. Start the API: npm run api");
