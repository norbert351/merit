# Merit — Monad Testnet Deployment

Network: **Monad testnet**, chainId **10143**, gas token **MON**. RPC `https://testnet-rpc.monad.xyz`.
No mainnet deployment was performed (out of scope for this task).

## Live contract suite
| Contract | Address | Notes |
|---|---|---|
| MeritIdentity | `0xD85ddb55316dD0F9D46Ec9BBb92A8A1FFE2E278c` | agent registration |
| MeritReputation | `0x92A11Ad0E988C6cd0Bd434e140331A620393114D` | settled-receipt ledger + sybil-resistant score |
| MeritMandate | `0xa8071a14D27E90923204a1B5098658611AC4E17d` | escalation-proof checker |
| **GuardedWallet** | `0x357010738b21724639eb427c52B99a3eFb8Fa1Cd` | **execution-boundary mandate guard** (added this pass) |

Deployer / admin / authorized executor: `0xda8f57C8dE496B532133678ca0Bd5BbfB9787B51` (funded, behalf testnet).

## GuardedWallet deployment (2026-10-12)
- Config: reputation = `0x92A1…114D`, agentId = 1, admin=executor=deployer, `microUsdPerWei = 1`.
- Deploy tx: `0xfb1b7e51bdc5330ceb0e028355faa4332ce8ac2f6619918c96b037ff37734331` (status `0x1`) — deployed via CREATE2.
- Funded with 0.05 MON (`receive()`).

## Live execution-boundary proof (verified on-chain, 2026-10-12)
| Step | Observable | Result |
|---|---|---|
| agent 1 score at start | `cast call MeritReputation scoreOf(1)` | $21 → tier NONE → cap **$0** |
| over-cap attempt (any value) | `GuardedWallet.execute(dest, 1 wei)` | **REVERTED** on-chain: `GuardedWallet: exceeds per-transaction cap` |
| raise score | broadcast verified `recordReceipt(1, 0x…aa, $45, true, true)` | score → **$71** → tier LOW → cap **$10** (`maxSpendWei()` = `10000000`) |
| **allowed** transfer | `GuardedWallet.execute(dest, 100 wei)` | **EXECUTED** — `spent()` = 200, destination balance = 200 wei, guard −200 |
| **over-cap** transfer | `GuardedWallet.execute(dest, 20,000,000 wei)` | **REVERTED** — destination balance unchanged (200) |

Every value is re-readable with generic tooling:
```bash
export PATH="$HOME/.foundry/bin:$PATH"
R=https://testnet-rpc.monad.xyz
GUARD=0x357010738b21724639eb427c52B99a3eFb8Fa1Cd
REP=0x92A11Ad0E988C6cd0Bd434e140331A620393114D
DEST=0x12340000000000000000000000000000000000ab
cast call $GUARD "maxSpendWei()(uint256)" -r $R     # -> 10000000  ($10 earned cap)
cast call $GUARD "spent()(uint256)" -r $R            # -> 200       (wei spent this period)
cast balance $DEST -r $R                             # -> 200       (the allowed transfer landed)
cast call $REP "scoreOf(uint256)(uint256,uint256,uint256,uint256,bool)" 1 -r $R  # -> 71000000 ($71)
```

## Deploy / reproduce
```bash
export PATH="$HOME/.foundry/bin:$PATH"
cd contracts
# full suite (creates fresh identity/reputation/mandate)
PRIVATE_KEY=<executor> forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast
# the guarded wallet pointing at the EXISTING live reputation:
PRIVATE_KEY=<executor> forge script script/DeployGuarded.s.sol --rpc-url monad_testnet --broadcast
```
Never prints the key; the key stays in the environment / a gitignored `data/.env.testnet`.

## Config separation
- `src/monad/config.mjs` — network + verified layer split (x402 + P256 on testnet & mainnet; ERC-8004 registries **mainnet-only**).
- `render.yaml` — a production deploy runs `mode:"live"` only when `MERIT_EXECUTOR_KEY` is set (else honest `mode:"demo"`).
- No production/mainnet credentials are enabled by this task.

## Known limits
- Canonical **mainnet** ERC-8004 `register()` is not performed (needs a funded mainnet wallet) — documented ⚠️.
- `envio deploy` (hosting) is not run (no token) — indexer is a labelled bounty layer; on-chain `scoreOf` is authoritative.