# Merit

**Sybil-resistant, settled-money-weighted agent reputation — so fake agents can't buy a score, and the score governs how much authority an agent gets.**

- **Event:** Monad Metropolis · **Track 04 — Trust, Identity & AI Infrastructure** · deadline **Oct 13, 2026**
- **One-liner:** An agent's reputation computed only from money that actually *settled* (weighted by distinct verified clients, sybil clusters zeroed), expressed as a hire-then-settle flow with a binding authority cap.
- **The moat,** precisely: 8004scan, ERC-8004's own registries, and AgentPMT do identity/governance/scanning — **none does sybil-resistant, settled-money-weighted reputation as a hire flow with a binding mandate.** That is the only white-space left, and it's what this build is for.

## Status
- ✅ **Plan locked** → `Plan.md` (every feature, phased, no gaps)
- ✅ **Phase 0** — own git repo; deps installed; Monad rails live-verified (x402 v2 facilitator on
  testnet+mainnet, P256 `0x0100`; ERC-8004 registries deployed on **mainnet only** — layer split recorded
  in `src/monad/config.mjs`)
- ✅ **Phase 1** — ERC-8004 identity client, x402 facilitator client, paid-MCP gateway (HTTP 402 →
  verify → settle → receipt), `err===null` receipt ledger
- ✅ **Phase 2** — on-chain re-derivable score (`onchain-score.mjs`) **+ Envio indexer** of the receipt graph (`indexer/`)
- ✅ **Phase 3** — binding, escalation-proof mandate (`mandate.mjs`) + on-chain `MeritReputation.recordReceipt`/`scoreOf`
- ✅ **Phase 4** — hire-then-settle **API + UI** (`src/api/server.mjs` + `public/`), mobile-first, honest live/demo labeling
- ✅ **21/21 JS tests pass** + **8/8 contract tests pass** + full demo launcher (`npm start`)
- ✅ **LIVE on Monad testnet** — merchant suite at `0x92A1…114D`; real x402 `recordReceipt` tx settled on-chain (err===null)

## Run it

```bash
npm test              # 20 tests (engine + x402 money path + API integration)
npm run test:contracts # 8 Foundry tests (the on-chain moat proof)
npm start             # the CLI demo launcher: both sock-puppet demos + the escalation-proof mandate
npm run api           # API + UI on http://127.0.0.1:8130  (the hire-then-settle app)
npm run seed          # populate the receipt ledger with the 4 demo agents
```

The two winning demos are real and deterministic:
1. 50 sock-puppet agents praising each other → score **stays 0** (settled-money + verified-client weighting).
2. One real paying customer settles via x402 (HTTP 402 → sign → settle) → score **moves** and the mandate unlocks.

## The hire-then-settle app
`npm run api` serves both the JSON API and the SPA (`public/`). Endpoints:
`GET /api/agents` · `GET /api/agent/:id` · `GET /api/score/:id` · `POST /api/mandate/enforce` · `POST /api/settle`
(no `PAYMENT-SIGNATURE` → real **HTTP 402** challenge) · `GET /api/meta` · `GET /health`.

**Honesty:** with no funded executor key the API reports `mode:"demo"` and the UI labels every number
`demo ledger` — it never claims on-chain. Set `MERIT_EXECUTOR_KEY` (funded Monad testnet key, see
`.env.example`) and `POST /api/settle` broadcasts a **real** `recordReceipt` tx, recording the receipt
only on `err===null`.

## Key links
- `Plan.md` — the master plan (thesis, anti-thesis test, architecture, roadmap, risks, gating)
- `src/reputation/onchain-score.mjs` — the sybil-resistant scoring engine (the moat), re-derivable by a stranger
- `src/mandate/mandate.mjs` — the binding, escalation-proof authority cap
- `src/api/server.mjs` — the hire-then-settle API (the product surface)
- `src/monad/settle.mjs` — the real on-chain settlement path (`recordReceipt`, err===null)
- `indexer/` — Envio HyperIndex: the settled-receipt graph → on-chain re-derivability
- `contracts/src/MeritReputation.sol` — the on-chain ledger + `scoreOf()` mirroring the JS engine exactly
- `docs/rubric.md` — the judge-verification map (honest ✅/⚠️/❌ matrix)

> This is a **separate build from AfterHours** (the tokenized-equity gap agent). It shares only the `err===null`-verify + x402 + docs-discipline patterns — not the repo, not the thesis.
