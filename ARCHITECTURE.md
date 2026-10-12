# Merit — Architecture

Merit is a **sybil-resistant, settled-money-weighted agent reputation** for Monad: an agent's
score is built only from x402 payments that *actually settle*, weighted by distinct
**P-256 passkey-verified** buyers, with sock-puppet clusters zeroed. The score is **load-bearing**
— it binds the authority (spend/action cap) the agent is allowed to hold.

## System diagram

```
 HIRE-then-SETTLE surface (the product)
 ┌────────────────────────────────────────────────────────────┐
 │ mobile-first SPA  public/index.html + app.js               │
 │   · browse agents by settled credibility                    │
 │   · per-agent receipt trail (verified · P256 / unverified)  │
 │   · "Pay via x402" — HTTP 402 → passkey-sign → settle       │
 │   · "Bound authority" meter + "Try escalate to HIGH"        │
 └───────────────────────┬────────────────────────────────────┘
                         │ JSON (CORS-open)
 ┌───────────────────────▼────────────────────────────────────┐
 │ API  src/api/server.mjs  (hobby-http, no framework)        │
 │   GET /api/agents · /agent/:id · /score/:id · /meta        │
 │   POST /api/passkey/register · /api/settle ·               │
 │        /api/mandate/enforce · /tools/call                  │
 └───────┬──────────────────────┬─────────────────────────────┘
         │ P256 identity gate   │ x402 settlement
 ┌───────▼────────────┐   ┌─────▼───────────────────────────┐
 │ passkey.mjs        │   │ x402/facilitator.mjs            │
 │ Monad P256 PRECOMPILE │   │ Monad x402 v2 facilitator        │
 │ 0x0100 (EIP-7951)  │   │ /verify → /settle (covers gas)  │
 │ eth_call → verified│   └─────┬───────────────────────────┘
 └───────▲────────────┘         │ recordReceipt (err===null)
         │ payerVerified        ▼
 ┌───────┴──────────────────────────────────────────────────┐
 │ CORE (the moat)                                          │
 │   onchain-score.mjs  score = effSettled + verified × $5  │
 │   sybil-guard.mjs     unverified dust clusters → $0      │
 │   mandate.mjs         authority = f(score), escalation-  │
 │                       proof (cap, never exceed earned)   │
 └───────┬──────────────────────┬───────────────────────────┘
         │ writes ONLY on       │ mirrors exactly on-chain
         │ err===null           │
 ┌───────▼────────────┐   ┌─────▼───────────────────────────┐
 │ storage            │   │ MONAD TESTNET contracts         │
 │ node:sqlite        │   │ MeritIdentity 0xD85d…278c       │
 │ receipts + clients │   │ MeritReputation 0x92A1…114D     │
 │ (gitignored)       │   │ MeritMandate 0xa807…E17d        │
 └───────▲────────────┘   └─────┬───────────────────────────┘
         │                      │ events: ReceiptRecorded /
         │                      │ SybilClusterSuppressed
 ┌───────┴──────────────────────▼───────────────────────────┐
 │ Envio indexer  indexer/  → queryable receipt graph       │
 │ a stranger re-derives the score from on-chain data only  │
 └──────────────────────────────────────────────────────────┘
```

## The core value flow (the spine, made visible)

1. **Hire** — a buyer opens an agent and requests a settled interaction.
2. **402** — the server challenges with a real x402 v2 `PAYMENT-REQUIRED` (never free).
3. **Passkey identity** — to count as a *verified* client the buyer registers a P-256 passkey
   and signs the exact challenge message; the server verifies the assertion with **Monad's
   native P256 precompile `0x0100`** (stateless `eth_call`). A missing/forged signature →
   the receipt is recorded but **unverified** (no floor, no anti-sybil weight).
4. **Settle** — the facilitator verifies + relays the payment; the server re-confirms the
   on-chain receipt (`err===null`) before recording anything.
5. **Score** — `score = effectivelySettledUsd + distinctVerifiedClients × $5`, sybil dust clusters
   zeroed. Re-derivable by a stranger from the on-chain receipt graph.
6. **Mandate** — authority = f(score); an escalation attempt is **capped** to the earned tier.

## Counterfactual — remove a rail, what happens?

| Remove | What happens (the judged axis) |
|---|---|
| **Monad P256 precompile `0x0100`** | `verified` collapses to a self-asserted flag → 50 sock-puppets each declare "verified" and inflate the score. **The anti-sybil weight stops.** |
| **x402 facilitator** | no digital settlement → no on-chain receipt → the score has no money to derive from. **Receipts can't exist.** |
| **Monad settlement (err===null)** | a receipt could be recorded on a *broadcast* that failed → phantom money moves the score. **The "money actually settled" guarantee stops.** |
| **Sybil guard / mandate** | `score = effSettled + verified` without suppression → dust clusters count; and an agent can unlock unlimited authority. **Both demos fail.** |
| Envio indexer | on-chain re-derivation is still *possible* (cast / contract read) but not served as a queryable graph — **bounty layer only, soft by design**. |
| ERC-8004 registries (mainnet) | the production identity anchor is absent — **already labeled as a not-yet** (needs a funded mainnet wallet); the testnet suite re-implements the same surface so the loop is real today. |

## Module map

| File | Role |
|---|---|
| `src/api/server.mjs` | the hire-then-settle API + static SPA host; the verified-client gate lives here |
| `src/identity/passkey.mjs` | registers P-256 passkeys and verifies assertions via the `0x0100` precompile |
| `src/identity/passkey-client.mjs` | client-side ES256/P-256 passkey (what a WebAuthn authenticator does) |
| `src/reputation/onchain-score.mjs` | the score engine — re-derivable, mirrors the on-chain contract |
| `src/reputation/sybil-guard.mjs` | unverified dust-cluster suppression |
| `src/mandate/mandate.mjs` | escalation-proof authority cap |
| `src/x402/facilitator.mjs` | x402 v2 facilitator client (`/verify`, `/settle`) |
| `src/monad/settle.mjs` | real `recordReceipt` broadcast + `err===null` confirm |
| `src/monad/merit-contracts.mjs` | live contract client (`scoreOf`, `mandateOf`) |
| `src/receipt/ledger.mjs` | node:sqlite receipt graph + passkey client registry |
| `contracts/src/*.sol` | the on-chain suite (identity/reputation/mandate over Monad) |
| `indexer/` | Envio HyperIndex config + handlers → receipt graph |