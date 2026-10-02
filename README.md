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
- ✅ **Phase 2** — on-chain re-derivable score (`onchain-score.mjs`)
- ✅ **Phase 3** — binding, escalation-proof mandate (`mandate.mjs`)
- ✅ **13/13 tests pass** + full demo launcher (`npm start`)

## Run the moat proof
```bash
npm test        # 13 tests
npm start       # the demo launcher: both sock-puppet demos + the escalation-proof mandate
```
The two winning demos are real, deterministic tests, ready to become on-chain receipts:
1. 50 sock-puppet agents praising each other → score **stays 0**.
2. One real paying customer settles via x402 → score **moves** and the mandate unlocks.

## Key links
- `Plan.md` — the master plan (thesis, anti-thesis test, architecture, roadmap, risks, gating)
- `src/reputation/` — the sybil-resistant scoring engine (the moat)
- `src/reputation/onchain-score.mjs` — transparent, re-derivable by a stranger
- `src/mandate/mandate.mjs` — the binding, escalation-proof authority cap
- `src/gateway/server.mjs` + `src/x402/facilitator.mjs` — the paid x402 money path
- `src/receipt/ledger.mjs` — the settled-receipt audit graph (err===null only)
- `docs/` — rubric/SUBMISSION (afterhours structure, fresh content)

> This is a **separate build from AfterHours** (the tokenized-equity gap agent). It shares only the `err===null`-verify + x402 + docs-discipline patterns — not the repo, not the thesis.