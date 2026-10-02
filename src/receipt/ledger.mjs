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
      status TEXT NOT NULL,        -- pending | settled | reverted
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_receipts_agent ON receipts(agentId);
  `);
  return _db;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function writeReceipt(entry) {
  await sleep(0); // yield
  const stmt = db().prepare(`
    INSERT INTO receipts (agentId, payer, payerVerified, amountUsd, deliverableHash, outcome, txHash, chainId, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
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