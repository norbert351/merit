# Merit — Roadmap (demo → product)

Merit shipped a working Track-04 build: a sybil-resistant, settled-money-weighted agent
reputation that is **cryptographic end-to-end** (a client is "verified" only by a P-256 passkey
assertion checked against Monad's EIP-7951 precompile) and **load-bearing** (the score caps the
agent's authority). This page is what turns that into a real product.

## Shipped today (Oct 12, 2026)
- Sybil-resistant score engine, re-derivable by a stranger, mirrored on-chain.
- P-256 passkey verified-client identity via the Monad `0x0100` precompile.
- x402 v2 hire-then-settle flow (HTTP 402 → sign → settle → receipt on `err===null`).
- Escalation-proof binding mandate.
- Mobile-first hire-then-settle UI, honest live/demo labeling.
- Envio indexer graph for the settled-receipt trail.
- `27/27` JS + `8/8` contract tests; contracts live on Monad testnet.

## Next features (honest — not yet built)
- **WebAuthn instead of in-browser WebCrypto.** The P-256 crypto is already WebAuthn-identical;
  swap the demo passkey (`public/app.js` `getPasskey`) for a real `navigator.credentials` call so
  a phone/hardware key is the verifier. Same server rail, no change to `0x0100`.
- **Passkey → smart-account custody** (the Mera "passkey->EOA" bounty angle): bind the passkey to
  an on-chain owned account so an agent's *identity and wallet* are one passkey, not a server-chosen
  address.
- **Canonical ERC-8004 registration on mainnet.** `src/monad/erc8004.mjs` register + giveFeedback is
  ready; needs a funded mainnet wallet to call the canonical registry (currently the testnet suite
  re-implements the surface).
- **Envio Cloud deploy** for the hosted receipt graph (the `$5K` hosting bounty) — config + handlers
  are in-repo; only an `ENVIO_API_TOKEN` + `envio deploy` is missing.
- **Multi-agent reputation discovery** — surface the on-chain graph as a public endpoint any agent
  framework can read, with a `scoreOf(agentId)` recompute-per-block.
- **Mandate on a real execution rail** — plug the bind into an actual spend/executor (agents today
  demonstrate the cap; production wiring to a wallet/session is next).

## Path to a user base
1. **Pick two lighthouse agents** (a data oracle + a vault guard) whose developers want a
   verifiable, buyable-proof reputation to win hirers.
2. Charge per settled call via x402; the receipt ledger *is* the marketing (a score nobody can
   fake sells itself).
3. Open the re-derivation command + indexer query so any stranger validates any agent's score
   without trusting us — the durable moat (external falsifiability, not a dashboard).

## What it would take demo → product
- A funded executor/market-maker key for continuous live settlement (today bounded to a testnet
  demo wallet; mainnet settlement + ERC-8004 anchor need mainnet capital).
- Persistent, multi-tenant identity (WebAuthn + smart-account custody above) so agents and buyers
  are real, portable identities.
- Keep-alive + uptime on the deployed app through judging and beyond.

## Out of scope (deliberately) — the anti-thesis
A reputation **dashboard**/browser over ERC-8004, or a spend-limits wallet UI — both already exist
(8004scan, MetaMask Agent Wallet, AgentPMT) and read as "platform". Merit stays **one mechanism**:
settled-money + passkey-verified client weighting as a binding authority cap.