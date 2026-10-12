# Merit — Security Audit (Monad Metropolis Track 04)

Audit type: **source-level + threat model + adversarial tests**. Scope: `src/`, `contracts/`,
`indexer/`, `test/`, `public/`, deployment config. Performed 2026-10-12 against the
`security-remediation` branch. **This is an engineering security review, not a formal certification.**

## Trust boundaries

```
 Browser (untrusted)                 Server (Merit API, trusted)            Monad testnet (trusted, but isolated)
  - passkey private key              - verifies P256 via precompile        - MeritIdentity / MeritReputation / MeritMandate
  - clientId (self-chosen)           - verifies facilitator signature      - GuardedWallet (execution-boundary mandate)
  - PAYMENT-SIGNATURE                - SETS payerVerified ONLY on proof     - x402 facilitator (external, semi-trusted)
  - paymentId (idempotency key)      - persists ledger + challenges          - Envio indexer (bounty, read-only re-derive)
```

Assets: agent scores (must be buyable-proof), passkey identity (must be non-hijackable), the
mandate authority cap (must be truly enforced). Adversaries: sock-puppet/sybil wallets, an attacker
who knows a victim `clientId`, a spender trying to exceed a mandate, a forged/failed payer.

## Confirmed issues → fixes (traceability)

| # | Severity | Issue | Where | Fix | Regression test |
|---|---|---|---|---|---|
| 1 | **P0** | `/api/passkey/register` UPSERTED a client's public key — an attacker knowing a `clientId` could overwrite the victim's key. No proof-of-possession. | `src/receipt/ledger.mjs` (was `upsertClient`), `src/identity/passkey.mjs`, `src/api/server.mjs` | Registration is now **immutable** + requires a server-issued challenge signed by the proposed key (PoP verified via the `0x0100` precompile) | `test/passkey.test.mjs` ("attacker CANNOT replace…", "requires proof of possession") |
| 2 | **P0** | Challenges were client-issued (`nonce` in body) and replay-guarded by an **in-memory Set** that reset on restart; no expiry, no binding to agent/amount/network. | `src/api/server.mjs`, `passkey.mjs` | Server-issued, **expiring (5-min), single-use, durably stored** challenges bound to clientId+agentId+amount+network; consumed atomically via `UPDATE..WHERE consumed=0`, survives restart | `test/passkey.test.mjs` ("single-use across replays") |
| 3 | **P0** | `MeritMandate.enforce` was **advisory** (`allowed` bool) — nothing stopped a real transfer. | `contracts/src/MeritMandate.sol` (unchanged as the checker), **NEW** `contracts/src/GuardedWallet.sol` | A minimal **guarded-wallet** OWNS funds and reverts any transfer exceeding the agent's EARNED on-chain score (per-tx + cumulative-per-period), reading the live `MeritReputation` at execution time; fails closed if score is unavailable/agent unregistered | `contracts/test/GuardedWallet.t.sol` (9 tests) + **live on testnet**: allowed 100 wei moved on-chain; over-cap 20M wei **reverted** |
| 4 | **P0** | Settle path treated a facilitator `200` + client `signature` as proof; no state machine, no idempotency, fail-open on timeout/RPC error. | `src/api/server.mjs`, `src/receipt/ledger.mjs` | `src/payments/verify.mjs` **PaymentVerifier**: explicit `CREATED→…→RECEIPT_ACCEPTED` states + `UNVERIFIED/REFUSED`; **fail-closed** on missing/invalid/failed/timeout facilitator/RPC; wrong recipient/network rejected; **unique `paymentId`** → exactly one trusted receipt per payment; structured audit events; demo receipts tagged `source=demo` and never trusted | `test/security.test.mjs` |
| 5 | **P1** | Seeded demo receipts lived in the same ledger and were scored by the same engine. | `src/api/server.mjs` (`ensureSeeded`, `agentView`) | `source` column (`seed`/`demo`/`live`); `agentView.trustedScore` derives ONLY from `source=live` or the on-chain read; demo/seed rows only move a labelled demo score | `test/security.test.mjs` ("seeded… never feed the TRUSTED score") |
| 6 | **P1** | `registerAgent` returned `agentId: txHash` (wrong) and used a raw private-key string for the wallet. | `src/monad/erc8004.mjs` | `privateKeyToAccount` (correct viem account) + parse the **real** `agentId` from the `Registered` event `topics[1]`; fail loudly if the event is absent | (unit verified by inspection; network-gated) |
| 7 | **P1** | Reputation parity: the JS model is USD while `MeritReputation.scoreOf` is micro-USD; `scoreAfter` emitted was `effSettled`, not the full score. | contracts + `src/reputation/onchain-score.mjs`, `indexer/src/EventHandlers.ts` | Documented unit split; indexer now reconstructs the **canonical** score (`effSettled + distinctVerified*5*SCALE`) and fixes the `- BigInt(0)` no-op + accumulation bug | `test/security.test.mjs` ("JS model reproduces on-chain score") |
| 8 | **P1** | Indexer `EventHandlers.ts` had `- BigInt(0)` no-op and a non-accumulating `effectivelySettledUsd`. | `indexer/src/EventHandlers.ts` | Removed no-op; deterministic accumulation + distinct-verified dedup via the indexed graph; idempotent (tx-log keyed) | (needs `envio codegen`/deploy — bounty layer) |
| 9 | **P1** | No request-size bounds, no rate limits, oversized bodies, generic 500. | `src/api/server.mjs` | `MAX_BODY` cap (413), per-IP rate limits on `passkey/*` + `settle`, error `status` honored | (inspection + live) |

## Residual risk / honest limits
- **No claim of unique-humanness**: a distinct P-256 key is a distinct *key*, not proof of a unique person. Sybil resistance is against cheap *duplicate* identities, stated accurately.
- **GuardedWallet scope**: a minimal testnet guarded-wallet prototype (native-token only, admin-set conversion rate, single authorized executor). It does not wrap arbitrary ERC-20/token routers or multi-executor policies; ownership/admin roles are explicit and admin-only.
- **Facilitator semantics**: the on-chain *transfer* confirmation (`confirmSettlement`) is implemented and tests pass; the live facilitator's relayed-transfer log verification is governed by its response schema during actual settlement, documented in `INTEGRATIONS.md`.
- **Indexer**: config + handlers corrected, but `envio deploy` (hosting) is not run here (no `ENVIO_API_TOKEN`) — the indexed graph is a clearly-labelled bounty layer; the **authoritative** score is always on-chain `scoreOf`.
- **ERC-8004 mainnet registration** remains a documented ⚠️ (needs a funded mainnet wallet); the testnet suite uses clearly-named local adapters, not the canonical registry.
- **Rate limits are in-memory** (restart resets them) — acceptable for a testnet demo; a persistent limiter is roadmap.
- No formal third-party audit performed; automated solc compile + Foundry tests + adversarial JS tests are the verification used.

## Baseline → after
- Baseline: 27/27 JS, 8/8 contracts.
- After: **34/34 JS, 17/17 contracts** (added passkey PoP/replay/immutability/adversarial, payment fail-closed, score parity, demo-isolation, guarded-wallet).
- Live testnet: `GuardedWallet` deployed and execution-boundary enforcement demonstrated (allowed transfer moved on-chain; over-cap reverted).

See `REMEDIATION_REPORT.md` for the full definition-of-done checklist (PASS/FAIL/BLOCKED).