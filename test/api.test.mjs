// Phase 4 integration tests: the hire-then-settle API (src/api/server.mjs) end to end.
// Boots the real HTTP server on an ephemeral port against a throwaway DB and drives every
// endpoint the UI depends on. Proves the two demo payoffs are real over HTTP, not just in-process.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MERIT_DB_PATH = join(mkdtempSync(join(tmpdir(), "merit-api-")), "receipts.db");
delete process.env.MERIT_EXECUTOR_KEY; // demo mode — honest, no on-chain claim

const { startApi } = await import("../src/api/server.mjs");

let server, base;
before(async () => {
  server = startApi(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

const get = async (p) => (await fetch(base + p)).json();
const post = async (p, body, headers = {}) =>
  fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("API — /api/meta reports honest demo mode + the deployed contracts", async () => {
  const m = await get("/api/meta");
  assert.equal(m.ok, true);
  assert.equal(m.mode, "demo", "no executor key => demo mode (never claims live)");
  assert.equal(m.chainId, 10143);
  assert.match(m.contracts.reputation, /^0x[0-9a-fA-F]{40}$/);
});

test("API — /api/agents returns every agent with score, mandate and receipt trail", async () => {
  const d = await get("/api/agents");
  assert.equal(d.ok, true);
  assert.equal(d.agents.length, 4);
  const a1 = d.agents.find((a) => a.id === 1);
  // demo 1: 50 sock puppets suppressed + 3 verified buyers ($120+$80+$45=245) -> score 245+15=260
  assert.equal(a1.score.effectivelySettledUsd, 245);
  assert.equal(a1.score.distinctVerifiedClients, 3);
  assert.equal(a1.score.scoreUsd, 260);
  assert.equal(a1.sybil.detected, true, "the dust cluster is detected and suppressed");
  assert.equal(a1.receipts.length, 53);
  const a4 = d.agents.find((a) => a.id === 4);
  assert.equal(a4.score.scoreUsd, 0, "cold-start agent scores 0 until it settles a real call");
});

test("API — DEMO 1: 50 sock puppets cannot buy a score (suppression holds)", async () => {
  const a1 = (await get("/api/agent/1")).agent;
  // The 50 unverified dust rows exist in the trail, yet contribute $0 to the score.
  const dust = a1.receipts.filter((r) => !r.verified && r.amountUsd < 0.5);
  assert.equal(dust.length, 50, "all 50 puppets are in the ledger");
  assert.equal(a1.score.effectivelySettledUsd, 245, "none of the $0.0001 dust moved the score");
});

test("API — DEMO 2: one real x402 settlement moves a cold-start agent's score + mandate", async () => {
  const before = (await get("/api/agent/4")).agent;
  assert.equal(before.score.scoreUsd, 0);

  // Step 1: no payment signature -> real HTTP 402 challenge
  const c = await post("/api/settle", { agentId: 4, amountUsd: 5 });
  assert.equal(c.status, 402, "settle without a payment signature is challenged, never free");
  assert.ok(c.headers.get("payment-required"), "PAYMENT-REQUIRED header carries the challenge");

  // Step 2: replay with a payment signature -> settle + mint the receipt
  const r = await post("/api/settle", { agentId: 4, amountUsd: 5, payer: "0xbuyerTest" }, { "payment-signature": "sig" });
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.status, "settled");
  assert.equal(j.mode, "demo", "still demo: labeled honestly, not claimed on-chain");

  // Step 3: the score moved and the receipt is on the ledger
  const after = (await get("/api/agent/4")).agent;
  assert.equal(after.score.scoreUsd, 10, "score moved off zero (5 settled + 1 verified client * 5)");
  assert.equal(after.receipts.length, 1);
});

test("API — /api/mandate/enforce is escalation-proof (Bankr refutation)", async () => {
  // agent 1 has score 260 -> LOW tier (>=50), max spend $10
  const esc = await post("/api/mandate/enforce", { agentId: 1, requestedTier: 3, requestedSpendUsd: 50 });
  const j = await esc.json();
  assert.equal(j.ok, true);
  assert.equal(j.allowed, false, "spend $50 denied");
  assert.equal(j.effectiveTier, 1, "requested HIGH (3) clamped to earned LOW (1)");
  assert.match(j.reason, /capped to earned tier/);

  // a within-mandate spend is allowed
  const ok = await (await post("/api/mandate/enforce", { agentId: 1, requestedSpendUsd: 5 })).json();
  assert.equal(ok.allowed, true);
  assert.equal(ok.maxSpendUsd, 10);
});

test("API — /api/score/:id exposes the re-derivation string a stranger recomputes", async () => {
  const s = await get("/api/score/1");
  assert.equal(s.ok, true);
  assert.match(s.rederive, /score = effectivelySettledUsd \+ distinctVerifiedClients \* 5/);
  assert.equal(s.score.scoreUsd, 260);
});

test("API — settle rejects a non-positive amount (never a free/negative receipt)", async () => {
  const r = await post("/api/settle", { agentId: 1, amountUsd: 0 }, { "payment-signature": "sig" });
  assert.equal(r.status, 400);
});
