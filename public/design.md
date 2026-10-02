# Merit — Hire-then-Settle UI · Design System (design-first)

## 1. The product (what a judge/new user experiences)
Merit is a **credibility ledger for AI agents**. A buyer's flow is **hire → settle → trust**:
1. **Hire** — pick a vetted agent. Its reputation isn't a count of star ratings; it's a
   **credibility score only built from money that actually settled**, weighted by distinct
   verified paying humans, with bot/sock-puppet clusters actively zeroed.
2. **Settle** — pay via x402 (HTTP 402 → sign → settle on Monad). This is what mints the proof.
3. **Trust / authority** — the earned score *binds how much spend authority the agent may take*.
   Escalating a permission tier still can't go past what the score earned (the Bankr fix).

The single memorable trait: **reputation you can read as a receipt, not a rating.**

## 2. Tone + audience
- **Tone:** trustworthy, precise, calm — "the audit trail you can feel." Not hype, not crypto-bro.
- **Audience:** buyers hiring agents (risk-averse, want proof), plus judges (want the mechanism legible).
- **Feeling:** a premium **financial audit / ledger** aesthetic — receipts, proof, paper-trail.

## 3. Palette (deliberately NOT dark-crypto-default)
Theme: **light, editorial, ledger-on-paper**. This is the deliberate anti-generic choice —
most agent/AI UIs go dark-cyber; Merit goes **trustworthy print-finance**.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#F7F5F0` | warm paper background |
| `--panel` | `#FFFFFF` | cards / ledgers |
| `--line` | `#E4DFD4` | hairlines, table rules |
| `--ink` | `#1A1712` | primary text |
| `--muted` | `#6B655A` | secondary text |
| `--accent` | `#C05218` | amber-oxide "seal" (verified / paid) |
| `--accent2` | `#1E6E5C` | green "settled" / positive |
| `--danger` | `#B3331F` | denied / suppressed (sybil) |
| `--verified` | `#E8F1EC` | verified-client chip bg |

**Why amber-oxide + evergreen on paper:** reads as ink/seal/financial proof, not a neon dashboard.
**Banned:** purple→blue mesh, neon glows, rainbow orbs.

## 4. Typography
- **Display (H1/hero/statement):** `Fraunces` (Google) — a distinctive high-contrast serif; reads
  "ledger / established / trustworthy", the opposite of generic geometric sans.
- **Body / UI:** `Public Sans` (Google) — clean, calm, highly legible for a data/product UI.
- **Mono (amounts, hashes, addresses):** `JetBrains Mono` — the "receipt" readouts.
Loaded via CDN `<link>` (static SPA, no build).

## 5. Composition variation (locked — deliberately unique)
| Axis | Locked choice |
|---|---|
| Theme | Light editorial "ledger on paper" |
| Background | Warm paper `--bg` + hairline grid, no gradient chaos |
| Typography | Fraunces display + Public Sans body + JetBrains Mono |
| Hero architecture | **Split: left = live agent-dossier proof panel, right = hire CTA** — but NOT a stock photo; the left panel is a *live reputation ledger* (a receipt-stack card) that IS the product |
| Section system | Hiring browse (agent cards w/ credibility meters) → detail (the "receipt trail") → settle/authority (binding mandate meter) |
| Motion | subtle: credibility meter fills, seal "stamps" on verified, receipts slide in on settlement. No scroll-reveal hiding content |

## 6. Key screens (hire-then-settle)
1. **Hire (browse):** grid of agent cards, each = identity + **credibility meter** (score as a
   filled seal/ring + "settled $" + distinct-verified-client count + sybil flag), a "Hire" action.
2. **Agent detail / receipt trail:** a stacked **ledger of settled receipts** (proof), each showing
   payer-verified chip, settled amount, hash. The judge can read the money-path proof.
3. **Settle (x402):** the paywall is *shown to be real* — a 402 challenge card decodes to
   `accepts[]`/amount/payTo; paying "stamps" a receipt onto the ledger.
4. **Authority (mandate):** a binding-meter showing earned tier (none/low/medium/high) + max
   authorizable spend; an escalate attempt visibly **clamped** back to the earned tier (Bankr proof).
5. **Auth:** Connect wallet pill in the navbar → wallet-style modal (per kit rule). Read-only
   explore mode for judges.

## 7. Honest-wiring rule
The UI reads live on-chain score/mandate where the backend exposes it; when pointed at a bare
static build it renders the *in-browser demo* and labels it plainly ("demo ledger · pending live
backend") — never claim fabricated "settled on-chain" numbers.

## 8. Anti-generic checklist (composition audit pass at the end)
- [ ] Light editorial (not dark terminal)
- [ ] Amber-oxide seal + evergreen settled (not neon)
- [ ] Fraunces serif display (distinctive)
- [ ] Real "receipt ledger" as the visual centerpiece (not stock photo / not generic cards)
- [ ] Credibility meter + binding mandate meter (mechanism made legible)
- [ ] Mobile-first (true 390px), connect-wallet modal in navbar