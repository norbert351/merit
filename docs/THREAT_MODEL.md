# Merit — Threat Model

Trust boundaries, threat actors, and the specific mitigations each surfaced. Companion to
`SECURITY_AUDIT.md`; every mitigation has a regression test listed.

## Assets
1. **Agent score** — must not be buyable (sybil-resistant).
2. **Passkey identity** — must not be hijackable (key replacement) or reusable (replay).
3. **Authority mandate** — must be genuinely enforced at the execution boundary.
4. **Settled-money receipts** — must correspond to real, verified payments (no fake receipts).

## Trust boundaries
- **Browser** = untrusted. Supplies signatures, a clientId, paymentId; NEVER a `verified`/score flag.
- **Merit API server** = trusted. It is the only writer of `payerVerified`, the only consumer of the
  facilitator and the precompile, and the only caller of `recordReceipt`.
- **Monad testnet contracts** = trusted but *not* privileged: `recordReceipt` is `onlyAdmin` (admin =
  the server's executor) and `GuardedWallet.execute` is `onlyAuthorizedExecutor`.
- **x402 facilitator** = a semi-trusted external verifier; the server **fails closed** if it is
  unavailable or returns `isValid:false`.
- **Envio indexer** = read-only, for re-derivation only; never authoritative.

## Threat actors
| Actor | Goal | Blocker |
|---|---|---|
| Sybil sock-puppet (many fake wallets) | inflate a score via praise | unverified + sub-$0.50 dust clusters are zeroed; can't be verified without a real P-256 passkey per key |
| Attacker who knows a `clientId` | overwrite the victim's public key | immutable registration + proof-of-possession (challenge signature verified via precompile) |
| Replayer | reuse a signature/challenge to double-credit | server-issued, expiring, single-use challenges (durably stored) + unique `paymentId` |
| Forger | fabricate `verified`/`settled` | `payerVerified` is set ONLY by the precompile result; a client-supplied flag is never accepted |
| Over-spender | exceed the mandate | `GuardedWallet.execute` reverts the real transfer (per-tx + cumulative-per-period caps from the live on-chain score) |
| Cross-client / cross-chain replay | use another client's signature | challenge is bound to clientId + agentId + amount + network |

## Threat: actions → mitigations
- **Fabricated payment** → `PaymentVerifier` requires a facilitator-verified signature; any error/timeout ⇒ `UNVERIFIED` (fail closed).
- **Failed/reverted/paid-wrong-recipient settlement** → `confirmSettlement` checks on-chain receipt status + `to`; never trusts a client-supplied hash.
- **Demo seed data inflating the real score** → `source` column; `trustedScore` only from `source=live`/on-chain; seed rows only move a labelled demo score (`test/security.test.mjs`).
- **Score arithmetic inconsistency** (JS vs Solidity) → uniform micro-USD spec; parity regression test (`test/security.test.mjs`).
- **Mandate is advisory** → `GuardedWallet` makes enforcement real (transfer reverts); live-proven on testnet.

## Assumptions / honest limits
- A distinct passkey is a distinct *key*, not a distinct human.
- The API server's executor key is the admin of the receipts + guarded wallet; compromise of that
  server key is out of scope (defense-in-depth note: `GuardedWallet.execute` is the only spend path).
- Rate limits are per-process; the canonical mainnet ERC-8004 registration is a documented ⚠️.