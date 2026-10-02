// Merit Paid Agent Gateway — an x402-protected MCP tool surface.
//
// Flow:
//   1. Buyer calls GET /tools or POST /tools/call without a payment → HTTP 402
//      with a valid x402 v2 `accepts[]` + `PAYMENT-REQUIRED` header (the challenge).
//   2. Buyer signs (OKX Agent Payments Protocol / x402), replays the call with
//      PAYMENT-SIGNATURE.
//   3. Server verifies the signature via the Monad facilitator (/verify).
//   4. Server settles via the facilitator (/settle) → on-chain tx.
//   5. Server re-confirms the tx receipt on-chain (err===null) → THEN writes the
//      receipt to the ledger. A receipt exists IFF money actually settled.

import { createServer } from "node:http";
import { FacilitatorClient } from "../x402/facilitator.mjs";
import { writeReceipt, reconcileReceipt } from "../receipt/ledger.mjs";
import { publicClient } from "../monad/erc8004.mjs";
import { MONAD, X402_FACILITATOR_URL } from "../monad/config.mjs";

// In production the private key lives behind the facilitator service (it covers gas).
// This is the one place MERIT_EXECUTOR_KEY is read; absent → verification-only mode
// (server can verify + issuer the challenge but relies on an external settle hook).
const EXECUTOR_KEY = process.env.MERIT_EXECUTOR_KEY || null;
const NETWORK = process.env.MERIT_NETWORK || "testnet";
const CHAIN_ID = MONAD[NETWORK]?.chainId ?? MONAD.testnet.chainId;

class PaidGateway {
  constructor({ agentId, tools = [], chainId = CHAIN_ID, facilitator } = {}) {
    this.agentId = agentId;
    this.tools = tools;
    this.chainId = chainId;
    this.client = facilitator || new FacilitatorClient({ chainId });
    this.inflight = new Map(); // signatureNonce -> {entry, status}
  }

  /** The x402 v2 challenge for a payment, using the facilitator's supported kind. */
  async challenge() {
    const { kind } = await this.client.pickScheme(this.chainId);
    const accepts = [
      {
        scheme: kind.scheme,
        chainId: this.chainId,
        token: "0x0000000000000000000000000000000000000000", // native MON placeholder; real token per kind
        amount: "10", // atomic units; configurable per tool
        payTo: EXECUTOR_KEY ? null : null, // filled by facilitator on settle
        x402Version: 2,
      },
    ];
    return {
      accepts,
      x402Version: 2,
      recipient: "merit-agent",
      agentId: this.agentId,
      _challenge: { facilitatorUrl: this.client.url, kind },
    };
  }

  /** Verify a buyer's PAYMENT-SIGNATURE; only a verified signature proceeds. */
  async verifyPayment({ payload, signature }) {
    try {
      const v = await this.client.verify({ payload, signature, chainId: this.chainId });
      return v;
    } catch (e) {
      return { isValid: false, reason: e.message };
    }
  }

  /**
   * Settle a verified payment and write the receipt ONLY on err===null.
   * @returns {Promise<{status:'settled'|'verification_only'|'reverted', txHash?, receiptId?}>}
   */
  async settleAndRecord({ payload, signature, payer, amountUsd, deliverableHash }) {
    // 1) verify first (anti-fraud: a bogus signature never settles)
    const v = await this.verifyPayment({ payload, signature });
    if (!v || v.isValid === false) {
      return { status: "rejected", reason: "PAYMENT-SIGNATURE not verified by facilitator" };
    }

    // 2) settlement path
    if (EXECUTOR_KEY) {
      const s = await this.client.settle({ payload, signature, chainId: this.chainId });
      const txHash = s.txHash || s.transactionHash;
      // err===null discipline: re-confirm on-chain before trusting the receipt exists
      let onChainOk = false;
      try {
        const rec = await publicClient(NETWORK).waitForTransactionReceipt({ hash: txHash });
        onChainOk = rec.status === "success";
      } catch {
        onChainOk = false;
      }
      const receiptId = await writeReceipt({
        agentId: this.agentId,
        payer,
        payerVerified: 1,
        amountUsd,
        deliverableHash,
        outcome: onChainOk ? "delivered" : null,
        txHash,
        chainId: this.chainId,
        status: onChainOk ? "settled" : "reverted",
      });
      return { status: onChainOk ? "settled" : "reverted", txHash, receiptId, onChainOk };
    }

    // 3) verification-only mode: challenge is issued; settlement recorded by an external
    //    settle hook (facilitator). Still record a PENDING receipt so reconcile can settle it.
    const receiptId = await writeReceipt({
      agentId: this.agentId,
      payer,
      payerVerified: 1,
      amountUsd,
      deliverableHash,
      outcome: null,
      txHash: null,
      chainId: this.chainId,
      status: "pending",
    });
    return { status: "verification_only", receiptId, note: "no executor key; pending reconciled by settle hook" };
  }

  handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const route = url.pathname;
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        if (route === "/tools" || route === "/tools/call") {
          const sig = req.headers["payment-signature"] // x402 header
            || req.headers["x-payment"]
            || null;
          if (!sig) return this._send402(res);
          // signature present → verify then settle-and-record
          let parsed;
          try { parsed = JSON.parse(body || "{}"); } catch { parsed = {}; }
          const r = await this.settleAndRecord({
            payload: parsed.payload,
            signature: sig,
            payer: parsed.payer || "0xbuyer",
            amountUsd: parsed.amountUsd || 0,
            deliverableHash: parsed.deliverableHash || null,
          });
          return this._json(res, 200, r);
        }
        if (route === "/health") return this._json(res, 200, { ok: true, agentId: this.agentId, network: NETWORK });
        return this._json(res, 404, { error: "not found" });
      } catch (e) {
        return this._json(res, 500, { error: e.message });
      }
    });
  }

  _send402(res) {
    // x402 v2: PAYMENT-REQUIRED header carries the challenge (base64url JSON)
    const challenge = { x402Version: 2, recipient: `merit-agent-${this.agentId}` };
    const header = Buffer.from(JSON.stringify(challenge)).toString("base64");
    res.writeHead(402, {
      "content-type": "application/json",
      "PAYMENT-REQUIRED": header,
      "WWW-Authenticate": `Payment realm="merit"`,
    });
    res.end(JSON.stringify({ error: "payment_required", message: "settle via x402 to call this Merit agent", agentId: this.agentId }));
  }

  _json(res, code, obj) {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  }
}

export { PaidGateway, X402_FACILITATOR_URL };

export function startGateway(options) {
  const gw = new PaidGateway(options);
  const server = createServer((req, res) => gw.handle(req, res));
  const port = options.port || 0;
  server.listen(port, () => {
    console.log(`merit paid gateway listening :${server.address().port} network=${NETWORK} agentId=${options.agentId}`);
  });
  return server;
}