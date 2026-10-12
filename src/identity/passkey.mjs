// Merit — passkey (P256 / WebAuthn) verified-client identity, HARDENED.
//
// A "verified client" is a client who REGISTERED a P-256 passkey and proves possession of the
// matching private key, then signs each payment challenge with it. The assertion is verified by
// Monad's NATIVE P256 precompile (EIP-7951, address 0x0100) via a stateless eth_call.
//
// Counterfactual (why this is load-bearing): remove this module / the precompile call and
// "verified" collapses to a self-asserted flag -> 50 sock-puppet wallets each declare themselves
// verified and inflate the score. With it, an unregistered or forged key can NEVER be counted.
//
// Hardening (P0 remediation):
//   - Registration is IMMUTABLE and proof-required: a caller cannot overwrite another client's
//     public key by knowing the clientId, and must prove possession of the private key with a
//     server-issued, expiring, single-use challenge before any key is stored.
//   - Payment challenges are SERVER-ISSUED, expiring, single-use and DURABLY recorded (survive an
//     API restart), bound to clientId + agentId + amount + network — replay/expiry are enforced by
//     the ledger, not by an in-memory Set.
//   - No proof of unique-humanness is claimed: a distinct P-256 key is a distinct *key*, which is
//     all the anti-sybil weight needs.
//
// EIP-7951 input  = 160 bytes packed: msgHash(32) || r(32) || s(32) || pubX(32) || pubY(32)
// EIP-7951 output = 32-byte 0x..01 on success (invalid input reverts / returns falsy).

import { createHash } from "node:crypto";
import { createPublicClient, http, concat, toHex, keccak256, getAddress } from "viem";
import { MONAD } from "../monad/config.mjs";
import {
  insertClient, getClient, listClients, createChallenge, readChallenge, consumeChallenge,
} from "../receipt/ledger.mjs";

export const P256_PRECOMPILE = "0x0000000000000000000000000000000000000100";
export const P256_METHOD = "p256-precompile-0x0100";
export const CHALLENGE_TTL_S = 300; // 5 minutes

const HEX32 = /^0x[0-9a-fA-F]{64}$/;

function toBytes32(h, what) {
  if (!HEX32.test(h)) throw new Error(`${what} must be 32 bytes (0x + 64 hex)`);
  return Uint8Array.from(h.slice(2).match(/../g).map((b) => parseInt(b, 16)));
}

/** sha256(message) — the 32-byte digest the P-256 signature commits to (the precompile's msgHash). */
export function challengeDigest(msg) {
  return toHex(new Uint8Array(createHash("sha256").update(msg).digest()));
}

/** Canonical, deterministic public-key fingerprint (keccak256(pubX||pubY)). */
export function pubFingerprint({ pubX, pubY }) {
  return keccak256(concat([toBytes32(pubX, "pubX"), toBytes32(pubY, "pubY")]));
}

/** Deterministic on-chain identity for a passkey: the 20 low bytes of keccak256(pubX||pubY). */
export function passkeyAddress({ pubX, pubY }) {
  return getAddress(`0x${pubFingerprint({ pubX, pubY }).slice(-40)}`);
}

function rpcUrl(net) {
  return (MONAD[net] || MONAD.testnet).rpcUrl;
}

/**
 * Verify a P-256 signature with Monad's precompile. Returns { valid, raw } where `raw` is the
 * precompile's own return word (0x..01 = valid) — surfaced so the real rail is visible.
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
    // The precompile REVERTS on a tampered signature — that is "not verified", not an outage.
    return { valid: false, raw: null, error: e.shortMessage || e.message };
  }
  const valid = typeof raw === "string" && /^0x0{63}1$/.test(raw);
  return { valid, raw };
}

// ---------------------------------------------------------------------------
// Registration — proof-of-possession + immutable key binding.
// ---------------------------------------------------------------------------

/** Issue a server-issued, expiring, single-use registration challenge. */
export async function createRegistrationChallenge({ clientId }) {
  const message = `merit:passkey:register:${clientId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
  return createChallenge({ purpose: "register", clientId, message });
}

/**
 * Register a client's P-256 key. Requires proof of possession: a signature over the fresh,
 * single-use registration challenge verified against the proposed key via the precompile.
 * Registration is IMMUTABLE — a taken clientId can never be overwritten.
 */
export async function registerClient({ clientId, pubX, pubY, challengeId, r, s, network: net = "testnet", label = null }) {
  toBytes32(pubX, "pubX"); toBytes32(pubY, "pubY");
  const challenge = challengeId ? await readChallenge(challengeId) : null;
  if (!challenge) return { ok: false, reason: "challenge not found" };
  if (challenge.purpose !== "register") return { ok: false, reason: "wrong challenge purpose" };
  if ((challenge.clientId ?? null) !== clientId) return { ok: false, reason: "challenge bound to another clientId" };
  const consumed = await consumeChallenge(challengeId);
  if (!consumed) return { ok: false, reason: "challenge expired or already used" };
  if (!r || !s) return { ok: false, reason: "no proof-of-possession signature" };
  const digest = challengeDigest(challenge.message);
  const { valid, raw } = await verifyP256Signature({ digest, r, s, pubX, pubY, network: net });
  if (!valid) return { ok: false, reason: "proof-of-possession failed (signature does not match proposed key)", precompileReturn: raw };

  const chainId = (MONAD[net] || MONAD.testnet).chainId;
  const inserted = await insertClient({ clientId, pubX, pubY, fingerprint: pubFingerprint({ pubX, pubY }), chainId, label });
  if (!inserted.ok) return inserted;
  return { ok: true, client: { ...inserted.client, address: passkeyAddress({ pubX, pubY }) } };
}

// ---------------------------------------------------------------------------
// Payment challenge — server-issued, bound, single-use.
// ---------------------------------------------------------------------------

/** Issue a server-issued payment challenge bound to client + agent + amount + network. */
export async function createPaymentChallenge({ clientId, agentId, amountMicroUsd, network }) {
  const message = `merit:settle:${clientId}:${agentId}:${amountMicroUsd}:${network}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
  return createChallenge({ purpose: "settle", clientId, agentId, amountMicroUsd, network, message });
}

/**
 * Verify a client's assertion over a server-issued payment challenge.
 * Consumes the challenge once and atomically. `verified` is the ONLY thing that may set a
 * receipt's payerVerified flag.
 */
export async function verifyClientAssertion({ challengeId, clientId, r, s, network: net = "testnet" }) {
  const challenge = challengeId ? await readChallenge(challengeId) : null;
  if (!challenge) return { verified: false, method: P256_METHOD, reason: "challenge not found" };
  if (challenge.purpose !== "settle") return { verified: false, method: P256_METHOD, reason: "wrong challenge purpose" };
  if (challenge.clientId !== clientId) return { verified: false, method: P256_METHOD, reason: "challenge bound to another clientId" };
  const consumed = await consumeChallenge(challengeId);
  if (!consumed) return { verified: false, method: P256_METHOD, reason: "challenge expired or already used (replay blocked)" };
  const c = await getClient(clientId);
  if (!c) return { verified: false, method: P256_METHOD, reason: "client has no registered passkey", consumed };
  if (!r || !s) return { verified: false, method: P256_METHOD, reason: "no passkey assertion presented", pubkey: c };
  const digest = challengeDigest(challenge.message);
  const { valid, raw } = await verifyP256Signature({ digest, r, s, pubX: c.pubX, pubY: c.pubY, network: net });
  return {
    verified: valid,
    method: P256_METHOD,
    precompileReturn: raw ?? null,
    reason: valid ? "valid P256 assertion over the payment challenge" : "invalid P256 assertion",
    pubkey: c,
    digest,
    binding: { agentId: challenge.agentId, amountMicroUsd: challenge.amountMicroUsd, network: challenge.network },
  };
}

export { getClient, listClients };