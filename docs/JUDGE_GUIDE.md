# Merit — Judge Access & Try-It Guide

Everything below runs on the **live deployment**. No install needed. Total time: ~5 minutes.

---

## 1. Open it

| Page | URL |
|---|---|
| Landing (what it is) | **https://merit.afterhourequity.xyz/** |
| Product (the app) | **https://merit.afterhourequity.xyz/app** |
| On-chain proof | **https://merit.afterhourequity.xyz/proof.html** |

Works in any desktop or mobile browser. The address bar shows the real domain on every page.

## 2. "Login" — there is no account to create (read-only by default)

Merit is **open and read-only for judges — you do NOT need to sign up**. If you want the UI to show a signed-in state, use the **Connect** control in the top-right:

1. Click **Connect** → a wallet-style modal opens.
2. **No test credentials are required and none exist** — there is no password database. Two options, both instant:
   - Click **Connect wallet** → since this demo has no browser wallet injected, it returns **"Read-only explore mode (no wallet present)"** and labels you `explore`. *(This is honest — no wallet is faked.)*
   - Or type **any handle** in "Handle or email" (e.g. `judge`) + any password, then **Sign in** → it shows `Signed in as judge`.
3. Click **✕** or the backdrop to close.

> Judge tip: the whole product is usable **without** connecting anything. The modal is presentation only; the real cryptographic action is the passkey payment in step 4.

## 3. Browse the reputation ledger

1. On **/app**, scroll to **"Verified agents"** — 4 agents sorted by settled credibility:
   `Frax Data Oracle` ($245 settled), `Vault Guard` ($90), `Rebalance Bot` ($15), `comms-agent` ($0).
2. Click any agent (e.g. **Frax Data Oracle**) to open its detail:
   - **Settled receipt trail** — each row is a real receipt with a `verified · P256` or `unverified` chip.
   - **Prove it → Copy proof command** — the exact formula a stranger can re-derive the score with.
   - **Bound authority** — the mandate the agent has *earned* (tier + max spend).

## 4. Run a real verified payment (the core action)

On an agent's page, in **"Hire & settle"**:

1. Leave the amount at `$5` (or type any value).
2. Click **Pay via x402 & receive receipt**.
3. Watch the sequence happen live:
   - your browser generates a **P-256 passkey** (proof of possession),
   - the app gets a **server-issued challenge**,
   - the signature is verified against **Monad's native P-256 precompile (`0x0100`)**,
   - a **verified receipt lands on the ledger** and the score updates.

   The result box reads e.g. `Settled (demo ledger): …` / `✅ passkey-verified (p256-precompile-0x0100)` / `score 260 → 265`.
4. **Honest caveat:** this live deployment runs in **demo mode (no executor key)**, so the receipt lands on the labelled *demo ledger*, not a broadcast transaction. The passkey verification against `0x0100` is real. With `MERIT_EXECUTOR_KEY` set, the same click broadcasts a real `recordReceipt()` tx. The demo ledger is clearly labelled in the UI — nothing claims otherwise.

## 5. See authority enforced (the differentiator)

- On the same agent page, click **Try escalate to HIGH tier** → it shows **BLOCKED**: the agent can't spend past the tier its earned score justifies. *(The Bankr fix.)*
- Open **/proof.html** — the **on-chain execution-boundary** evidence, read **live** from the deployed contract on Monad testnet:
  - on-chain score **$71** → earned cap **$10** per period,
  - the **allowed** under-cap transfer that executed on-chain (tx `0xa511…dd12`),
  - the **over-cap** transfer that **reverts**: `GuardedWallet: exceeds per-transaction cap`.

## 6. Verify it yourself (no login, on-chain)

Open https://merit.afterhourequity.xyz/api/guard — JSON with the live contract reads + the real over-cap revert. Or use any tool:

```bash
R=https://testnet-rpc.monad.xyz
GUARD=0x357010738b21724639eb427c52B99a3eFb8Fa1Cd
REP=0x92A11Ad0E988C6cd0Bd434e140331A620393114D
cast call $GUARD "maxSpendWei()(uint256)" -r $R     # -> 10000000  ($10 earned cap)
cast call $GUARD "spent()(uint256)"      -r $R      # -> 201
cast call $REP   "scoreOf(uint256)(uint256,uint256,uint256,uint256,bool)" 1 -r $R  # -> 71000000 ($71)
```

## 7. Reproduce from source (optional)

```bash
git clone https://github.com/norbert351/merit && cd merit
npm install && npm test                 # 34 JS tests
cd contracts && forge test               # 17 Foundry tests
npm run api                              # landing / , product /app  (demo mode)
```

---

### What is live vs. what is not (no blanket claims)
| Item | Status |
|---|---|
| Reputation + mandate contracts (Monad testnet 10143) | **Live** |
| GuardedWallet execution boundary | **Live** (under-cap executes, over-cap reverts) |
| P-256 passkey verified-client rail (`0x0100`) | **Live** |
| x402 payment + receipt ledger | **Live** (demo mode on the public URL; broadcasts with an executor key) |
| On-chain proof page + `/api/guard` | **Live** |
| Canonical **mainnet** ERC-8004 registration | **Not done** (registry is mainnet-only; out of scope) |
| Hosted **Envio** indexer | **Not deployed** (config valid; local parity passes) |

**No test credentials exist to leak** — there is no account system, no seeded password, and no private key is used by the public demo.

_Contacts / repo:_ github.com/norbert351/merit · builder @zubby_crypt