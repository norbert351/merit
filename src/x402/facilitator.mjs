// Monad x402 v2 facilitator client — the settlement primitive that produces receipts.
// Verified live: https://x402-facilitator.molandak.org/supported returns exact/upto/batch-settlement,
// x402Version 2, on both eip155:10143 (testnet) and eip155:143 (mainnet).
// Role on the SELLER side: verify a buyer's PAYMENT-SIGNATURE, then settle via facilitator.

import { X402_FACILITATOR_URL } from "../monad/config.mjs";

export class FacilitatorClient {
  constructor({ url = X402_FACILITATOR_URL, chainId } = {}) {
    this.url = url;
    this.chainId = chainId;
  }

  async supported() {
    const res = await fetch(`${this.url}/supported`);
    if (!res.ok) throw new Error(`facilitator /supported ${res.status}`);
    return res.json();
  }

  /** Find an x402 v2 scheme for the requested network. */
  async pickScheme(chainId) {
    const s = await this.supported();
    const net = `eip155:${chainId}`;
    const kind = s.kinds.find((k) => k.network === net && k.x402Version === 2);
    if (!kind) throw new Error(`no x402 v2 kind for ${net}`);
    return { kind, signer: (s.signers && s.signers[net]) || [] };
  }

  /**
   * Verify a buyer's X-PAYMENT / PAYMENT-SIGNATURE against the facilitator.
   * Returns { isValid, details }. Only a VERIFIED signature proceeds to settle.
   */
  async verify({ payload, signature, chainId }) {
    const res = await fetch(`${this.url}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload, signature, chainId }),
    });
    if (!res.ok) {
      throw Object.assign(new Error(`facilitator /verify ${res.status}`), { status: res.status });
    }
    return res.json();
  }

  /**
   * Settle a verified payment through the facilitator (they relay/broadcast and cover gas).
   * Returns { success, txHash } — callers MUST re-confirm the tx on-chain (err===null discipline).
   */
  async settle({ payload, signature, chainId }) {
    const res = await fetch(`${this.url}/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload, signature, chainId }),
    });
    if (!res.ok) {
      throw Object.assign(new Error(`facilitator /settle ${res.status}`), { status: res.status });
    }
    return res.json();
  }
}