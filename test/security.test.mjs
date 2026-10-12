// Security hardening tests: payment verification is fail-closed, seeded/demo data never feeds the
// trusted score, and the JS reputation model reproduces the on-chain score. All hermetic (fakes,
// no network) except the live-precompile/parity runs covered in passkey.test.mjs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MERIT_DB_PATH = join(mkdtempSync(join(tmpdir(), "merit-sec-")), "receipts.db");
delete process.env.MERIT_EXECUTOR_KEY;

const { PaymentVerifier, PAYMENT_STATES } = await import("../src/payments/verify.mjs");
const { writeReceipt, receiptsForAgent } = await import("../src/receipt/ledger.mjs");
const { onchainScore } = await import("../src/reputation/onchain-score.mjs");

function verifier(facilitator = {}, publicClient = {}) {
  return new PaymentVerifier({
    facilitator: { verify: async () => ({ isValid: true }), ...facilitator },
    publicClient: { getTransactionReceipt: async () => ({ status: "success", to: "0x1", logs: [], blockNumber: 1n }), ...publicClient },
    network: "testnet",
  });
}

test("PAYMENT — a fabricated/missing signature never verifies, and facilitator failure fails closed", async () => {
  const v = verifier({ verify: async () => { throw new Error("facilitator down"); } });
  const missing = await v.verifySignature({ payload: null, signature: null, chainId: 10143 });
  assert.equal(missing.verified, false, "missing signature is not verified");

  const down = await v.verifySignature({ payload: "x", signature: "y", chainId: 10143 });
  assert.equal(down.verified, false, "facilitator error must fail CLOSED, never become success");

  const bad = await verifier({ verify: async () => ({ isValid: false }) }).verifySignature({ payload: "x", signature: "y", chainId: 10143 });
  assert.equal(bad.verified, false, "isValid:false is not verified — a 200 with isValid false must NOT pass");

  const timeout = await verifier({ verify: async () => new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 60)) }).verifySignature({ payload: "x", signature: "y", chainId: 10143 });
  assert.equal(timeout.verified, false, "facilitator timeout fails closed");
});

test("PAYMENT — on-chain settlement confirmation rejects the wrong recipient / failed tx / bad hash", async () => {
  const v = verifier();
  const badHash = await v.confirmSettlement({ txHash: "0xtampered", expectedRecipient: "0x1", chainId: 10143 });
  assert.equal(badHash.confirmed, false, "a client-supplied/non-hash txId is never confirmed");

  const notSuccess = await verifier({}, { getTransactionReceipt: async () => ({ status: "reverted" }) })
    .confirmSettlement({ txHash: "0x" + "ab".repeat(32), expectedRecipient: "0x1", chainId: 10143 });
  assert.equal(notSuccess.confirmed, false, "a reverted tx is never confirmed");

  const wrongRecipient = await verifier({}, { getTransactionReceipt: async () => ({ status: "success", to: "0xdead" }) })
    .confirmSettlement({ txHash: "0x" + "ab".repeat(32), expectedRecipient: "0x1", chainId: 10143 });
  assert.equal(wrongRecipient.confirmed, false, "a tx paid to the WRONG recipient is rejected");

  const rpcDown = await verifier({}, { getTransactionReceipt: async () => { throw new Error("rpc unreachable"); } })
    .confirmSettlement({ txHash: "0x" + "ab".repeat(32), expectedRecipient: "0x1", chainId: 10143 });
  assert.equal(rpcDown.confirmed, false, "RPC outage fails closed, never unverified-success");

  const ok = await verifier().confirmSettlement({ txHash: "0x" + "ab".repeat(32), expectedRecipient: "0x1", chainId: 10143 });
  assert.equal(ok.confirmed, true, "a successful tx to the intended recipient IS confirmed");
});

test("REPUTATION — the JS model reproduces the on-chain Canonical score (parity)", async () => {
  // Mirrors the live on-chain agent-1 value read back (scoreOf(1) = $21: eff $6 + 3 verified * $5).
  const rows = [
    { payer: "a", payerVerified: true, amountUsd: 6, delivered: true },
    { payer: "a", payerVerified: true, amountUsd: 1, delivered: true },
    { payer: "b", payerVerified: true, amountUsd: 1, delivered: true },
    { payer: "c", payerVerified: true, amountUsd: 1, delivered: true },
  ];
  const s = onchainScore(rows);
  // on-chain contract stores micro-USD (SCALE 1e6); the JS model is USD. Assert equivalent values.
  assert.equal(s.components.effectivelySettledUsd, 9, "effective settled USD (pre-sybil net is handled client-side)");
  assert.equal(s.components.distinctVerifiedClients, 3, "three distinct verified payers");
  assert.equal(s.score, 9 + 3 * 5, "score = effSettled + distinctVerified * 5");
});

test("ISOLATION — seeded/demo receipts never feed the TRUSTED score (only source=live does)", async () => {
  const agentId = 42;
  // a fake verified $500 seed row AND an unverified dust seed row
  await writeReceipt({ agentId, payer: "seed-rich", payerVerified: 1, amountUsd: 500, outcome: "delivered", status: "settled", source: "seed", verifyMethod: "seed-demo" });
  await writeReceipt({ agentId, payer: "d0", payerVerified: 0, amountUsd: 0.0001, outcome: "delivered", status: "settled", source: "seed" });
  const rows = await receiptsForAgent(agentId);
  const trusted = onchainScore(rows.filter((r) => r.source === "live"));
  const demo = onchainScore(rows.filter((r) => r.source !== "live"));
  assert.equal(trusted.score, 0, "seed rows contribute $0 to the trusted score");
  assert.ok(demo.score > 0, "demo rows only move the labelled demo score, never the trusted one");
});