# Merit — Remediation Report

Branch: `security-remediation` (not pushed). Date: 2026-10-12. Baseline: 27 JS / 8 contract tests →
After: **34 JS / 17 contract tests, all passing.** Live testnet: guarded-wallet enforcement proven.

## Executive summary
The build was a working, demoable sybil-resistant reputation, but four claims were weaker than the
docs implied: (1) the verified-client flag could be **self-asserted** and a passkey key could be
**replaced by knowing a clientId**; (2) challenges were client-issued with an in-memory replay set;
(3) the mandate was **advisory** — nothing stopped a real transfer; (4) the payment path trusted a
signature/200 without a state machine or idempotency. All four are fixed, tested, and (for the
mandate) **proven live on Monad testnet**. The headline result is a real execution-boundary guard:
a transfer exceeding the agent's earned score **reverts on-chain**.

## Files changed (why)
- **NEW** `src/payments/verify.mjs` — fail-closed payment state machine (facilitator/RPC/settlement).
- **NEW** `src/identity/passkey.mjs` (rewritten) — proof-of-possession + immutable binding + server-issued single-use challenges.
- **NEW** `contracts/src/GuardedWallet.sol` + `contracts/test/GuardedWallet.t.sol` + `scripts/DeployGuarded.s.sol` — execution-boundary mandate enforcement.
- `src/receipt/ledger.mjs` — `source`, `paymentId` (unique), immutable clients, durable `challenges`, `audit_events`.
- `src/api/server.mjs` — hardened `/api/passkey/*` + `/api/settle`; trusted-vs-demo score separation; bounded bodies; rate limits.
- `src/gateway/server.mjs` — challenge-based verification (removed the bypassable signature path).
- `src/monad/erc8004.mjs` — real `privateKeyToAccount` + real `agentId` from the `Registered` event.
- `indexer/src/EventHandlers.ts` — canonical-score reconstruction, no-op + accumulation fixes.
- `src/index.mjs`, `scripts/settle-demo.mjs`, `test/*` — updated to the hardened flows + new tests.
- Docs: `SECURITY_AUDIT.md`, `THREAT_MODEL.md`, `TESTING.md`, `DEPLOYMENT_MONAD_TESTNET.md`, `INTEGRATIONS.md`, `REMEDIATION_REPORT.md`.

## Vulnerabilities fixed
P0 #1 key-replacement/no-PoP · P0 #2 client-issued/non-durable challenges · P0 #3 advisory mandate →
guarded wallet · P0 #4 unverified/fail-open payment path. P1: demo-data isolation, ERC-8004 agentId,
indexer correctness, reputation parity, API hardening. (Detail + reproduction: `SECURITY_AUDIT.md`.)

## Tests actually executed (real results)
- `npm test` → **34 passed / 0 failed** (passkey precompile tests ran live, not skipped).
- `forge test` → **17 passed / 0 failed** (8 Merit + 9 GuardedWallet).
- `scripts/settle-demo.mjs` → valid passkey `verified:true`; forged `verified:false`; challenge replay + duplicate paymentId blocked.

## Contract deployment & live evidence
- GuardedWallet deployed `0x357010738b21724639eb427c52B99a3eFb8Fa1Cd` (tx `0xfb1b7e51…`, status 1).
- Live: agent 1 score $21 → cap $0 → `execute` **reverts**; after a verified $45 settlement (score $71,
  cap $10) an under-cap `execute(100 wei)` **moved funds on-chain** (`spent()`=200, dest +200) while an
  over-cap `execute(20,000,000 wei)` **reverted** (dest unchanged). See `DEPLOYMENT_MONAD_TESTNET.md`.

## Static analysis
`forge build` clean (solc 0.8.24, optimizer + via_ir). Slither not installed here (documented). Not a formal audit.

## Remaining blockers / residual risk
- Canonical **mainnet ERC-8004** registration — needs a funded mainnet wallet (**BLOCKED**, documented ⚠️).
- `envio deploy` (hosted indexer) — needs `ENVIO_API_TOKEN` (**BLOCKED**; bounty layer only).
- Public **deploy URL** — needs the Render dashboard / a DNS record (**BLOCKED** on operator action).
- GuardedWallet scope is a minimal native-token prototype (single executor; admin-set rate).
- Rate limits are in-memory; distinct passkey ≠ distinct human (stated).

## Definition-of-done checklist
| Criterion | Status |
|---|---|
| No client-supplied signature/status manufactures a trusted receipt | **PASS** |
| Successful verified settlement ⇒ exactly one receipt | **PASS** |
| Replay + concurrent-request tests | **PASS** |
| Unauthorized key replacement prevented | **PASS** |
| Challenges expiring/single-use/bound; restart-safe replay protection | **PASS** |
| JS ↔ Solidity reputation consistency | **PASS** |
| Indexer agrees with on-chain score | **PASS (unit/design)** · **BLOCKED (hosted deploy)** |
| Duplicate receipts/payers cannot inflate per policy | **PASS** |
| Demo receipts cannot affect trusted reputation | **PASS** |
| Guard controls ACTUAL execution; excess spending REVERTS | **PASS (live testnet)** |
| Cumulative spending not bypassable via small calls | **PASS** |
| Unauthorized/revoked agents cannot execute | **PASS** |
| All Foundry tests pass; ownership/admin explicit | **PASS** |
| End-to-end testnet flow functional; failures surfaced; secrets not exposed | **PASS** |
| Clean indexer rebuild deterministic + parity tested | **PASS (local)** · **BLOCKED (deploy)** |
| Judge-ready demonstration reproducible | **PASS** |

## Judge-facing description (updated)
> Merit is payment-backed reputation and enforceable authority for autonomous agents on Monad.
> An agent earns a score only from **real, settled x402 payments by distinct passkey-verified
> clients**; fake dust clusters are zeroed. That score is **enforced** — a guarded wallet reverts any
> transfer that exceeds the authority the agent actually earned. Verified identity is cryptographic
> (P-256 passkey → Monad's `0x0100` precompile), receipts are idempotent and fail closed, and the
> score is re-derivable on-chain.

## Reproduce
```bash
npm install && npm test            # 34 JS tests
cd contracts && forge test         # 17 contract tests
```
Live proof commands: see `docs/DEPLOYMENT_MONAD_TESTNET.md`.