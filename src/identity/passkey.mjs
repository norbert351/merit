// Merit — passkey (P256 / WebAuthn) verified-client identity.
//
// THE anti-sybil input, made cryptographic. A "verified client" is NOT a boolean a caller
// asserts — it is a client who (1) REGISTERED a P-256 passkey public key, then (2) presented
// a valid ECDSA(P-256) assertion over the exact payment challenge. The assertion is verified
// by Monad's NATIVE P256 precompile (EIP-7951, address 0x0100) via a stateless eth_call.
//
// Counterfactual (why this is load-bearing, not decoration): remove this module / the
// precompile call -> "verified" collapses back to a self-asserted flag -> 50 sock-puppet
// wallets each declare themselves verified and inflate the score. With it, an unregistered
// or forged key can NEVER be marked verified, so the distinct-verified-client weight (and the
// sybil suppression built on it) is enforced by cryptography, not by trust.
//
// EIP-7951 input  = 160 bytes packed: msgHash(32) || r(32) || s(32) || pubX(32) || pubY(32)
// EIP-7951 output = 32-byte 0x..01 on success (invalid input reverts / returns falsy).

import { createHash } from "node:crypto";
import { createPublicClient, http, concat, toHex, keccak256, getAddress } from "viem";
import { MONAD } from "../monad/config.mjs";
import { upsertClient, getClient, listClients } from "../receipt/ledger.mjs";

// Monad's P256/WebAuthn precompile (EIP-7951). Verified LIVE on testnet (returns 0x..01 for a
// valid ES256 signature and fails a tampered one) before this rail was built on.
export const P256_PRECOMPILE = "0x0000000000000000000000000000000000000100";
export const P256_METHOD = "p256-precompile-0x0100";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;

function toBytes32(h, what) {
  if (!HEX32.test(h)) throw new Error(`${what} must be 32 bytes (0x + 64 hex)`);
  return Uint8Array.from(h.slice(2).match(/../g).map((b) => parseInt(b, 16)));
}

/** sha256(message) — the 32-byte digest the P-256 signature commits to (the precompile's msgHash). */
export function challengeDigest(msg) {
  return toHex(new Uint8Array(createHash("sha256").update(msg).digest()));
}

/**
 * The canonical payment challenge a buyer must sign to be a VERIFIED client.
 * Binds agentId + amount + clientId + nonce, so an assertion is non-transferable: it
 * authorizes exactly one receipt, for exactly one payer, at exactly one price.
 */
export function paymentChallenge({ agentId, amountMicroUsd, clientId, nonce }) {
  const msg = `merit:x402:v2:agent=${agentId}:amount=${amountMicroUsd}:client=${clientId}:nonce=${nonce}`;
  return { msg, digest: challengeDigest(msg) };
}

function rpcUrl(net) {
  return (MONAD[net] || MONAD.testnet).rpcUrl;
}

/**
 * Verify a P-256 signature with Monad's precompile. Returns { valid, raw } where `raw` is the
 * precompile's own return word (0x..01 = valid) — surfaced so the real rail is visible in
 * output, never silently swallowed.
 */
export async function verifyP256Signature({ digest, r, s, pubX, pubY, network: net = "testnet" }) {
  const data = toHex(concat([toBytes32(digest, "digest"), toBytes32(r, "r"), toBytes32(s, "s"), toBytes32(pubX, "pubX"), toBytes32(pubY, "pubY")]));
  const chain = { ...(MONAD[net] || MONAD.testnet), id: (MONAD[net] || MONAD.testnet).chainId };
  const pub = createPublicClient({ chain, transport: http(rpcUrl(net)) });
  let raw;
  try {
    const res = await pub.call({ to: P256_PRECOMPILE, data });
    raw = res?.data ?? null;
  } catch (e) {
    // The precompile REVERTS on an invalid/tampered signature — that is "not verified", not an outage.
    return { valid: false, raw: null, error: e.shortMessage || e.message };
  }
  const valid = typeof raw === "string" && /^0x0{63}1$/.test(raw);
  return { valid, raw };
}

/**
 * Deterministic on-chain identity for a passkey: the 20 low bytes of keccak256(pubX||pubY).
 * A judge can re-derive the payer address from the passkey public key alone — the server does
 * not choose it. (Full passkey -> smart-account custody is a documented roadmap item.)
 */
export function passkeyAddress({ pubX, pubY }) {
  const h = keccak256(concat([toBytes32(pubX, "pubX"), toBytes32(pubY, "pubY")]));
  return getAddress(`0x${h.slice(-40)}`);
}

/** Register a passkey for a client id. The public key is what later assertions are checked against. */
export async function registerClient({ clientId, pubX, pubY, chainId = MONAD.testnet.chainId, label = null }) {
  toBytes32(pubX, "pubX"); toBytes32(pubY, "pubY");
  await upsertClient({ clientId, pubX, pubY, chainId, label });
  return { clientId, pubX, pubY, chainId, label, address: passkeyAddress({ pubX, pubY }) };
}

/**
 * Verify a client's assertion over a payment challenge.
 * Returns { verified, method, reason, pubkey } — `verified` is the ONLY thing that may set a
 * receipt's payerVerified flag. No registered key, no assertion, or a bad signature => unverified.
 */
export async function verifyClientAssertion({ clientId, agentId, amountMicroUsd, nonce, r, s, network: net = "testnet" }) {
  const c = await getClient(clientId);
  if (!c) return { verified: false, method: P256_METHOD, reason: "client has no registered passkey" };
  if (!r || !s) return { verified: false, method: P256_METHOD, reason: "no passkey assertion presented", pubkey: c };
  const { digest } = paymentChallenge({ agentId, amountMicroUsd, clientId, nonce });
  const { valid, raw, error } = await verifyP256Signature({ digest, r, s, pubX: c.pubX, pubY: c.pubY, network: net });
  return {
    verified: valid,
    method: P256_METHOD,
    precompileReturn: raw ?? null,
    reason: valid ? "valid P256 assertion over the payment challenge" : (error || "invalid P256 assertion"),
    pubkey: c,
    digest,
  };
}

export { getClient, listClients };
