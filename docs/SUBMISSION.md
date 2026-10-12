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
4. **Verified client** — to be counted as a *distinct verified client* (worth a score floor + the anti-sybil weight), the buyer registers a **P-256 passkey** and signs the exact payment challenge; the server verifies the assertion with **Monad's P256 precompile (EIP-7951, `0x0100`)**. No registered key or a forged signature → the receipt still settles, but as **unverified** — it can never move the verified-client floor.
5. **Receipt** — on **`err===null`** (transaction confirmed, never broadcast), a receipt `{agentId, verifiedPayer, amount, deliverableHash, outcome}` is written to the graph. A receipt exists **IFF money actually settled.**
6. **Score** — reputation = settled money + distinct **passkey-verified** client floor, with sybil clusters zeroed. Transparent and **re-derivable by a stranger** from the on-chain receipt graph.
7. **Mandate (enforced)** — the agent's authority = f(earned score), checked on **every** spend and
   **escalation-proof**: a higher permission tier still can't exceed the earned mandate. This is
   **enforced at the execution boundary** by `GuardedWallet` — a transfer over the earned cap
   **reverts on-chain** (proven live on testnet), not merely an advisory `allowed` verdict.

## The two demos that win the room
- **Demo 1 (immutable immunity):** 50 sock-puppet wallets each *claim* to be verified → the P256 gate refuses every forged/missing passkey → **score stays 0.**
- **Demo 2 (the payoff):** one real customer settles via x402 **with a P-256 passkey** → the precompile verifies → **score moves AND the agent's authority cap unlocks.**
- Pivot: escalate the attacker to a higher tier → the mandate **still holds** (direct Bankr answer).

Both demos run in three places, all greppable: `npm start` (CLI), `npm run api` + the SPA
(the hire-then-settle product, HTTP 402 → passkey-sign → settle → score moves), and
`npm run test:contracts` (the same numbers on-chain via `MeritReputation.scoreOf`).

## The product surface
`npm run api` serves the hire-then-settle app: browse agents sorted by settled credibility, read a
per-agent **receipt trail**, pay via **HTTP 402 → sign → settle**, watch the score move, and see the
**bound-authority mandate** clamp an escalation attempt. Mobile-first, honest labeling (demo vs live).

## Verified vs. not-yet (honest)
**Verified live (2026-10-12):** 34/34 JS tests pass — including the **live P256-precompile** verify
(a registered passkey over the challenge → `verified:true` at `0x0100`; a forged/missing one →
`verified:false`), **proof-of-possession registration + immutable key binding**, **single-use expiring
challenges**, **fail-closed payment verification** + `paymentId` idempotency, score parity, and
**demo-data isolation**; 17/17 Foundry contract tests pass (8 Merit + 9 GuardedWallet) and the
**GuardedWallet is deployed + proven live on Monad testnet** (`0x3570…a1Cd`) — an under-cap transfer
moved funds on-chain while an over-cap transfer **reverted**; the merchant suite is live at
`0x92A1…114D` with a real x402 `recordReceipt` tx settled on-chain; the hire-then-settle API + UI
drives the **passkey verified-client** rail end to end (`node scripts/settle-demo.mjs`); x402 v2
facilitator reachable on testnet+mainnet; ERC-8004 registries deployed on mainnet; Envio indexer
config + enriched on-chain events emitting. See `docs/rubric.md` and `docs/SECURITY_AUDIT.md` for the
full per-claim matrix — including what is *not* yet done (canonical **mainnet** ERC-8004 registration;
hosted Envio deploy; public deploy URL — all documented). **No blanket "all good."**

## Links
- Code: `github.com/norbert351/merit`
- Plan: `Plan.md` · Judge matrix: `docs/rubric.md`
- Monad rails: `src/monad/config.mjs` (verified layer split)

## Bounties targeted
Envio ($1K + $5K hosting) · Mera + P256 UX ($2.5K ×2) · Cleanverse CVI ($2K) · MetaMask Agent
Wallet plugin ($2.5K) · main track 04 ($10K/$10K/$10K) · Grand Champion ($25K).