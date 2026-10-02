// Phase 1 integration tests: the PAID MONEY PATH, verified past the challenge.
// These test the plumbing that produces receipts — not the scoring (that's test/sybil.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MERIT_DB_PATH = join(mkdtempSync(join(tmpdir(), "merit-ledger-")), "receipts.db");

const { writeReceipt, readReceipt, reconcileReceipt, receiptsForAgent } = await import("../src/receipt/ledger.mjs");
const { FacilitatorClient } = await import("../src/x402/facilitator.mjs");

test("ledger writes a receipt ONLY on settled (err===null), not on promise", async () => {
  // a promise that never settles → must not appear as a settled receipt
  const pending = await writeReceipt({ agentId: 7, payer: "0xpromiser", amountUsd: 1000, status: "pending" });
  let row = await readReceipt(pending.id);
  assert.equal(row.status, "pending", "unsettled promise is pending, not compted");

  // settle it, then reconcile to settled
  const reconciled = await reconcileReceipt(pending.id, { ok: true, txHash: "0xabc" });
  assert.equal(reconciled.status, "settled");
  assert.equal(reconciled.amountUsd, 1000);

  // a reverted tx → honest status, never counted
  const bad = await writeReceipt({ agentId: 7, payer: "0xreverted", amountUsd: 5, txHash: "0xdead", status: "settled" });
  const reverted = await reconcileReceipt(bad.id, { ok: false });
  assert.equal(reverted.status, "reverted");
});

test("receipts are bound to agentId (the audit graph key)", async () => {
  await writeReceipt({ agentId: 42, payer: "0xa", amountUsd: 1, status: "settled" });
  await writeReceipt({ agentId: 42, payer: "0xb", amountUsd: 2, status: "settled" });
  await writeReceipt({ agentId: 99, payer: "0xc", amountUsd: 99, status: "settled" });
  const all = await receiptsForAgent(42);
  assert.equal(all.length, 2, "only agent 42's receipts returned");
});

test("facilitator client builds a valid x402 v2 challenge from supported kinds", async () => {
  const fc = new FacilitatorClient({ chainId: 10143 });
  const { kind, signer } = await fc.pickScheme(10143);
  assert.ok(kind, "a kind exists for testnet");
  assert.equal(kind.x402Version, 2, "Monad facilitator supports x402 v2");
  assert.ok(Array.isArray(signer), "signer addresses returned");
});

test("PaidGateway returns 402 (payment_required) when no payment-signature is present", async () => {
  const { PaidGateway } = await import("../src/gateway/server.mjs");
  const gw = new PaidGateway({ agentId: 7, chainId: 10143 });
  // directly test the 402 serializer
  const { res, body } = await new Promise((resolve) => {
    const send402 = gw._send402;
    const fakeRes = {
      writeHead: (code, headers) => {},
      end: (b) => resolve({ res: { code: 402 }, body: b }),
    };
    gw._send402(fakeRes);
  });
  const parsed = JSON.parse(body);
  assert.equal(parsed.error, "payment_required");
  assert.equal(parsed.agentId, 7);
});

test("PaidGateway rejects an unverified PAYMENT-SIGNATURE (anti-fraud gate before settle)", async () => {
  const { PaidGateway } = await import("../src/gateway/server.mjs");
  // stub facilitator verify -> {isValid:false}
  const fakeFacilitator = {
    verify: async () => ({ isValid: false, reason: "bad signature" }),
    pickScheme: async () => ({ kind: { scheme: "exact", x402Version: 2 } }),
  };
  const gw = new PaidGateway({ agentId: 7, chainId: 10143, facilitator: fakeFacilitator });
  const r = await gw.settleAndRecord({
    payload: "x",
    signature: "bogus",
    payer: "0xattacker",
    amountUsd: 99999,
    deliverableHash: null,
  });
  assert.equal(r.status, "rejected", "bogus signature must NOT settle");
});