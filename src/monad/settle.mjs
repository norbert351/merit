// On-chain settlement — the REAL money path to the deployed MeritReputation contract on Monad.
//
// Only active when MERIT_EXECUTOR_KEY is set (a funded Monad testnet key). Absent -> hasExecutor()
// is false and the API runs in honest "demo" mode (labeled, never claimed as on-chain).
//
// err===null discipline: we broadcast recordReceipt(agentId, payer, amountMicroUsd, verified,
// delivered, deliverableHash) and then WAIT for the receipt. A settled receipt is recorded IFF
// the tx status === "success". We never trust the broadcast alone.

import { createWalletClient, createPublicClient, http, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MONAD } from "./config.mjs";
import { MERIT_CONTRACTS_TESTNET } from "./merit-contracts.mjs";

const u256 = { internalType: "uint256", name: "", type: "uint256" };
const bool_ = { internalType: "bool", name: "", type: "bool" };
const a_ = { internalType: "address", name: "", type: "address" };
const bytes32_ = { internalType: "bytes32", name: "", type: "bytes32" };
const u64 = { internalType: "uint64", name: "", type: "uint64" };

const REP_ABI = [
  {
    type: "function", name: "recordReceipt", stateMutability: "nonpayable",
    inputs: [
      { ...u256, name: "agentId" }, { ...a_, name: "payer" }, { ...u64, name: "amountMicroUsd" },
      { ...bool_, name: "verified" }, { ...bool_, name: "delivered" }, { ...bytes32_, name: "deliverableHash" },
    ],
    outputs: [],
  },
];

export function hasExecutor() {
  return Boolean(process.env.MERIT_EXECUTOR_KEY);
}

function clients() {
  const key = process.env.MERIT_EXECUTOR_KEY;
  if (!key) return null;
  const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
  const chain = { ...MONAD.testnet, id: MONAD.testnet.chainId };
  const transport = http(chain.rpcUrl);
  return {
    account,
    wallet: createWalletClient({ account, chain, transport }),
    pub: createPublicClient({ chain, transport }),
  };
}

/**
 * Broadcast a receipt to the MeritReputation contract and confirm it (err===null).
 * @returns {Promise<{ok:boolean, txHash:string|null, reason?:string}>}
 */
export async function settleOnChain({ agentId, payer, amountMicroUsd, verified = true, delivered = true, deliverableHash }) {
  const c = clients();
  if (!c) return { ok: false, txHash: null, reason: "no executor key (demo mode)" };
  try {
    const hash32 = deliverableHash && /^0x[0-9a-fA-F]{64}$/.test(deliverableHash)
      ? deliverableHash
      : keccak256(toHex(deliverableHash || `${agentId}:${payer}:${Date.now()}`));
    const txHash = await c.wallet.writeContract({
      address: MERIT_CONTRACTS_TESTNET.reputation,
      abi: REP_ABI,
      functionName: "recordReceipt",
      args: [BigInt(agentId), payer, BigInt(amountMicroUsd), verified, delivered, hash32],
    });
    const rec = await c.pub.waitForTransactionReceipt({ hash: txHash });
    return { ok: rec.status === "success", txHash };
  } catch (e) {
    return { ok: false, txHash: null, reason: e.message };
  }
}
