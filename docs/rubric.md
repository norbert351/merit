# Merit — Judge-Verification Rubric (Monad Metropolis, Track 04)

How a judge reproduces every claim. Mirrors the afterhours pattern: **no blanket "all good"** —
every feature is ✅ verified / ⚠️ labeled / ❌ not-yet, and each sponsor-integration is grep-able
in code. Re-verify each line before submission (Phases may have advanced since this was written).

## The anti-thesis gating line (the proof bar, from Plan.md §0)
> **The [settled-money-weighted, sybil-resistant reputation, as a binding constraint] must be
> the thing the whole app is FOR, and there must be code that proves it runs.** If a judge can
> strip the weighting and the app still "works", we drifted.

**Run it yourself:**
```bash
cd merit
npm test              # 20 tests (engine + money path + API integration)
npm run test:contracts # 8 Foundry tests (on-chain moat proof)
npm start             # demo launcher: both sock-puppet demos + escalation-proof mandate
npm run api           # the hire-then-settle app (API + UI) on :8130
```

---

## Track fit (Track 04 — Trust, Identity & AI Infrastructure)
Official definition: *"Trust, provenance, and user-owned data primitives that make AI useful
without one platform capturing the value. Best fit: cryptography / protocol design / agent
frameworks."*
- ✅ Mechanism is load-bearing, not a badge — remove settled-payment + verified-client weighting → sock puppets run the system.
- ✅ ERC-8004 spec itself names the gap: *"Sybil attacks are possible, inflating the reputation of fake agents"* + *"we expect many players to build reputation systems."*
- ✅ Monad is the honest economic counterfactual: per-interaction receipt writes only make sense at fast, cheap settlement.

---

## Verified / labeled / not-yet matrix (honest, no blanket claims)

| Claim | Status | How to verify |
|---|---|---|
| `npm test` = 21 passing | ✅ VERIFIED (10/11) | `npm test` |
| Contract tests = 8 passing | ✅ VERIFIED (10/11) | `npm run test:contracts` |
| Demo 1: 50 sock puppets → score stays 0 | ✅ VERIFIED | `npm start` · `test/api.test.mjs` |
| Demo 2: one settled $1 receipt → score moves + mandate unlocks | ✅ VERIFIED | `npm start` · `test/api.test.mjs` |
| Escalation-proof mandate (Bankr refutation) | ✅ VERIFIED | `npm start` (DEMO 3) · `POST /api/mandate/enforce` |
| Receipt ledger writes only on `err===null` | ✅ VERIFIED | `test/phase1.test.mjs` |
| PaidGateway returns HTTP 402 (x402 v2 challenge) | ✅ VERIFIED (unit) | `test/phase1.test.mjs` + `src/gateway/server.mjs` |
| Rejects unverified PAYMENT-SIGNATURE before settle | ✅ VERIFIED (unit) | `test/phase1.test.mjs` |
| x402 v2 facilitator live on testnet+mainnet | ✅ VERIFIED live (10/2) | `node src/x402 probe`; `https://x402-facilitator.molandak.org/supported` |
| P256/WebAuthn precompile `0x0100` (EIP-7951) | ✅ VERIFIED (docs + address) | `docs.monad.xyz/developer-essentials/precompiles` |
| ERC-8004 Identity/Reputation registries deployed | ✅ VERIFIED live on **mainnet** (143) | `getCode` → non-empty on 143; **empty on testnet** |
| Merchant suite LIVE on Monad testnet | ✅ VERIFIED live (10/11) | `src/monad/merit-contracts.mjs` → `0x92A1…114D`; `cast call … scoreOf(1)` |
| **Live x402 `recordReceipt` tx on-chain (err===null)** | ✅ VERIFIED live (10/11) | `MERIT_EXECUTOR_KEY=… npm run api` → `POST /api/settle`; tx `0x3dd89821…` status 1 |
| **Hire-then-settle API + UI (mobile-first)** | ✅ VERIFIED (10/11) | `npm run api` → :8130 (402 → sign → settle → score moves on-chain) |
| **Envio indexer of the receipt graph** | ✅ CONFIG BUILT (10/11) — `indexer/` targets the live contract; enriched events confirmed emitting | `cd indexer && npm i && npm run codegen` |
| **On-chain enriched events (`ReceiptRecorded` 8-arg + `SybilClusterSuppressed`)** | ✅ VERIFIED emitting live (10/11) | `cast logs --address 0x92A1…114D` |
| Live ERC-8004 `register()` on canonical mainnet registry | ⚠️ NOT YET — needs funded mainnet wallet | run `registerAgent` with a funded mainnet key |
| Real demo video ≤20MB 720p | ❌ NOT STARTED | Phase 5 |
| Live deploy + keepalive through judging (Nov 3) | ⚠️ `render.yaml` added; not yet deployed | Phase 5 |

---

## Sponsor-tech load-bearing map (each is grep-able in code, not README speech)

| Bounty sponsor | Claim | Where in code |
|---|---|---|
| **Monad P256 `0x0100`** | verified-client identity (the anti-sybil "distinct real client" weight) | `src/monad/config.mjs` → `P256_VERIFY` |
| **x402 v2 (Monad facilitator)** | the settlement primitive that produces receipts | `src/x402/facilitator.mjs` |
| **ERC-8004** | the identity anchor we weight | `src/monad/erc8004.mjs`, `src/monad/config.mjs` |
| **Envio** (bounty) | receipt graph indexer → on-chain re-derivability | `indexer/` (config.yaml + schema.graphql + src/EventHandlers.ts) |
| Cleanverse CVI (bounty) | alternative verified-identity signal | *planned* |
| Nansen (bounty) | "Best use of Nansen" | *planned — optional* |

---

## Bounties targeted (stackable with the Track 04 main prize)
- **Envio** $1K + **Envio Cloud hosting** $5K — indexer (Phase 2)
- **Mera/P256 UX** $2.5K ×2 (Monad Foundation) — passkey→EOA verified-client identity
- **Cleanverse CVI/CVA** $2K — identity coupled to transfer
- **Best Agent Wallet Plugin** $2.5K (MetaMask) — the mandate binds on top of their wallet
- **Nansen** $5K (optional), **Privy** $5K (optional)
- Main track 04: 1st $10K · 2nd $10K · 3rd $10K · Grand Champion $25K

---

## What "submission-ready" means (Phase 5 checklist)
- [x] Repo public (`github.com/norbert351/merit`, public)
- [x] No secrets/keys/DBs in git (`data/`, `node_modules/`, `contracts/out|cache|broadcast`, `.env` gitignored; `.env.example` ships)
- [x] Hire-then-settle UI (mobile-first, honest live/demo labeling)
- [x] `docs/SUBMISSION.md` paste-ready + honest ✅/⚠️/❌ matrix
- [x] Envio indexer config + on-chain enriched events
- [ ] Live Monad x402 demo with a real settled receipt (needs funded `MERIT_EXECUTOR_KEY` — code path ready in `src/monad/settle.mjs`)
- [ ] On-chain ERC-8004 `register()` (mainnet) for the demo agent
- [ ] `envio deploy` (host the receipt graph — $5K hosting bounty)
- [ ] Real demo video (≤20MB 720p, on-camera settled-receipt action, both demos)
- [ ] Keepalive for the live deploy through Nov 3