# Merit

**Sybil-resistant, settled-money-weighted agent reputation — so fake agents can't buy a score, and the score governs how much authority an agent gets.**

- **Event:** Monad Metropolis · **Track 04 — Trust, Identity & AI Infrastructure** · deadline **Oct 13, 2026**
- **One-liner:** An agent's reputation computed only from money that actually *settled* (weighted by distinct verified clients, sybil clusters zeroed), expressed as a hire-then-settle flow with a binding authority cap.
- **The moat,** precisely: 8004scan, ERC-8004's own registries, and AgentPMT do identity/governance/scanning — **none does sybil-resistant, settled-money-weighted reputation as a hire flow with a binding mandate.** That is the only white-space left, and it's what this build is for.

## Status
- ✅ **Plan locked** → `Plan.md` (every feature, phased, no gaps)
- ✅ Scaffold: scoring core + sybil guard + the two winning demos as passing tests
- ⏳ Phase 1: ERC-8004 identity + paid-MCP/x402 gateway + receipt graph (starts after Stocklana submit + BSC port)

## Run the moat proof
```bash
npm test
```
The two demos are real, deterministic tests, ready to become on-chain receipts:
1. 50 sock-puppet agents praising each other → score **stays 0**.
2. One real paying customer settles via x402 → score **moves** and the mandate unlocks.

## Key links
- `Plan.md` — the master plan (thesis, anti-thesis test, architecture, roadmap, risks, gating)
- `src/reputation/` — the sybil-resistant scoring engine (the moat)
- `docs/` — to be filled with rubric/SUBMISSION (afterhours structure, fresh content)

> This is a **separate build from AfterHours** (the tokenized-equity gap agent). It shares only the `err===null`-verify + x402 + docs-discipline patterns — not the repo, not the thesis.