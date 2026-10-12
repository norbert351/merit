# Merit — Testing

Repeatable workflow. Run everything from the repo root unless noted.

## JavaScript (Node 22)
```bash
npm install            # deps from package-lock.json
npm test               # node --test  → 34 tests
```
Covers: score/sybil/mandate engine, x402 money path, API integration, **live P256-precompile**
verify + forged-signature refusal, proof-of-possession registration, immutable key binding,
challenge single-use/replay, payment fail-closed (facilitator/RPC), idempotency, score parity,
and demo-data isolation.

> The `passkey` tests hit Monad's testnet RPC for the precompile; they **skip (never fake)** when
> the RPC is unreachable. On this VM the npm scripts set `NODE_OPTIONS=--dns-result-order=ipv4first`.

## Solidity (Foundry)
```bash
export PATH="$HOME/.foundry/bin:$PATH"
cd contracts
forge build
forge test             # 17 tests (8 Merit + 9 GuardedWallet)
```

## End-to-end live paid loop (hardened)
```bash
npm run api            # serves API + UI on :8130 (demo mode without MERIT_EXECUTOR_KEY)
node scripts/settle-demo.mjs      # register passkey -> 402 challenge -> sign -> settle (verified via 0x0100)
```
`settle-demo.mjs` asserts: valid passkey ⇒ `verified:true`; forged signature ⇒ `verified:false`;
challenge replay ⇒ blocked; duplicate `paymentId` ⇒ blocked.

## Required adversarial cases (mapped to tests)
| Case | Test |
|---|---|
| Forged payment signature | `security.test.mjs` (fail-closed) |
| Facilitator failure/timeout | `security.test.mjs` |
| Wrong recipient / reverted tx | `security.test.mjs` (`confirmSettlement`) |
| Duplicate settlement / replay | `api.test.mjs` (409 on duplicate paymentId), `passkey.test.mjs` (challenge replay) |
| Unauthorized public-key replacement | `passkey.test.mjs` |
| Cross-client signature | `passkey.test.mjs` |
| Expired/single-use challenge | `passkey.test.mjs` |
| Duplicate verified payer / dust | `sybil.test.mjs`, `phase23.test.mjs` |
| Score parity JS↔Solidity | `security.test.mjs` + `contracts/test/Merit.t.sol` |
| Over-cap / cumulative / unauthorized / revoked / paused mandate | `contracts/test/GuardedWallet.t.sol` |
| Fail-closed on missing score | `contracts/test/GuardedWallet.t.sol` (`testStaleOrUnavailableScore…`) |

## Static analysis
`forge build` (solc 0.8.24, optimizer + via_ir) compiles clean. Slither is not installed on this box;
if available: `slither contracts/src --solc-remaps @=contracts/lib`. Automated tools passing are **not**
a claim of a formal audit (`SECURITY_AUDIT.md`).

## Honest results (run 2026-10-12)
- `npm test` → **34 passed, 0 failed** (passkey precompile tests execute live, not skipped).
- `forge test` → **17 passed, 0 failed**.
- No test was deleted or weakened to reach green; every fix added a failing-first regression test.