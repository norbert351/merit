# Merit — Submission Write-up (Monad Metropolis, Track 04)

> **One-liner:** An agent's reputation computed only from money that actually *settled* —
> so fake agents can't buy a score — and the score **governs how much authority** that agent
> gets to hold.

## What it is
Merit is a **sybil-resistant, settled-money-weighted agent reputation** layer for Monad. An
agent's score is derived *only* from settled x402 payments + distinct verified client identity.
The score is **load-bearing** — it binds how much spend/action authority the agent is allowed:
attempt to escalate a permission tier and the mandate still caps you at what you earned.
No settled money, no verified clients → **score is zero**, no matter how many sock-puppets praise you.

## Why it exists (the problem, with dollars)
- **ERC-8004's own spec admits the hole:** *"Sybil attacks are possible, inflating the
  reputation of fake agents"* + *"we expect many players to build reputation systems."*
- **The Bankr attacks:** $174K (May 4, 2026, OECD AI Incident `2026-05-04-4a73`), then **$440K
  across 14 wallets 16 days later** — *"nothing existed to put between incident 1 and 2."*
  Post-mortem: *"Spending limits didn't apply because the attacker had unlocked a higher tier first."*
- **The $500K LLM-router drain** — 26 malicious routers injected tool calls; *"the agent never
  saw the malicious prompt."*
- **Missing audit trail:** *"after x402 hits 15m txns the real bottleneck is the missing receipt
  and audit trail."* (Farcaster @a0xbot)

## Why Monad
A **per-interaction on-chain receipt write is only affordable on fast, cheap settlement**
(~0.3s blocks, chain 143 / testnet 10143). This is the honest economic counterfactual — the
receipt graph that anchors every score only exists if writing a receipt is nearly free.

## How it works (the money path)
1. **Identity** — a Merit agent registers in the ERC-8004 Identity Registry (Monad mainnet) → gets an `agentId`.
2. **Paid surface** — the agent exposes MCP tools behind an **x402 v2** endpooint: a call with no payment returns **HTTP 402** (`PAYMENT-REQUIRED`).
3. **Settle** — the buyer signs and replays with a `PAYMENT-SIGNATURE`; the server verifies it via the Monad facilitator (anti-fraud gate) then settles on-chain.
4. **Receipt** — on **`err===null`** (transaction confirmed, never broadcast), a receipt `{agentId, verifiedPayer, amount, deliverableHash, outcome}` is written to the graph. A receipt exists **IFF money actually settled.**
5. **Score** — reputation = settled money + distinct verified-client floor, with sybil clusters zeroed. Transparent and **re-derivable by a stranger** from the on-chain receipt graph.
6. **Mandate** — the agent's authority = f(earned score), checked on **every** spend/action and **escalation-proof**: a higher permission tier still can't exceed the earned mandate.

## The two demos that win the room
- **Demo 1 (immutable immunity):** 50 sock-puppet agents all praise each other → **score stays 0.**
- **Demo 2 (the payoff):** one real paying customer settles via x402 → **score moves AND the agent's authority cap unlocks.**
- Pivot: escalate the attacker to a higher tier → the mandate **still holds** (direct Bankr answer).

## Verified vs. not-yet (honest)
**Verified live (2026-10-02):** 13/13 tests pass; both demos deterministic; x402 v2 facilitator
reachable on testnet+mainnet; P256 `0x0100` present; ERC-8004 registries deployed on mainnet.
See `docs/rubric.md` for the full per-claim matrix — including what is *not* yet on-chain
(live `register()`/`settle()` need a funded wallet + executor key) and what's planned (Envio
indexer, consumer UI, video). **No blanket "all good."**

## Links
- Code: `github.com/norbert351/merit`
- Plan: `Plan.md` · Judge matrix: `docs/rubric.md`
- Monad rails: `src/monad/config.mjs` (verified layer split)

## Bounties targeted
Envio ($1K + $5K hosting) · Mera + P256 UX ($2.5K ×2) · Cleanverse CVI ($2K) · MetaMask Agent
Wallet plugin ($2.5K) · main track 04 ($10K/$10K/$10K) · Grand Champion ($25K).