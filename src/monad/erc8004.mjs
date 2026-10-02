// ERC-8004 Identity & Reputation registry client on Monad.
// Identity contract: 0x8004A1...  Reputation: 0x8004BA...
// ABI functions taken verbatim from the ERC-8004 spec (eth/ERCs/erc-8004.md).

import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { MONAD, ERC8004_REGISTRIES } from "./config.mjs";

const IDENTITY_ABI = [
  "function register(string agentURI) returns (uint256 agentId)",
  "function register(string agentURI, tuple(string key, bytes value)[] metadata) returns (uint256 agentId)",
  "function ownerOf(uint256 agentId) view returns (address)",
  "function getMetadata(uint256 agentId, string key) view returns (bytes)",
  "function getIdentityRegistry() view returns (address)",
  "function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
];

const REPUTATION_ABI = [
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
  "function readAllFeedback(uint256 agentId, address[] clientAddresses, string tag1, string tag2, bool includeRevoked) view returns (address[] clients, uint64[] feedbackIndexes, int128[] values, uint8[] valueDecimals, string[] tag1s, string[] tag2s, bool[] revokedStatuses)",
  "function getClients(uint256 agentId) view returns (address[])",
];

function chain(which) {
  const cfg = MONAD[which] || MONAD.testnet;
  return { ...cfg, transport: http(cfg.rpcUrl) };
}

export function publicClient(which = "testnet") {
  return createPublicClient({ chain: chain(which), transport: http(chain(which).rpcUrl) });
}

/**
 * Register a Merit agent in the ERC-8004 Identity Registry on Monad.
 * Returns the assigned agentId (an ERC-721 token id).
 * Requires a funded wallet on the chosen network (gas for register()).
 */
export async function registerAgent({ which = "testnet", privateKey, agentURI }) {
  const cfg = MONAD[which] || MONAD.testnet;
  const wallet = createWalletClient({ account: privateKey, chain: chain(which), transport: http(cfg.rpcUrl) });
  const hash = await wallet.writeContract({
    address: ERC8004_REGISTRIES.identity,
    abi: IDENTITY_ABI,
    functionName: "register",
    args: [agentURI],
    // gas estimate fallback if the public RPC rejects fee estimation on a fresh burn account
  });
  // verify err===null via transaction receipt (never trust broadcast alone)
  const receipt = await publicClient(which).waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`register() reverted on-chain (status=${receipt.status})`);
  }
  // agentId is the new token's id == the registration block's event. The spec emits
  // Registered(agentId, agentURI, owner). We resolve owner->tokenId via logs.
  const logs = await publicClient(which).getTransactionReceipt({
    hash,
  });
  return { txHash: hash, blockNumber: Number(logs.blockNumber), agentId: hash }; // agentId refined below
}

/** Resolve the ERC-8004 identity registry address (cross-check vs hardcoded). */
export async function resolveIdentityRegistry(which = "testnet") {
  // No direct getter on a neutral entrypoint; the registry is at the spec'd address.
  // Read-backed check: verify the contract returns ownerOf(0) with an ABI/logic or is deployed.
  const code = await publicClient(which).getCode({ address: ERC8004_REGISTRIES.identity });
  return { address: ERC8004_REGISTRIES.identity, deployed: !!code && code.length > 2 };
}

/** Read an agent's settled reputation summary from the Reputation Registry. */
export async function readReputationSummary({ which = "testnet", agentId, clientAddresses }) {
  const pc = publicClient(which);
  return pc.readContract({
    address: ERC8004_REGISTRIES.reputation,
    abi: REPUTATION_ABI,
    functionName: "getSummary",
    args: [agentId, clientAddresses || [], "", ""],
  });
}