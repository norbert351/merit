# Merit — Sybil-resistant, settled-money-weighted agent reputation for Monad

> **One-liner:** An agent's reputation computed only from money that actually *settled*, so fake agents can't buy a score — and the score **governs** how much authority that agent is allowed to hold.
>
> **Event:** Monad Metropolis (Sep 1 → Oct 13, 2026, $250K+ pool) · **Track 04 — Trust, Identity & AI Infrastructure**
> **Deadline:** Oct 13 · **Judging:** 14–27 Oct · **Winners:** Nov 3. BUILD STARTS SEP 25 (after Stocklana submit + BSC port later).

---

## 0. Why this build (the sharp thesis — do NOT drift)

- **The problem is real and named in dollars:** Bankr attack ($174K, then $440K across 14 wallets 16 days later — *"nothing existed to put between incident 1 and 2"*), the $500K LLM-router drain (*"the agent never saw the malicious prompt"*), x402 txn volume crashing **92%** in ~6 weeks (*"wallets without governance don't produce sustained commerce — governance gives you the signals and the brakes"* → AgentPMT).
- **The standard invites the build and publishes the gap:** ERC-8004 spec verbatim — *"Sybil attacks are possible, inflating the reputation of fake agents"* — and *"we expect many players to build reputation systems."*
- **Monad is the economic counterfactual:** a per-interaction on-chain receipt write is only affordable on cheap, ~0.3s fast settlement. This is the honest "why Monad."
- **The moat, precisely:** 8004scan, ERC-8004's own registries, and AgentPMT all do *identity / governance / scanning*. **None does sybil-resistant reputation weighted by actually-settled x402 money, expressed as a hire-then-settle flow with a binding authority cap.** Lock the thesis to that. The moment this becomes "a reputation dashboard over ERC-8004," 8004scan beats it by being first.

### Anti-thesis (what this is NOT)
- ❌ NOT a reputation/browser dashboard over 8004scan-style data.
- ❌ NOT another agentic wallet or spend-limits UI (MetaMask Agent Wallet, Coinbase Agentic Wallets, AgentPMT already live).
- ❌ NOT just an on-chain scoreboard — a score that does nothing is decoration.
- ❌ NOT a port of AfterHours; this is a fresh repo reusing only the x402 + `err=null`-verify patterns.

### Anti-thesis test (the one gating line that keeps the build honest)
> **The <settled-money-weighted sybil-resistant reputation, as a binding constraint> must be the thing the whole app is FOR — and I must be able to point at code that proves it runs.** If a judge can strip the weighting and the app still "works," we drifted. Remove settled-payment weighting + verified-client weighting → sock-puppet agents run the system. That is the proof bar.

---

## 1. Architecture (what we build)

```
 HIRE-then-SETTLE flow (consumer surface)
        │  paid MCP / x402 gateway
        ▼
 ┌────────────────────────────────────────────────────────────────┐
 │ ERC-8004 Identity Registry (Monad)   ← agentId per agent       │
 │  (Identity · Reputation · Validation registries)               │
 └───────────────┬────────────────────────────────────────────┘
                 │ every settled x402 call writes a receipt bound to agentId
                 ▼
 ┌────────────────────────────────────────────────────────────────┐
 │ SETTLED-RECEIPT GRAPH (Monad)   ← the audit trail             │
 │  per-interaction receipt: agentId · payerId(verified) · amount │
 │  · deliverableHash · outcome · timestamp                       │
 │  indexed by ENVIO (indexer → the score is re-derivable on-chain│
 └───────────────┬────────────────────────────────────────────┘
                 ▼
 ┌────────────────────────────────────────────────────────────────┐
 │ REPUTATION ENGINE (off-chain scoring, on-chain anchored)      │
 │  weight = f( settledMoney, distinctVerifiedClients,            │
 │               sybilGuard(unique payer identities),            │
 │               outcome / delivery success )                    │
 │  score AND component facts re-derivable from the receipt graph │
 └───────────────┬────────────────────────────────────────────┘
                 ▼
 ┌────────────────────────────────────────────────────────────────┐
 │ BINDING MANDATE / AUTHORITY (the consequence)                 │
 │  earned reputation ⇒ permitted spend + action caps            │
 │  escalation-proof: a higher permission tier still cannot      │
 │  exceed the mandate its settled reputation earned             │
 └────────────────────────────────────────────────────────────────┘
```

**Load-bearing sponsors / bounty tech (grep-able in code, not README speech):**
- **Monad P256/WebAuthn precompile `0x0100`** — verified client identity → the anti-sybil "distinct real client" weight. *(Mera passkey→EOA is the Mera bounty angle too.)*
- **x402 v2 facilitator + Permit2 proxies on mainnet** — the settlement primitive that produces the receipts.
- **ERC-8004 identity/reputation/validation registries** — the identity anchor we weight.
- **Envio indexer** — powers the on-chain receipt graph (Envio `$1K` + `$5K` hosting bounty pays for exactly this plumbing).
- Optional scoring/track-lift: **Cleanverse CVI** (`$2K`), **Nansen** (`$5K`), **Privy** (`$5K`), **MetaMask agent-wallet plugin** (`$2.5K`), **Dynamic**, **Chainlink CRE** (`$3K`).

---

## 2. Roadmap — every feature, phased, no gaps

### Phase 0 — Skeleton + honest pre-flight (wk 1, Sep 25–Oct 1)
- [x] Fresh `~/merit` repo (this one), git + `.gitignore` (no secrets, no runtime DBs).
- [x] `package.json` (Node 22, `node:sqlite`, viem/ethers for EVM/Monad, @modelcontextprotocol/sdk for paid-MCP).
- [ ] `docs/rubric.md` judge-verification map (mirror afterhours pattern).
- [x] Verify Monad testnet availability + P256 precompile + x402 v2 facilitator on Monad.
- [x] Decide Monad RPC strategy — **VERIFIED LAYER SPLIT (2026-10-02 live probe):** x402 v2
  facilitator + P256 `0x0100` live on testnet **and** mainnet; **ERC-8004 Identity/Reputation
  registries deployed on mainnet (143) only** → x402 demo on testnet, ERC-8004 anchor on mainnet.
  Recorded in `src/monad/config.mjs`.

### Phase 1 — ERC-8004 identity + paid surface (wk 2, Oct 2–8) ★ load-bearing core
- [x] **Identity client:** `src/monad/erc8004.mjs` — register + resolve on the ERC-8004 Identity
  Registry (mainnet; abi + addresses verbatim from spec/docs).
- [x] **Paid Agent Surface (x402 gateway):** `src/gateway/server.mjs` — HTTP 402 with `PAYMENT-REQUIRED`,
  buyer signs/replays with PAYMENT-SIGNATURE → facilitator `/verify` (anti-fraud gate) → `/settle`.
- [x] **Receipt write (err===null):** `src/receipt/ledger.mjs` — receipt written only after on-chain
  tx receipt confirms success; pending→settled reconcile + honest reverted state.
- [x] **Test past the challenge:** `test/phase1.test.mjs` — ledger, 402 path, verify-reject path, x402 v2
  kind probing all pass.
- [ ] **Race risk gate:** re-check the field (MetaMask Agent Wallet on Monad + 8004scan + AgentPMT)
  before deep-building the paid-surface axis further.

### Phase 2 — Reputation engine (wk 3, Oct 9–11) ★ the moat
- [x] `src/reputation/onchain-score.mjs` — settled-money + verified-client weighting + sybil guard, with
  the transparent re-derivation string (`scoreJustification`) a stranger can recompute.
- [x] **On-chain anchor + re-derivability** — logic reads SETTLED ledger/graph rows; docs embed the
  re-derivation command.
- [x] **Cold-start:** reputation is a by-product of a payment (first settlement creates first receipt).
- [ ] Wire the on-chain Reputation Registry `giveFeedback` write + Envio indexer of the receipt graph.

### Phase 3 — Binding mandate (the consequence) (wk 3–4, Oct 11–13)
- [x] `src/mandate/mandate.mjs` — authority = f(settled reputation); checked on every spend/action.
- [x] **Escalation-proof:** requested permission tier is clamped to the earned mandate (direct Bankr
  post-mortem refutation) — tested.
- [ ] Attach the mandate to a real spend/execution rail (or the demo wallet in the UX).

### Phase 4 — User-facing hire flow + demo (week 4) ★ the demo that wins the room
- [ ] **Consumer surface:** "hire a verified agent" — see an agent's earned score + audit trail, pay via x402, receive + rate, score updates.
- [ ] **Demo 1 (immutable immunity):** 50 sock-puppet agents all praise each other → **score doesn't move** (settled-money + verified-client weighting).
- [ ] **Demo 2 (the payoff):** one real paying customer settles via x402 → **score moves AND the agent's mandate/authority cap rises.** Deterministic, provable on-chain, no fabrication.

### Phase 5 — Submission integrity (before Oct 13)
- [ ] Live Monad testnet/mainnet deployment + every claim grep-able (sponsor tech in code).
- [ ] `docs/SUBMISSION.md` paste-ready + `docs/rubric.md` judge map + honest ✅/⚠️/❌ verified matrix (no blanket "all good").
- [ ] Real demo video (≤20MB 720p, on-camera settled-receipt action + both demos).
- [ ] Repo public; no secrets/keys/DBs in git; `.env.example` only.
- [ ] Keep-alive for live deploy through judging (Gate 7).

---

## 3. The feature checklist (nothing missed — every component)

**Identity:** register · update · search · agentId resolution · ERC-8004 ID/reputation/validation registries · role handling.
**Paid surface:** MCP server · tools/list · tools/call paywall · x402 quote → pay → replay → receipt · permit2 allowance · session/charge if needed · honest 402 errors (no raw leaks).
**Receipt graph:** write on settle `err===null` · bind to agentId · verified payer · amount · deliverableHash · outcome · ts · Envio indexer · re-derivable on-chain.
**Reputation:** settled-money weight · verified-client weight · sybil guard (distinct real identities) · outcome factor · no self/praise-from-unverified · on-chain anchor · cold-start by-product.
**Mandate:** authority = f(reputation) · checked every action · escalation-proof · spend cap + action cap.
**Verifier:** Monad P256/WebAuthn `0x0100` (client identity) · optional Cleanverse CVI · fallback honest "unverified" not denied.
**UX:** hire flow · score + audit trail view · pay via x402 · rate after delivery · mobile-friendly.
**Bounties targeted:** Envio `$1K`+`$5K` (indexer) · Cleanverse CVI `$2K` · Nansen `$5K` · Privy `$5K` · MetaMask agent-wallet plugin `$2.5K` · Dynamic · Chainlink CRE `$3K`.
**Anti-gaming (self-honesty):** ghost/phantom receipt reconcile (reuse afterhours pattern) · never record a receipt until on-chain `err===null` · honest unverified states · no fabricated scores.

---

## 4. Verification × honesty discipline (the anti-overclaim gate)

- Every settlement verified via the chain (receipt `err===null` + balance/state delta), never the broadcast alone.
- Score claims carry the underlying receipt links + re-derivation command.
- Honest ✅/⚠️/❌ matrix in `docs/rubric.md`; every sponsor integration grep-able in code.
- The two demo payoffs are deterministic and on-chain — no seeded/narrative-only outcomes.

---

## 5. Risks + gating criteria

| Risk | Mitigation / switch |
|---|---|
| **Cold start** (reputation with no agents = empty dashboard) | Make score a **by-product of payment** — first settlement creates first receipt/score. If we catch ourselves building a *browse/rank* surface instead of a *hire-then-settle* flow → STOP, re-scope back. |
| **Lane congestion** (8004scan, ERC-8004 registries, AgentPMT, MetaMask Agent Wallet) | Differentiator = settled-money + verified-client + binding mandate, shipped as one flow. 8004scan is a scanner; we're a hire/settle trust layer. If indistinguishable → drop Monad effort, keep afterhours/BSC. |
| **Monad rails unverified** (testnet/P256/x402 facilitator on Monad) | Verify in Phase 0 before building; if absent → honest "labeled simulation" or pivot. |
| **Judge panel = VCs** (Paradigm, Electric, Galaxy, Pantera, Dragonfly, CoinFund, Nansen CEO…) | Product-shape (OpenAlice/Rebel-in-Paradise proof: startup-shaped wins, infra demos don't). Lead with the hire flow + the sponsored bounties, not the contract architecture. |
| **Time** (~19 days after Stocklana submit) | Phase cuts above; if behind on wk3, ship 2 (reputation) + 3 (mandate) as the v-min, skip 4's polish, submit early. |
| **BNB (Oct 11) beats us to it** | BNB is a *tokenized-stock* build (different repo). No conflict — but don't split focus: finish Stocklana submit, then BNB port, then Merit per plan. |

---

## 6. What's inherited from AfterHours (share the engine, not the repo)
- The `err===null` fill-verification discipline + ghost/phantom reconcile pattern → renamed to receipt verification + phantom-receipt reconcile.
- The MCP surface + x402 handling (the `okx-agent-payments-protocol` + `okx-ai` skill shapes).
- The docs/rubric/SUBMISSION/judge-map structure.
**NOT inherited:** the tokenized-equity gap engine, Solana/BSC execution rails, the weekend-gap thesis. This is a different product.

---

## 7. Immediate next actions
1. Lock Stocklana submit (Sep 25) — do not start Merit capital before that.
2. Create `~/merit` git repo, push public; write `.env.example`.
3. Phase 0: verify Monad testnet + P256 `0x0100` + x402 v2 facilitator on Monad; decide RPC (Chainstack/Crouton/Spectrum pro-free plans).
4. Phase 1: ERC-8004 register + paid-MCP/x402 gateway + receipt write (the money path — verify past the challenge).
5. Add Monad Metropolis to the tracker with Oct 13 deadline.