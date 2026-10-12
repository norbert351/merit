// The receipt graph — the audit trail.
// Every x402-settled call with on-chain err===null writes a receipt bound to the agent's agentId.
// This is the money path: a receipt exists IFF money actually settled, nothing else.
//
// Uses node:sqlite DatabaseSync (the synchronous, stable-in-this-Node API) with a thin
// async wrapper so callers don't block on the event loop for trivial writes.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.MERIT_DB_PATH || join(__dir, "..", "..", "data", "receipts.db");

mkdirSync(dirname(DB_PATH), { recursive: true });

let _db;
function db() {
  if (_db) return _db;
  _db = new DatabaseSync(DB_PATH);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agentId INTEGER NOT NULL,
      payer TEXT NOT NULL,
      payerVerified INTEGER NOT NULL DEFAULT 0,
      amountUsd REAL NOT NULL,
      deliverableHash TEXT,
      outcome TEXT,
      txHash TEXT,
      chainId INTEGER,
      status TEXT NOT NULL,        -- pending | settled | reverted | refused
      verifyMethod TEXT,
      paymentId TEXT,              -- idempotency key; UNIQUE => one trusted receipt per payment
      source TEXT NOT NULL DEFAULT 'demo',  -- demo | seed | live  (seed/demo never trusted)
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_receipts_payment ON receipts(paymentId) WHERE paymentId IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_receipts_agent ON receipts(agentId);

    -- Passkey (P256/WebAuthn) client registry. IMMUTABLE: a clientId is bound ONCE to its
    -- public key and can never be overwritten by a caller who just knows the id. Rotation
    -- requires authorization from the existing registered key (see src/identity/passkey.mjs).
    CREATE TABLE IF NOT EXISTS clients (
      clientId TEXT PRIMARY KEY,
      pubX TEXT NOT NULL,
      pubY TEXT NOT NULL,
      fingerprint TEXT UNIQUE NOT NULL,
      chainId INTEGER,
      label TEXT,
      created_at INTEGER NOT NULL
    );

    -- Server-issued, expiring, single-use challenges (registration + payment). Durable so a
    -- restart does not reset replay protection. Consumed atomically via UPDATE..WHERE consumed=0.
    CREATE TABLE IF NOT EXISTS challenges (
      challengeId TEXT PRIMARY KEY,
      purpose TEXT NOT NULL,       -- register | settle
      clientId TEXT,
      agentId INTEGER,
      amountMicroUsd INTEGER,
      network TEXT,
      nonce TEXT NOT NULL,
      message TEXT NOT NULL,
      expiresAt INTEGER NOT NULL,
      consumed INTEGER NOT NULL DEFAULT 0
    );

    -- Structured audit trail for every payment/identity state transition (read-only evidence).
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL,        -- payment | receipt | client | mandate
      entityId TEXT NOT NULL,
      from_state TEXT,
      to_state TEXT,
      detail TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  // Forward-migrations for older schemas.
  try { _db.exec(`ALTER TABLE receipts ADD COLUMN verifyMethod TEXT`); } catch { /* present */ }
  try { _db.exec(`ALTER TABLE receipts ADD COLUMN paymentId TEXT`); } catch { /* present */ }
  try { _db.exec(`ALTER TABLE receipts ADD COLUMN source TEXT NOT NULL DEFAULT 'demo'`); } catch { /* present */ }
  try { _db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_receipts_payment ON receipts(paymentId) WHERE paymentId IS NOT NULL`); } catch { /* present */ }
  return _db;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function writeReceipt(entry) {
  await sleep(0); // yield
  const stmt = db().prepare(`
    INSERT INTO receipts (agentId, payer, payerVerified, amountUsd, deliverableHash, outcome, txHash, chainId, status, verifyMethod, paymentId, source, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const res = stmt.run(
    entry.agentId ?? 0,
    entry.payer ?? "0x0",
    entry.payerVerified ? 1 : 0,
    entry.amountUsd ?? 0,
    entry.deliverableHash ?? null,
    entry.outcome ?? null,
    entry.txHash ?? null,
    entry.chainId ?? null,
    entry.status ?? "pending",
    entry.verifyMethod ?? null,
    entry.paymentId ?? null,
    entry.source ?? "demo",
    Math.floor(Date.now() / 1000),
  );
  return { id: Number(res.lastInsertRowid) };
}

/** Reconcile: a pending receipt whose tx confirmed becomes settled; a reverted one becomes reverted. */
export async function reconcileReceipt(id, { ok, txHash }) {
  await sleep(0);
  db().prepare(`UPDATE receipts SET status=?, txHash=COALESCE(?,txHash) WHERE id=?`)
    .run(ok ? "settled" : "reverted", txHash ?? null, id);
  return readReceipt(id);
}

export async function readReceipt(id) {
  await sleep(0);
  const row = db().prepare(`SELECT * FROM receipts WHERE id=?`).get(id);
  return row ?? null;
}

export async function receiptsForAgent(agentId) {
  await sleep(0);
  return db().prepare(`SELECT * FROM receipts WHERE agentId=? ORDER BY id ASC`).all(agentId);
}

/** Idempotency guard: has a trusted receipt already been accepted for this paymentId? */
export async function receiptExistsForPayment(paymentId) {
  await sleep(0);
  if (!paymentId) return false;
  return !!db().prepare(`SELECT 1 FROM receipts WHERE paymentId=?`).get(paymentId);
}

// --- Passkey client registry (IMMUTABLE) + challenge store ---------------------------------

/** Register a client's public key. IMMUTABLE: returns {ok:false, reason:'exists'} if the id is taken. */
export async function insertClient({ clientId, pubX, pubY, fingerprint, chainId = null, label = null }) {
  await sleep(0);
  const taken = db().prepare(`SELECT 1 FROM clients WHERE clientId=?`).get(clientId);
  if (taken) return { ok: false, reason: "clientId already registered (immutable)" };
  db().prepare(`
    INSERT INTO clients (clientId, pubX, pubY, fingerprint, chainId, label, created_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(clientId, pubX, pubY, fingerprint, chainId, label, Math.floor(Date.now() / 1000));
  return { ok: true, client: await getClient(clientId) };
}

export async function getClient(clientId) {
  await sleep(0);
  return db().prepare(`SELECT * FROM clients WHERE clientId=?`).get(clientId) ?? null;
}

export async function listClients() {
  await sleep(0);
  return db().prepare(`SELECT * FROM clients ORDER BY created_at ASC`).all();
}

/** Create a server-issued, expiring, single-use challenge. Returns the record. */
export async function createChallenge({ purpose, clientId = null, agentId = null, amountMicroUsd = null, network = null, message }) {
  await sleep(0);
  const challengeId = `${purpose}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const expiresAt = Math.floor(Date.now() / 1000) + 5 * 60; // 5-minute expiry
  db().prepare(`
    INSERT INTO challenges (challengeId, purpose, clientId, agentId, amountMicroUsd, network, nonce, message, expiresAt, consumed)
    VALUES (?,?,?,?,?,?,?,?,?,0)
  `).run(challengeId, purpose, clientId, agentId, amountMicroUsd, network, nonce, message, expiresAt);
  return readChallenge(challengeId);
}

export async function readChallenge(challengeId) {
  await sleep(0);
  return db().prepare(`SELECT * FROM challenges WHERE challengeId=?`).get(challengeId) ?? null;
}

/**
 * Atomically consume a challenge — only succeeds once, only if fresh.
 * Uses the synchronous UPDATE..WHERE guard so two concurrent consumers cannot both win.
 * @returns {boolean} true iff this call was the sole successful consumer.
 */
export async function consumeChallenge(challengeId) {
  await sleep(0);
  const now = Math.floor(Date.now() / 1000);
  const res = db().prepare(`
    UPDATE challenges SET consumed=1
    WHERE challengeId=? AND consumed=0 AND expiresAt>=?
  `).run(challengeId, now);
  return res.changes === 1;
}

/** Append a structured audit event (the read-only evidence trail for state transitions). */
export async function appendAudit({ entity, entityId, from_state = null, to_state = null, detail = null }) {
  await sleep(0);
  db().prepare(`
    INSERT INTO audit_events (entity, entityId, from_state, to_state, detail, created_at)
    VALUES (?,?,?,?,?,?)
  `).run(entity, entityId, from_state, to_state, detail, Math.floor(Date.now() / 1000));
}

export async function auditFor(entity, entityId) {
  await sleep(0);
  return db().prepare(`SELECT * FROM audit_events WHERE entity=? AND entityId=? ORDER BY id ASC`).all(entity, entityId);
}