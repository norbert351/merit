// Passkey (P-256 / WebAuthn) verified-client identity — anti-sybil rail of Merit (HARDENED).
// Covers proof-of-possession registration, immutable key binding, and server-issued single-use
// expiring challenges. The cryptographic tests run against Monad's LIVE P256 precompile (EIP-7951,
// 0x0100) — the same rail the deployed product uses — and skip (never fake) when the RPC is down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MERIT_DB_PATH = join(mkdtempSync(join(tmpdir(), "merit-passkey-")), "receipts.db");
delete process.env.MERIT_EXECUTOR_KEY;

const {
  challengeDigest, passkeyAddress, pubFingerprint, registerClient, verifyClientAssertion,
  createRegistrationChallenge, createPaymentChallenge, getClient, P256_METHOD,
} = await import("../src/identity/passkey.mjs");
const { generatePasskey } = await import("../src/identity/passkey-client.mjs");

const RPC = process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz";
let ONLINE = false;
try {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, signal: ctrl.signal, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
  const j = await res.json();
  ONLINE = j?.result === "0x279f";
  clearTimeout(t);
} catch { ONLINE = false; }
const skip = ONLINE ? false : `Monad testnet RPC unreachable (${RPC})`;

const CLIENT = "live-client";

test("passkey — challenge digest is deterministic sha256", () => {
  assert.equal(challengeDigest("merit:test"), challengeDigest("merit:test"));
  assert.match(challengeDigest("merit:test"), /^0x[0-9a-f]{64}$/);
});

test("passkey — identity + fingerprint are DETERMINISTIC from the public key", () => {
  const k = { pubX: "0x" + "11".repeat(32), pubY: "0x" + "22".repeat(32) };
  assert.equal(passkeyAddress(k), passkeyAddress({ ...k }));
  assert.equal(pubFingerprint(k), pubFingerprint({ ...k }));
  assert.match(passkeyAddress(k), /^0x[0-9a-fA-F]{40}$/);
});

test("passkey — registration requires proof of possession of the private key", { skip }, async () => {
  const pk = await generatePasskey();
  // No signature on a fresh challenge => PoP fails
  const noSigCh = await createRegistrationChallenge({ clientId: CLIENT });
  const noSig = await registerClient({ clientId: CLIENT, pubX: pk.pubX, pubY: pk.pubY, challengeId: noSigCh.challengeId, r: null, s: null });
  assert.equal(noSig.ok, false, "no proof of possession must be rejected");
  // Correct signature over a FRESH challenge with the matching private key => ok
  const { challengeId, message } = await createRegistrationChallenge({ clientId: CLIENT });
  const sig = await pk.sign(message);
  const ok = await registerClient({ clientId: CLIENT, pubX: pk.pubX, pubY: pk.pubY, challengeId, r: sig.r, s: sig.s });
  assert.equal(ok.ok, true);
  assert.match(ok.client.address, /^0x[0-9a-fA-F]{40}$/);
  assert.equal((await getClient(CLIENT)).pubX, pk.pubX);
});

test("passkey — an attacker CANNOT replace another client's key by knowing its clientId", { skip }, async () => {
  const victim = await generatePasskey();
  const rc = await createRegistrationChallenge({ clientId: "victim" });
  const rsig = await victim.sign(rc.message);
  await registerClient({ clientId: "victim", pubX: victim.pubX, pubY: victim.pubY, challengeId: rc.challengeId, r: rsig.r, s: rsig.s });
  // attacker knows only the clientId, has its own key + a fresh challenge
  const attacker = await generatePasskey();
  const ac = await createRegistrationChallenge({ clientId: "victim" });
  const asig = await attacker.sign(ac.message);
  const hijack = await registerClient({ clientId: "victim", pubX: attacker.pubX, pubY: attacker.pubY, challengeId: ac.challengeId, r: asig.r, s: asig.s });
  assert.equal(hijack.ok, false, "re-registering an existing clientId must be refused (immutable)");
  assert.match(hijack.reason, /already|immutable/i);
  // the victim's original key is still on file
  assert.equal((await getClient("victim")).pubX, victim.pubX);
});

test("passkey — a registration challenge is single-use (replay is refused)", { skip }, async () => {
  const pk = await generatePasskey();
  const c2 = "replay-client";
  const { challengeId, message } = await createRegistrationChallenge({ clientId: c2 });
  const sig = await pk.sign(message);
  const first = await registerClient({ clientId: c2, pubX: pk.pubX, pubY: pk.pubY, challengeId, r: sig.r, s: sig.s });
  assert.equal(first.ok, true);
  const replay = await registerClient({ clientId: c2, pubX: pk.pubX, pubY: pk.pubY, challengeId, r: sig.r, s: sig.s });
  assert.equal(replay.ok, false, "reusing a consumed challenge must be refused");
  assert.match(replay.reason, /expired|already used/i);
});

test("passkey — a payment challenge is single-use across replays", { skip }, async () => {
  const pk = await generatePasskey();
  const c3 = "pay-client";
  const rc = await createRegistrationChallenge({ clientId: c3 });
  const rsig = await pk.sign(rc.message);
  await registerClient({ clientId: c3, pubX: pk.pubX, pubY: pk.pubY, challengeId: rc.challengeId, r: rsig.r, s: rsig.s });
  const pc = await createPaymentChallenge({ clientId: c3, agentId: 1, amountMicroUsd: 1_000_000, network: "testnet" });
  const sig = await pk.sign(pc.message);
  assert.equal((await verifyClientAssertion({ challengeId: pc.challengeId, clientId: c3, r: sig.r, s: sig.s })).verified, true, "valid challenge signature verifies against 0x0100");
  const replay = await verifyClientAssertion({ challengeId: pc.challengeId, clientId: c3, r: sig.r, s: sig.s });
  assert.equal(replay.verified, false, "reusing the same payment challenge is blocked");
  assert.match(replay.reason, /expired|already used/i);
});

test("passkey — a signature from ANOTHER client is rejected", { skip }, async () => {
  const attacker = await generatePasskey();
  const pcz = await createPaymentChallenge({ clientId: "victim", agentId: 1, amountMicroUsd: 1_000_000, network: "testnet" });
  const sig = await attacker.sign(pcz.message); // attacker's key, not the victim's registered key
  const v = await verifyClientAssertion({ challengeId: pcz.challengeId, clientId: "victim", r: sig.r, s: sig.s });
  assert.equal(v.verified, false, "a signature from the wrong client must not verify");
});

test("passkey — Monad's P256 precompile VERIFIES a valid assertion and refuses a forged one", { skip }, async () => {
  const pk = await generatePasskey();
  const cForge = "forge-client";
  const rc = await createRegistrationChallenge({ clientId: cForge });
  const rsig = await pk.sign(rc.message);
  await registerClient({ clientId: cForge, pubX: pk.pubX, pubY: pk.pubY, challengeId: rc.challengeId, r: rsig.r, s: rsig.s });
  const pc = await createPaymentChallenge({ clientId: cForge, agentId: 1, amountMicroUsd: 1_000_000, network: "testnet" });
  const { r, s } = await pk.sign(pc.message);
  const good = await verifyClientAssertion({ challengeId: pc.challengeId, clientId: cForge, r, s });
  assert.equal(good.verified, true);
  const badS = "0x" + s.slice(2, -2) + (s.slice(-2) === "ff" ? "00" : "ff");
  const pc2 = await createPaymentChallenge({ clientId: cForge, agentId: 1, amountMicroUsd: 1_000_000, network: "testnet" });
  const forged = await verifyClientAssertion({ challengeId: pc2.challengeId, clientId: cForge, r, s: badS });
  assert.equal(forged.verified, false, "a tampered signature must NOT verify");
});

test("passkey — an UNREGISTERED client can never verify a payment challenge", { skip }, async () => {
  const ghost = await generatePasskey();
  const pc = await createPaymentChallenge({ clientId: "ghost", agentId: 1, amountMicroUsd: 1_000_000, network: "testnet" });
  const sig = await ghost.sign(pc.message);
  const v = await verifyClientAssertion({ challengeId: pc.challengeId, clientId: "ghost", r: sig.r, s: sig.s });
  assert.equal(v.verified, false);
  assert.match(v.reason, /no registered passkey/);
});