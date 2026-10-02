// Monad chain config + verified anchor addresses.
// All addresses below were pulled from docs.monad.xyz (guides/x402.md, guides/erc-8004.md,
// developer-essentials/precompiles.md) and are the OFFICIAL deployed contracts.

export const MONAD = {
  mainnet: {
    chainId: 143,
    name: "monad",
    rpcUrl: "https://rpc.monad.xyz",
  },
  testnet: {
    chainId: 10143,
    name: "monad-testnet",
    rpcUrl: process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz",
  },
};

// ⚠️ VERIFIED LAYER SPLIT (Phase 0 live probe, 2026-10-02):
//   - x402 facilitator (molandak) + P256 precompile 0x0100: live on BOTH testnet & mainnet.
//   - ERC-8004 Identity & Reputation registries: deployed on MAINNET ONLY (getCode returns []
//     on testnet). → x402 demo loop runs on testnet; ERC-8004 registration + reputation
//     anchoring MUST target mainnet. Keep them on separate networks; label demo receipts honestly.
export const ERC8004_REGISTRIES = {
  identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  validation: null, // "coming soon" per docs
  // registry deployment verified on eip155:143 (mainnet) only
  deployedOn: "mainnet (143)",
};

export const X402_FACILITATOR_URL =
  process.env.MERIT_FACILITATOR_URL || "https://x402-facilitator.molandak.org";

// P256/WebAuthn signature verification precompile (EIP-7951, supersedes RIP-7212).
export const P256_VERIFY = "0x0000000000000000000000000000000000000100";