// Merit — one-shot CANONICAL ERC-8004 registration on Monad MAINNET (chainId 143).
//
// This is the turnkey bridge for the "canonical mainnet ERC-8004 registration" blocker.
// It is deliberately a thin wrapper over the already-reviewed src/monad/erc8004.mjs
// registerAgent() adapter — nothing new, no fabricated ids (agentId is parsed from the
// real `Registered` event, verified via the transaction receipt).
//
//   MERIT_MAINNET_KEY=0x... node scripts/register-mainnet.mjs [agentURI]
//
// The key is read from the environment (or `PRIVATE_KEY`) and is NEVER printed. Requires a
// FUNDED Monad mainnet wallet (gas for register()); the registries are mainnet-only
// (0x8004A1… Identity, 0x8004BA… Reputation, per src/monad/config.mjs).
//
// Mainnet is real value — this script only goes out when YOU supply the funded key. There is
// no testnet fallback and no dry-run that could masquerade as success.

import { registerAgent } from "../src/monad/erc8004.mjs";

const key = process.env.MERIT_MAINNET_KEY || process.env.PRIVATE_KEY;
if (!key) {
  console.error("❌ Set MERIT_MAINNET_KEY (or PRIVATE_KEY) to a FUNDED Monad mainnet key. Intentionally exits without touching mainnet.");
  process.exit(1);
}
const agentURI = process.argv[2] || "ipfs://merit-agent-1/mainnet";

console.log("Registering canonical ERC-8004 identity on Monad MAINNET (chainId 143)…");
console.log("  registry:", "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432");
console.log("  agentURI:", agentURI);

const out = await registerAgent({ which: "mainnet", privateKey: key, agentURI });

// Only print the verified, on-receipt values — never the key.
console.log("\n✅ Canonical ERC-8004 registration confirmed on-chain (err===null):");
console.log("  txHash:    ", out.txHash);
console.log("  block:     ", out.blockNumber);
console.log("  agentId:   ", out.agentId, "(parsed from the Registered event)");
console.log("  registry:  ", out.registry);
console.log("  chainId:   ", out.chainId);
console.log("\nRecord this agentId in docs/DEPLOYMENT_MONAD_TESTNET.md (mainnet section) and SUBMISSION.md.");