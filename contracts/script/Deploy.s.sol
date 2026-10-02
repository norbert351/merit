// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console2 } from "forge-std/Script.sol";
import { MeritIdentity } from "../src/MeritIdentity.sol";
import { MeritReputation } from "../src/MeritReputation.sol";
import { MeritMandate } from "../src/MeritMandate.sol";

/// Deploy the full Merit contract suite on whichever chain --rpc-url points at.
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast \
///     --private-key <executor key>
/// The deployment admin is the deploying account (the funded executor wallet).
contract DeployScript is Script {
    function run() external returns (MeritIdentity, MeritReputation, MeritMandate, address admin) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        admin = vm.addr(pk);
        vm.startBroadcast(pk);

        MeritIdentity identity = new MeritIdentity(admin);
        MeritReputation reputation = new MeritReputation(address(identity), admin);
        MeritMandate mandate = new MeritMandate(address(reputation), admin);

        vm.stopBroadcast();

        console2.log("admin:", admin);
        console2.log("identity:", address(identity));
        console2.log("reputation:", address(reputation));
        console2.log("mandate:", address(mandate));
        return (identity, reputation, mandate, admin);
    }
}