// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console2 } from "forge-std/Script.sol";
import { MeritIdentity } from "../src/MeritIdentity.sol";
import { MeritReputation } from "../src/MeritReputation.sol";
import { MeritMandate } from "../src/MeritMandate.sol";

/// Live on-chain demo runner: prove DEMO 1 + DEMO 2 + escalation-proof against the DEPLOYED
/// contracts on Monad testnet.
///
/// Usage:
///   forge script script/Demo.s.sol --rpc-url monad_testnet --broadcast
///
/// Steps: register an agent -> record 50 sock-puppet receipts (dust, unverified) -> read score
/// (expect 0) -> record one real verified settlement -> read score (expect >0) -> enforce a
/// requested HIGH-tier spend (expect denied).
contract DemoScript is Script {
    function run() external {
        MeritIdentity identity = MeritIdentity(0x355A0d78153eF5ba882511275EB8976438844C67);
        MeritReputation reputation = MeritReputation(0x38610eFDE0F68CA4BC2d4F56d3540B9A68B2162d);
        MeritMandate mandate = MeritMandate(0x83E4176FE2295a9898E2AC01fdA51b8443F282ED);

        uint256 pk = vm.envUint("PRIVATE_KEY");
        address executor = vm.addr(pk);
        vm.startBroadcast(pk);

        console2.log("=== MERIT LIVE ON-CHAIN DEMO (Monad testnet 10143) ===");
        console2.log("executor:");
        console2.log(executor);

        // --- register the demo Merit agent ---
        uint256 agentId = identity.register("ipfs://merit-live-demo");
        console2.log("registered agent agentId:");
        console2.log(agentId);

        // --- DEMO 1: 50 sock puppets (dust, unverified) ---
        console2.log("\n>>> DEMO 1: 50 sock-puppet receipts (dust <$0.50, unverified)");
        for (uint256 i = 0; i < 50; i++) {
            address puppet = vm.addr(1_000_000 + i); // fresh unverified wallets
            reputation.recordReceipt(agentId, puppet, 100, false, true, 0x0); // 100 micro-usd = $0.0001
        }
        (uint256 score1, , uint256 effSettled1, uint256 verified1, bool sybil1) = reputation.scoreOf(agentId);
        console2.log("score:", score1);
        console2.log("effSettled:", effSettled1);
        console2.log("distinctVerified:", verified1);
        console2.log("sybilDetected:", sybil1 ? uint256(1) : uint256(0));
        if (score1 == 0) console2.log("status: PASS");

        // --- DEMO 2: one real verified settlement ($1) ---
        console2.log("\n>>> DEMO 2: one real verified settlement ($1 via x402)");
        address buyer = vm.addr(0xCAFE);
        reputation.recordReceipt(agentId, buyer, 1e6, true, true, 0x0); // $1 settled by verified client
        (uint256 score2, , uint256 effSettled2, uint256 verified2, ) = reputation.scoreOf(agentId);
        console2.log("score:", score2);
        console2.log("effSettled:", effSettled2);
        console2.log("distinctVerified:", verified2);
        if (score2 > 0) console2.log("status: PASS");

        // --- DEMO 3: escalation-proof mandate ---
        console2.log("\n>>> DEMO 3: escalation-proof binding mandate (Bankr refutation)");
        (bool allowed, MeritMandate.Tier effTier, uint256 maxSpend) =
            mandate.enforce(agentId, uint256(MeritMandate.Tier.HIGH), 50 * 1e6);
        console2.log("allowed:", allowed ? uint256(1) : uint256(0));
        console2.log("effectiveTier:", uint256(effTier));
        console2.log("maxSpend:", maxSpend);
        // escalation-proof invariant: requested HIGH-tier $50 spend is DENIED and the effective
        // tier is clamped BELOW the requested HIGH (here score ~$6 => NONE tier). 
        if (!allowed && uint256(effTier) < uint256(MeritMandate.Tier.HIGH)) console2.log("status: PASS");

        vm.stopBroadcast();
    }
}