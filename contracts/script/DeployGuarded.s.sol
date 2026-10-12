// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console2 } from "forge-std/Script.sol";
import { GuardedWallet } from "../src/GuardedWallet.sol";

/// Deploy the execution-boundary GuardedWallet pointing at the LIVE MeritReputation contract.
/// Usage:
///   forge script script/DeployGuarded.s.sol --rpc-url monad_testnet --broadcast \
///     --private-key <executor key>
/// The deployer becomes admin; the executor (same wallet here) is the only caller of execute().
contract DeployGuarded is Script {
    function run() external returns (GuardedWallet guard, address executor) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        executor = vm.addr(pk);
        // LIVE suite on Monad testnet (see contracts/DEPLOY.md):
        address reputation = 0x92A11Ad0E988C6cd0Bd434e140331A620393114D;
        uint256 agentId = 1;             // the live demo agent
        uint256 microUsdPerWei = 1;      // 1 wei == 1 micro-USD == $0.000001
        bytes32 salt = bytes32(uint256(uint160(executor)));
        vm.startBroadcast(pk);
        GuardedWallet guard = new GuardedWallet{ salt: salt }(reputation, agentId, executor, executor, microUsdPerWei);
        vm.stopBroadcast();
        console2.log("GuardedWallet:", address(guard));
        console2.log("executor/admin:", executor);
        console2.log("reputation:", reputation, "(agent 1)");
        return (guard, executor);
    }
}