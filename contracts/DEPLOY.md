# Merit Contracts — Monad Testnet Deployment

Deployed and **verified live on Monad testnet (chainId 10143)** with the funded
executor wallet `0xda8f57C8dE496B532133678ca0Bd5BbfB9787B51` (balance ~3.87 MON).

> **Current live suite (2026-10-11)** — the *enriched* build (8-arg `ReceiptRecorded` +
> `SybilClusterSuppressed`) that the Envio indexer (`../indexer/`) indexes. An earlier 2026-10-02
> suite (`0x355A…` / `0x3861…` / `0x83E4…`) is superseded.

## Deployed addresses (all confirmed status=true on-chain)
| Contract | Address |
|---|---|
| **MeritIdentity** | `0xD85ddb55316dD0F9D46Ec9BBb92A8A1FFE2E278c` |
| **MeritReputation** | `0x92A11Ad0E988C6cd0Bd434e140331A620393114D` |
| **MeritMandate** | `0xa8071a14D27E90923204a1B5098658611AC4E17d` |

## Why local contracts instead of ERC-8004 on testnet
The canonical ERC-8004 Identity/Reputation registries are deployed on **mainnet (143) only** —
`getCode` returns empty on testnet. To make the full Merit loop run live with the funded
**testnet** wallet, this suite re-implements the same surface Merit needs (register → receipts →
sybil-resistant score → escalation-proof mandate) so the demo is **real on-chain**, not simulated.
Mainnet's ERC-8004 remains the anchor in production.

## Live on-chain proof (agent #1, read back 2026-10-11)
| Measure | Value | Meaning |
|---|---|---|
| `ownerOf(1)` | `0xda8f…7B51` | executor owns the agent |
| `receiptCount(1)` | 51 | 50 sock-puppet dust + 1 real verified settlement |
| `scoreOf(1)` | 6,000,000 micro-USD = **$6** | = $1 settled + 1 distinct verified client × $5 |
| sybilDetected | true | 50-puppet cluster suppressed to $0 |
| effSettled | $1.00 | one real verified settlement only |
| `mandateOf(1)` | tier=NONE, maxSpend=$0 | score $6 < $50 low-tier threshold → no authority |

## Events emitted live (drives the Envio indexer)
Both enriched events confirmed on-chain in the demo broadcast (block ~70068431):
- `ReceiptRecorded(uint256 indexed agentId, address indexed payer, uint64 amountMicroUsd, bool verified, bool delivered, bytes32 deliverableHash, uint256 scoreAfter, bool sybilDetected)` — sig `0x9cad01cf…`
- `SybilClusterSuppressed(uint256 indexed agentId, uint256 clusterSize, uint256 suppressedMicroUsd)` — sig `0x33a5d2a8…`

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
forge test                                        # 8/8 on-chain moat tests
forge script script/Deploy.s.sol --rpc-url https://testnet-rpc.monad.xyz --broadcast
forge script script/Demo.s.sol   --rpc-url https://testnet-rpc.monad.xyz --broadcast
```

## Structure
- `src/MeritIdentity.sol` — agent registration (register/ownerOf/update/deactivate)
- `src/MeritReputation.sol` — settled-receipt ledger + on-chain sybil-resistant score (mirrors `src/reputation/onchain-score.mjs`) + enriched receipt/suppression events
- `src/MeritMandate.sol` — escalation-proof binding authority (mirrors `src/mandate/mandate.mjs`)
- `test/Merit.t.sol` — 8 Foundry tests proving the moat on-chain (incl. event assertions)
- `script/Deploy.s.sol` / `script/Demo.s.sol` — deploy + live demo
