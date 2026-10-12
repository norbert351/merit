# Merit — Technical Reference

Event: Monad Metropolis · **Track 04 — Trust, Identity & AI Infrastructure** · deadline **Oct 13, 2026**.

## Stack

- **Node.js 22** (`node:sqlite` built-in, ESM), no web framework — the API is a bare `node:http` server.
- **viem** — EVM RPC reads/writes + the Monad precompile `eth_call`.
- **@modelcontextprotocol/sdk** — the paid-agent MCP surface (the x402 gateway can be exposed as MCP tools).
- **Foundry (forge/cast)** — Solidity contracts + tests.
- **Envio HyperIndex** — the receipt-graph indexer (bounty layer).
- **puppeteer / ffmpeg (dev)** — live demo capture.

## Core algorithm (the moat, re-derivable)

Scoring — `src/reputation/onchain-score.mjs` (mirrored byte-for-byte by `contracts/src/MeritReputation.sol:scoreOf`):

```
sybil:   detectSybil(receipts)   // >=4 unverified payers, each amount < $0.50  → cluster detected
effective = receipts − { all payers in a detected sybil cluster }
score    = sum(amount of delivered receipts in effective)          // "effectivelySettledUsd"
        + distinctVerified(effective) × $5                          // "distinctVerifiedClients"

   score = effectivelySettledUsd + distinctVerifiedClients × 5
```

A receipt exists **iff money actually settled** (`err===null`, confirmed on-chain — never a bare
broadcast). Verified identity is cryptographic, not a flag:
`payerVerified` is set **only** when `src/identity/passkey.mjs` proves a P-256 assertion against
Monad's EIP-7951 precompile `0x0100` (`eth_call`, stateless).

Mandate — `src/mandate/mandate.mjs` / `MeritMandate.sol:enforce` (escalation-proof):
`effectiveTier = min(requested, earnedTier)`; a spend above `maxSpend(earnedTier)` is denied.
Earned tiers: score ≥ 50 → low ($10) · ≥ 500 → medium ($100) · ≥ 2,500 → high ($1,000).

## Data model

### node:sqlite ledger (`data/receipts.db`, gitignored)
```
receipts(id, agentId, payer, payerVerified, amountUsd, deliverableHash, outcome,
         txHash, chainId, status[pending|settled|reverted], verifyMethod, created_at)
clients(clientId PK, pubX, pubY, chainId, label, created_at)   # passkey registry
```

### Monad testnet contracts (chainId 10143, live)
| Contract | Address |
|---|---|
| MeritIdentity | `0xD85ddb55316dD0F9D46Ec9BBb92A8A1FFE2E278c` |
| MeritReputation | `0x92A11Ad0E988C6cd0Bd434e140331A620393114D` |
| MeritMandate | `0xa8071a14D27E90923204a1B5098658611AC4E17d` |

Relevant read-back (2026-10-12, via `cast` / `onchainScoreOf`): `scoreOf(1)` = **$21**
(settled $6.005, effectively $6, **3 distinct verified clients**, sybil detected true);
`mandateOf(1)` = tier none, maxSpend $0 (score 21 < 50 low-tier threshold — correct, an agent
with $21 of earned reputation holds **no** authority). Live `recordReceipt` broadcast tx on-chain:
`0x3dd89821…` (status 1). Enriched events (`ReceiptRecorded` 8-arg, `SybilClusterSuppressed`)
confirmed emitted (block ~70068431).

> ERC-8004 note: the **canonical** ERC-8004 registries are deployed on **mainnet (143) only**
> (`getCode` empty on testnet). The testnet suite re-implements the same surface so the demo is
> real on-chain today; mainnet ERC-8004 remains the production anchor (a documented ⚠️ not-yet —
> it needs a funded mainnet wallet). See `contracts/DEPLOY.md`.

## API surface
| Endpoint | Method | Purpose |
|---|---|---|
| `/api/agents`, `/api/agent/:id`, `/api/score/:id` | GET | live scores + mandate + receipt trail |
| `/api/passkey/register` | POST | bind a P-256 public key to a client id |
| `/api/settle` | POST | 402 challenge → passkey-verified settle → receipt |
| `/api/mandate/enforce` | POST | live escalation-proof verdict |
| `/api/meta` | GET | honest mode/live-vs-demo + the P256 rail |
| `/tools/call` | POST | MCP/x402 gateway settle |
| `/health` | GET | liveness |

`/api/settle` without a `PAYMENT-SIGNATURE` returns real **HTTP 402** + `PAYMENT-REQUIRED`
(never free). With a signature but no valid passkey assertion, the receipt settles as
`verified:false` and earns no verified-client floor — the payer's money still counts, its
identity doesn't.

## Honest live / demo split
- With `MERIT_EXECUTOR_KEY` (funded testnet key) set, `/api/settle` broadcasts a real
  `recordReceipt` tx and only records on `err===null`; `/health` and `/api/meta` report `mode:"live"`.
- Without it, the API runs `mode:"demo"` (labeled in the UI), the P256 passkey gate **still
  works** (precompile `eth_call` is free), and the UI labels every number `demo ledger` — it never
  claims on-chain.

## Test suite
`npm test` = **27/27** (engine, x402 money path, API integration, and **live P256-precompile**
verify + forged-signature refusal). `npm run test:contracts` = **8/8** Foundry tests (the on-chain
moat + event assertions). Live paid loop over HTTP: `node scripts/settle-demo.mjs`.

## Reproduce / run
```bash
npm install
npm test                          # 34 JS tests   (engine + x402 money path + API + live P256 + passkey + payment fail-closed + parity)
npm run test:contracts            # 17 Foundry tests (Merit moat + GuardedWallet mandate enforcement)
npm run api                       # API + UI: landing at / , hire-then-settle app at http://127.0.0.1:8130/app
node scripts/settle-demo.mjs      # E2E: register passkey -> 402 -> sign -> settle (verified via 0x0100)
```
Env: `MERIT_EXECUTOR_KEY` (optional, unlocks live settle) · `MERIT_NETWORK` (testnet|mainnet) ·
`MONAD_RPC_URL` · `MERIT_DB_PATH` · `MERIT_API_PORT`/`PORT` · `MERIT_FACILITATOR_URL` ·
`ENVIO_API_TOKEN` (indexer deploy). See `.env.example`.