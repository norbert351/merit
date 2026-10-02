# Merit Contracts — Monad Testnet Deployment

Deployed and **verified live on Monad testnet (chainId 10143)** on 2026-10-02 with the funded
executor wallet `0xda8f57C8dE496B532133678ca0Bd5BbfB9787B51`.

## Deployed addresses (all confirmed status=true on-chain)
| Contract | Address | Deploy tx |
|---|---|---|
| **MeritIdentity** | `0x355A0d78153eF5ba882511275EB8976438844C67` | `0x5db4…3fa` |
| **MeritReputation** | `0x38610eFDE0F68CA4BC2d4F56d3540B9A68B2162d` | `0xdcab…267` |
| **MeritMandate** | `0x83E4176FE2295a9898E2AC01fdA51b8443F282ED` | `0x2dc5…d22` |

## Why local contracts instead of ERC-8004 on testnet
The canonical ERC-8004 Identity/Reputation registries are deployed on **mainnet (143) only** —
`getCode` returns empty on testnet. To make the full Merit loop run live with the funded
**testnet** wallet, this suite re-implements the same surface Merit needs (register → receipts →
sybil-resistant score → escalation-proof mandate) so the demo is **real on-chain**, not simulated.
Mainnet's ERC-8004 remains the anchor in production; uses cover identity + reputation there.

## Live on-chain proof (agent #1, read back 2026-10-02)
| Measure | Value | Meaning |
|---|---|---|
| `ownerOf(1)` | `0xda8f…7B51` | executor owns the agent |
| `receiptCount(1)` | 51 | 50 sock-puppet dust + 1 real verified settlement |
| `scoreOf(1)` | 6,000,000 micro-USD = **$6** | = $1 settled + 1 distinct verified client × $5 |
| sybilDetected | true | 50-puppet cluster suppressed to $0 |
| effSettled | $1.00 | one real verified settlement only |
| `mandateOf(1)` | tier=NONE, maxSpend=$0 | score $6 < $50 low-tier threshold → no authority |

## Demo output (live broadcast, script/Demo.s.sol)
```
DEMO 1: score 0, effSettled 0, distinctVerified 0, sybil 1   → PASS (fake agents can't buy a score)
DEMO 2: score 6000000, effSettled 1000000, distinctVerified 1 → PASS (one settlement outweighs 50 puppets)
DEMO 3: allowed 0, effectiveTier 0 (NONE) -> HIGH requested clamped down, spend $50 denied → PASS
```

## Reproduce
```bash
export PATH="$HOME/.foundry/bin:$PATH"
cd contracts
export PRIVATE_KEY=<executor key>   # or MERIT_EXECUTOR_KEY from ../data/.env.testnet
forge build
forge test                                        # 6/6 on-chain moat tests
forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast
forge script script/Demo.s.sol  --rpc-url monad_testnet --broadcast
```

## Structure
- `src/MeritIdentity.sol` — agent registration (register/ownerOf/update/deactivate)
- `src/MeritReputation.sol` — settled-receipt ledger + on-chain sybil-resistant score (mirrors `src/reputation/onchain-score.mjs`)
- `src/MeritMandate.sol` — escalation-proof binding authority (mirrors `src/mandate/mandate.mjs`)
- `test/Merit.t.sol` — 6 Foundry tests proving the moat on-chain
- `script/Deploy.s.sol` / `script/Demo.s.sol` — deploy + live demo