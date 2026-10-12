// Passkey (P-256 / WebAuthn) verified-client identity — the anti-sybil rail of Merit.
//
// The cryptographic tests run against Monad's LIVE P256 precompile (EIP-7951, 0x0100) — the same
// rail the deployed product uses. They are skipped (not faked) when the RPC is unreachable, so a
// green run never claims a rail it did not exercise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MERIT_DB_PATH = join(mkdtempSync(join(tmpdir(), "merit-passkey-")), "receipts.db");
delete process.env.MERIT_EXECUTOR_KEY;

const { paymentChallenge, challengeDigest, passkeyAddress, registerClient, verifyClientAssertion, getClient, P256_METHOD } =
  await import("../src/identity/passkey.mjs");
const { generatePasskey } = await import("../src/identity/passkey-client.mjs");

// Probe the RPC once so the live tests can skip honestly instead of failing on a cold network.
const RPC = process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz";
let ONLINE = false;
try {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, signal: ctrl.signal, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
  const j = await res.json();
  ONLINE = j?.result === "0x279f"; // 10143
  clearTimeout(t);
} catch { ONLINE = false; }

const skip = ONLINE ? false : `Monad testnet RPC unreachable (${RPC})`;

test("passkey — the payment challenge is deterministic and binds agent+amount+client+nonce", () => {
  const a = paymentChallenge({ agentId: 1, amountMicroUsd: 1000000, clientId: "c1", nonce: "n1" });
  const b = paymentChallenge({ agentId: 1, amountMicroUsd: 1000000, clientId: "c1", nonce: "n1" });
  const c = paymentChallenge({ agentId: 1, amountMicroUsd: 1000000, clientId: "c1", nonce: "n2" });
  assert.equal(a.msg, b.msg);
  assert.equal(a.digest, b.digest);
  assert.notEqual(a.digest, c.digest, "changing the nonce changes the signed digest");
  assert.match(a.digest, /^0x[0-9a-f]{64}$/);
  assert.equal(challengeDigest(a.msg), a.digest);
});

test("passkey — a client's on-chain identity is DERIVED from the public key, not chosen", () => {
  const k = { pubX: "0x" + "11".repeat(32), pubY: "0x" + "22".repeat(32) };
  assert.equal(passkeyAddress(k), passkeyAddress({ ...k }));
  assert.match(passkeyAddress(k), /^0x[0-9a-fA-F]{40}$/);
  assert.notEqual(passkeyAddress(k), passkeyAddress({ pubX: "0x" + "33".repeat(32), pubY: k.pubY }));
});

test("passkey — registration stores the public key (and rejects malformed ones)", async () => {
  const pk = await generatePasskey();
  const reg = await registerClient({ clientId: "client-unit", pubX: pk.pubX, pubY: pk.pubY });
  assert.match(reg.address, /^0x[0-9a-fA-F]{40}$/);
  const stored = await getClient("client-unit");
  assert.equal(stored.pubX, pk.pubX);
  await assert.rejects(() => registerClient({ clientId: "bad", pubX: "0x1234", pubY: pk.pubY }), /pubX must be 32 bytes/);
});

test("passkey — Monad's P256 precompile VERIFIES a real passkey assertion", { skip }, async () => {
  const pk = await generatePasskey();
  const clientId = "live-verified-client";
  await registerClient({ clientId, pubX: pk.pubX, pubY: pk.pubY });

  const { msg } = paymentChallenge({ agentId: 1, amountMicroUsd: 1000000, clientId, nonce: "live-1" });
  const { r, s } = await pk.sign(msg);
  const vr = await verifyClientAssertion({ clientId, agentId: 1, amountMicroUsd: 1000000, nonce: "live-1", r, s, network: "testnet" });
  assert.equal(vr.verified, true, "a valid ES256 assertion verifies against 0x0100");
  assert.equal(vr.method, P256_METHOD);
  assert.match(vr.precompileReturn, /^0x0{63}1$/, "the precompile's own return word is surfaced (0x..01)");
});

test("passkey — a FORGED assertion is refused (the sock-puppet cannot self-declare verified)", { skip }, async () => {
  const pk = await generatePasskey();
  const clientId = "live-forgery-attempt";
  await registerClient({ clientId, pubX: pk.pubX, pubY: pk.pubY });
  const { msg } = paymentChallenge({ agentId: 1, amountMicroUsd: 1000000, clientId, nonce: "live-2" });
  const { r, s } = await pk.sign(msg);
  // flip one byte of s -> the signature no longer commits to the challenge
  const badS = "0x" + s.slice(2, -2) + (s.slice(-2) === "ff" ? "00" : "ff");
  const vr = await verifyClientAssertion({ clientId, agentId: 1, amountMicroUsd: 1000000, nonce: "live-2", r, s: badS, network: "testnet" });
  assert.equal(vr.verified, false, "a tampered signature must NOT verify");
});

test("passkey — an UNREGISTERED client can never be verified", async () => {
  const pk = await generatePasskey();
  const { msg } = paymentChallenge({ agentId: 1, amountMicroUsd: 1000000, clientId: "ghost", nonce: "g1" });
  const { r, s } = await pk.sign(msg);
  const vr = await verifyClientAssertion({ clientId: "ghost", agentId: 1, amountMicroUsd: 1000000, nonce: "g1", r, s, network: "testnet" });
  assert.equal(vr.verified, false);
  assert.match(vr.reason, /no registered passkey/);
});
