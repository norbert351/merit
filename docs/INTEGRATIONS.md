# Merit — Sponsor Integrations (evidence, not claims)

Per integration: the **actual feature** it powers, the exact dependency, source files, test evidence,
deployment evidence, the bounty criteria it could meet, and remaining eligibility uncertainty.
**No integration is claimed eligible without the evidence below.**

## 1. x402 v2 (Monad facilitator) — settlement primitive
- **Feature it powers:** the hire-then-settle money path — HTTP 402 challenge → verified
  `PAYMENT-SIGNATURE` → facilitator `/verify` + `/settle` → on-chain receipt. Load-bearing: remove
  it and no receipt can exist, so the score has nothing to derive from.
- **Dependency:** implemented **natively on `viem`** (not an SDK) — `FacilitatorClient`
  (`src/x402/facilitator.mjs`). No `@x402/*` package is used (documented accurately).
- **Source:** `src/x402/facilitator.mjs`, `src/payments/verify.mjs`, `src/api/server.mjs`.
- **Test evidence:** live `/supported` probe; `test/phase1.test.mjs`; `test/security.test.mjs`
  (fail-closed). Live: purchase loop via `scripts/settle-demo.mjs`.
- **Deployment evidence:** facilitator reachable on both networks — kinds for `eip155:10143` and
  `eip155:143`, `x402Version: 2`.
- **Criteria / uncertainty:** core-track integration; eligibility depends on the event's current
  sponsor list (not asserted here).

## 2. Monad P256 / WebAuthn precompile `0x0100` (EIP-7951) — verified-client identity
- **Feature it powers:** the anti-sybil "distinct verified client" weight. A client registers a
  P-256 passkey and signs the payment challenge; the server verifies via a stateless `eth_call`. This
  is the Track-04 cryptography/identity axis.
- **Dependency:** native precompile at `0x...0100`; called from `src/identity/passkey.mjs`
  (`verifyP256Signature`). Client side: `src/identity/passkey-client.mjs` (ES256/P-256, WebAuthn-shaped).
- **Test evidence:** `test/passkey.test.mjs` — live precompile verifies a valid assertion and refuses
  a forged one; PoP registration; immutable binding; challenge replay blocked.
- **Deployment evidence:** live `eth_call` returns `0x…01` for a valid ES256 signature (both the
  probe `scripts/p256probe.mjs` and the configured API/settle flow).
- **Criteria / uncertainty:** relevant to the Monad "passkey UX" bounty **only if** that bounty is
  present and requires real passkey accounts — the full passkey→smart-account custody path is a
  documented roadmap item, so this is **not** claimed as a Mera/passkey-account wrapper.

## 3. ERC-8004 — identity anchor
- **Feature it powers:** the agent identity anchor the score is bound to.
- **Dependency:** `src/monad/erc8004.mjs` (Identity + Reputation registry ABI per the spec).
- **Honest status:** the **canonical** ERC-8004 registries are deployed on Monad **mainnet only**;
  `getCode` is empty on testnet. The testnet build therefore uses a **clearly-named local adapter**
  (`contracts/src/MeritIdentity.sol` / `MeritReputation.sol`), NOT the canonical registry. `registerAgent`
  now returns the real `agentId` from the `Registered` event (was returning the tx hash) and uses a
  proper `privateKeyToAccount`.
- **Deployment evidence:** testnet suite live; canonical mainnet registration = **documented ⚠️**
  (needs a funded mainnet wallet). **Not** claimed as canonical-compliant.

## 4. Envio HyperIndex — receipt graph
- **Feature it powers:** reconstruct an agent's score from on-chain events (re-derivation by a stranger).
- **Source:** `indexer/config.yaml` (contract `0x92A1…114D`, chain 10143), `indexer/schema.graphql`,
  `indexer/src/EventHandlers.ts`.
- **Corrections this pass:** removed a `- BigInt(0)` no-op; the handler now reconstructs the
  **canonical** score (`effSettled + distinctVerified*5*SCALE`) with deterministic, idempotent,
  tx-log-keyed nodes.
- **Test evidence:** design + invariants (config/handlers); a clean rebuild requires
  `cd indexer && npm i && npx envio codegen`.
- **Parity PROVEN (2026-10-13, token-powered):** `npm run parity`
  (`scripts/indexer-parity.mjs`) pulls the REAL `ReceiptRecorded` / `SybilClusterSuppressed` events
  for `0x92A1…114D` straight from **Envio HyperSync** (`monad-testnet.hypersync.xyz`, auth with
  `ENVIO_API_TOKEN`), re-runs the indexer's exact algorithm, and reproduces on-chain `scoreOf(1)`
  bit-for-bit: **105 raw logs → 54 receipts + 51 suppressions → reconstructed $71.00 == on-chain
  $71.00** (distinct verified payers 4 == 4, effective settled 51000000 == 51000000). This is the
  "re-derivable by a stranger from raw on-chain events" claim, demonstrated.
- **Deployment evidence (hosted):** **not deployed** — Envio Cloud hosting needs the Envio/GitHub
  account (OAuth). Local "`envio dev`" also does not run in this headless sandbox (interactive TUI).
  The indexed graph is a clearly-labelled bounty layer; the **authoritative** score is on-chain `scoreOf`.
- **Criteria / uncertainty:** the re-derivation itself is now PROVEN against real HyperSync data;
  only the **hosted endpoint** remains to claim the full Envio bounty.

## Explicitly NOT integrated (to avoid forcing unrelated sponsors)
Dynamic, Mera, Alchemy, Kimi, Perpl, Kuru, Agora, Cleanverse, Hunyuan, Qwen — none materially improve
Merit's core loop or are verifiable in the deployed app here, so none are bolted on. Per the event
rules, an unrelated dependency is not a qualifier.