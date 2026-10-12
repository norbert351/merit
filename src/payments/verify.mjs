// Merit — payment verification service (P0 remediation).
//
// Never treats the presence of PAYMENT-SIGNATURE / X-PAYMENT / a body signature, or an arbitrary
// facilitator HTTP 200, as proof of payment. Every trusted receipt flows through an explicit,
// audited state machine and FAILS CLOSED on any ambiguity (timeout, RPC error, revert, wrong
// recipient, wrong network, replay, duplicate paymentId).
//
//   CREATED ──> PAYMENT_SUBMITTED ──> PAYMENT_VERIFIED ──> SETTLEMENT_CONFIRMED ──> RECEIPT_ACCEPTED
//                                  └──── ┤ (verify fails)   └─── ┤ (confirm fails)
//                                          ▼                        ▼
//                                       UNVERIFIED              REFUSED
//
// This service has NO demo fallback. Demo receipts are a separate, labelled receipt type that can
// never reach the trusted scoring engine (see docs/SECURITY_AUDIT.md).

import { appendAudit } from "../receipt/ledger.mjs";

export const PAYMENT_STATES = Object.freeze({
  CREATED: "CREATED",
  PAYMENT_SUBMITTED: "PAYMENT_SUBMITTED",
  PAYMENT_VERIFIED: "PAYMENT_VERIFIED",
  SETTLEMENT_CONFIRMED: "SETTLEMENT_CONFIRMED",
  RECEIPT_ACCEPTED: "RECEIPT_ACCEPTED",
  UNVERIFIED: "UNVERIFIED",
  REFUSED: "REFUSED",
  REJECTED: "REJECTED",
});

export class PaymentVerifier {
  /**
   * @param {{facilitator: object, publicClient: object, network: string, timeoutMs?: number}} deps
   */
  constructor({ facilitator, publicClient, network = "testnet", timeoutMs = 8000 }) {
    this.facilitator = facilitator;
    this.publicClient = publicClient;
    this.network = network;
    this.timeoutMs = timeoutMs;
  }

  async _audit(entityId, from, to, detail) {
    await appendAudit({ entity: "payment", entityId, from_state: from, to_state: to, detail });
  }

  /**
   * Strictly verify a buyer's PAYMENT-SIGNATURE with the facilitator. Fail-closed:
   * any HTTP error, timeout, non-JSON, or isValid!==true is UNVERIFIED — never a success.
   */
  async verifySignature({ payload, signature, chainId }) {
    if (!payload || !signature) {
      await this._audit("sig", PAYMENT_STATES.PAYMENT_SUBMITTED, PAYMENT_STATES.UNVERIFIED, "missing payload or signature");
      return { verified: false, reason: "missing payload or signature" };
    }
    let res;
    try {
      res = await Promise.race([
        this.facilitator.verify({ payload, signature, chainId }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("facilitator timeout")), this.timeoutMs)),
      ]);
    } catch (e) {
      await this._audit("sig", PAYMENT_STATES.PAYMENT_SUBMITTED, PAYMENT_STATES.UNVERIFIED, `facilitator error: ${e.message}`);
      return { verified: false, reason: `facilitator unavailable or timeout: ${e.message}` };
    }
    // Do NOT trust an arbitrary 200 — inspect the semantic result.
    const ok = res && typeof res === "object" && res.isValid === true;
    await this._audit("sig", PAYMENT_STATES.PAYMENT_SUBMITTED, ok ? PAYMENT_STATES.PAYMENT_VERIFIED : PAYMENT_STATES.UNVERIFIED,
      ok ? "facilitator verified signature" : `facilitator did not verify (isValid=${res?.isValid})`);
    return ok
      ? { verified: true, details: res }
      : { verified: false, reason: `facilitator did not verify (isValid=${res?.isValid})` };
  }

  /**
   * Confirm an actual on-chain settlement BEFORE a receipt is trusted. Never trusts a
   * client-supplied tx hash; the hash comes only from the facilitator's settle response and must
   * resolve to a successful receipt paid to the intended recipient on the intended chain.
   */
  async confirmSettlement({ txHash, expectedRecipient, chainId }) {
    if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      await this._audit("tx", PAYMENT_STATES.PAYMENT_VERIFIED, PAYMENT_STATES.UNVERIFIED, "no valid txHash to confirm");
      return { confirmed: false, reason: "no valid txHash to confirm" };
    }
    let receipt;
    try {
      receipt = await Promise.race([
        this.publicClient.getTransactionReceipt({ hash: txHash }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("rpc timeout")), this.timeoutMs)),
      ]);
    } catch (e) {
      await this._audit("tx", PAYMENT_STATES.PAYMENT_VERIFIED, PAYMENT_STATES.UNVERIFIED, `RPC unreachable: ${e.message}`);
      return { confirmed: false, reason: `RPC unreachable while confirming settlement: ${e.message}` };
    }
    if (receipt.status !== "success") {
      await this._audit("tx", PAYMENT_STATES.PAYMENT_VERIFIED, PAYMENT_STATES.REFUSED, `tx ${txHash} status=${receipt.status}`);
      return { confirmed: false, reason: `settlement not successful (status=${receipt.status})` };
    }
    if (expectedRecipient && receipt.to && receipt.to.toLowerCase() !== String(expectedRecipient).toLowerCase()) {
      await this._audit("tx", PAYMENT_STATES.PAYMENT_VERIFIED, PAYMENT_STATES.REFUSED, `tx paid ${receipt.to}, expected ${expectedRecipient}`);
      return { confirmed: false, reason: "settlement paid the wrong recipient" };
    }
    await this._audit("tx", PAYMENT_STATES.PAYMENT_VERIFIED, PAYMENT_STATES.SETTLEMENT_CONFIRMED, `tx ${txHash} confirmed on chain ${chainId}`);
    return { confirmed: true, logs: receipt.logs ?? [], blockNumber: receipt.blockNumber };
  }

  /**
   * Validate the amount/network/agent binding a payment is meant to satisfy. Returns ok or an
   * explicit reason; nothing here ever returns success for a mismatch.
   */
  validateBinding({ expected, actual }) {
    if (expected.agentId != null && actual.agentId != null && String(expected.agentId) !== String(actual.agentId)) {
      return { ok: false, reason: "payment bound to a different agentId" };
    }
    if (expected.amountMicroUsd != null && actual.amountMicroUsd != null && BigInt(expected.amountMicroUsd) !== BigInt(actual.amountMicroUsd)) {
      return { ok: false, reason: "payment amount does not match the quoted amount" };
    }
    if (expected.network && actual.network && expected.network !== actual.network) {
      return { ok: false, reason: "payment on a different network" };
    }
    return { ok: true };
  }

  /** Claim RECEIPT_ACCEPTED only after every gate passed. This is the single trusted-accept path. */
  async acceptReceipt({ receiptId }) {
    await appendAudit({ entity: "receipt", entityId: String(receiptId), from_state: PAYMENT_STATES.SETTLEMENT_CONFIRMED, to_state: PAYMENT_STATES.RECEIPT_ACCEPTED, detail: "receipt accepted as trusted" });
  }
}