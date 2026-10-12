// Merit — client-side passkey helper (what a browser WebAuthn / hardware key does).
//
// Generates a P-256 key, exposes the public key (pubX,pubY) for registration, and signs a
// challenge message with ES256 (raw r||s, the format the EIP-7951 precompile expects). This is
// the SAME client the "verified payer" demo and the live tests drive, so the rail is exercised
// end to end, not simulated. A real WebAuthn authenticator replaces this with:
//   navigator.credentials.create()/get() -> assertion.signature (DER) -> { r, s }.
import { webcrypto as crypto } from "node:crypto";
import { toHex } from "viem";

const b64u = (u8) => Buffer.from(u8).toString("base64url");

/** Generate a P-256 passkey. */
export async function generatePasskey() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)); // 0x04 || X(32) || Y(32)
  const pubX = raw.slice(1, 33), pubY = raw.slice(33, 65);
  return {
    pubX: toHex(pubX),
    pubY: toHex(pubY),
    jwk: { kty: "EC", crv: "P-256", x: b64u(pubX), y: b64u(pubY), ext: true },
    /** Sign a challenge message with ES256 -> raw { r, s } (64 bytes, P1363). */
    async sign(message) {
      const bytes = new TextEncoder().encode(message);
      const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, bytes));
      return { r: toHex(sig.slice(0, 32)), s: toHex(sig.slice(32, 64)) };
    },
  };
}

/** Local ES256 assertion check over a RAW message (browser/WebAuthn side) — cross-check only. */
export async function localVerify({ jwk, message, r, s }) {
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const sig = Uint8Array.from((r + s).replace(/^0x/, "").match(/../g).map((b) => parseInt(b, 16)));
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, new TextEncoder().encode(message));
}
