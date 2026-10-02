// Live on-chain Merit contract client (Monad testnet) — wires the deployed suite into the app.
// Reads the REAL deployed reputation contract so the app's score == the on-chain score.
// Addresses verified live (DEPLOY.md + cast code == non-empty) 2026-10-02.

import { createPublicClient, http, formatUnits } from "viem";
import { MONAD } from "../monad/config.mjs";

export const MERIT_CONTRACTS_TESTNET = {
  identity: "0x355A0d78153eF5ba882511275EB8976438844C67",
  reputation: "0x38610eFDE0F68CA4BC2d4F56d3540B9A68B2162d",
  mandate: "0x83E4176FE2295a9898E2AC01fdA51b8443F282ED",
};

const chain = { ...MONAD.testnet };
function pc() {
  return createPublicClient({ chain, transport: http(chain.rpcUrl) });
}

// viem object-form ABI (human-readable shorthand enums must be expanded in this viem build).
const u256 = { internalType: "uint256", name: "", type: "uint256" };
const bool_ = { internalType: "bool", name: "", type: "bool" };
const a_ = { internalType: "address", name: "", type: "address" };
const bytes32_ = { internalType: "bytes32", name: "", type: "bytes32" };
const u8 = { internalType: "uint8", name: "", type: "uint8" };
const u64 = { internalType: "uint64", name: "", type: "uint64" };
const i128 = { internalType: "int128", name: "", type: "int128" };

const REP_ABI = [
  {
    type: "function", name: "scoreOf", stateMutability: "view",
    inputs: [{ ...u256, name: "agentId" }],
    outputs: [
      { ...u256, name: "score" }, { ...u256, name: "settledMicroUsd" },
      { ...u256, name: "effectivelySettledMicroUsd" }, { ...u256, name: "distinctVerifiedClients" },
      { ...bool_, name: "sybilDetected" },
    ],
  },
  {
    type: "function", name: "recordReceipt", stateMutability: "nonpayable",
    inputs: [
      { ...u256, name: "agentId" }, { ...a_, name: "payer" }, { ...u64, name: "amountMicroUsd" },
      { ...bool_, name: "verified" }, { ...bool_, name: "delivered" }, { ...bytes32_, name: "deliverableHash" },
    ],
    outputs: [],
  },
];
const MAND_ABI = [
  {
    type: "function", name: "mandateOf", stateMutability: "view",
    inputs: [{ ...u256, name: "agentId" }],
    outputs: [{ ...u8, name: "tier" }, { ...u256, name: "maxSpendMicroUsd" }, { ...u256, name: "scoreMicroUsd" }],
  },
  {
    type: "function", name: "enforce", stateMutability: "nonpayable",
    inputs: [
      { ...u256, name: "agentId" }, { ...u256, name: "requestedTier" }, { ...u256, name: "requestedSpendMicroUsd" },
    ],
    outputs: [{ ...bool_, name: "allowed" }, { ...u8, name: "effectiveTier" }, { ...u256, name: "maxSpendMicroUsd" }],
  },
];

/** Read the live on-chain score for an agent. Returns human USD + components. */
export async function onchainScoreOf(agentId) {
  const c = pc();
  const [score, settled, eff, distinctVerified, sybil] = await c.readContract({
    address: MERIT_CONTRACTS_TESTNET.reputation,
    abi: REP_ABI,
    functionName: "scoreOf",
    args: [agentId],
  });
  return {
    scoreUsd: Number(formatUnits(score, 6)),
    settledUsd: Number(formatUnits(settled, 6)),
    effectivelySettledUsd: Number(formatUnits(eff, 6)),
    distinctVerifiedClients: Number(distinctVerified),
    sybilDetected: sybil,
  };
}

/** Live mandate read. */
export async function onchainMandateOf(agentId) {
  const c = pc();
  const [tier, maxSpend, scoreUsd] = await c.readContract({
    address: MERIT_CONTRACTS_TESTNET.mandate,
    abi: MAND_ABI,
    functionName: "mandateOf",
    args: [agentId],
  });
  const T = ["none", "low", "medium", "high"];
  return { tier: T[Number(tier)], maxSpendUsd: Number(formatUnits(maxSpend, 6)), scoreUsd: Number(formatUnits(scoreUsd, 6)) };
}