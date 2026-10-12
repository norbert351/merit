// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { MeritIdentity } from "../src/MeritIdentity.sol";
import { MeritReputation } from "../src/MeritReputation.sol";
import { GuardedWallet } from "../src/GuardedWallet.sol";

/// The execution-boundary mandate proof: GuardedWallet only moves funds when the transfer fits the
/// agent's EARNED, SETTLED score (read live from MeritReputation at execution time). Each violation
/// REVERTS the transfer — this is enforcement, not an advisory verdict.
contract GuardedWalletTest is Test {
    MeritIdentity identity;
    MeritReputation reputation;
    GuardedWallet guard;

    address admin = address(this);
    address executor = address(0xB0B); // the agent owner / authorized executor
    address receiver = address(0xCAFE);
    uint256 MICRO_PER_WEI = 1;          // 1 wei == 1 micro-USD == $0.000001
    uint256 LOW_CAP_WEI = 10_000_000;   // $10 (score >= $50 -> low tier)

    function setUp() public {
        identity = new MeritIdentity(admin);
        reputation = new MeritReputation(address(identity), admin);
        // register agent under the executor, fund only AFTER it earns a score >= $50
        vm.prank(executor);
        uint256 agentId = identity.register("ipfs://guarded-agent");
        // mint $55 of verified settled reputation for that agent (score 55e6 >= 50e6 -> LOW tier)
        reputation.recordReceipt(agentId, vm.addr(0xAA11), 50_000_000, true, true, bytes32(uint256(1))); // $50 verified
        guard = new GuardedWallet(address(reputation), agentId, admin, executor, MICRO_PER_WEI);
        vm.deal(address(guard), 1 ether); // the wallet OWNS testnet funds
    }

    function testPermittedTransfer_Succeeds() public {
        assertEq(guard.maxSpendWei(), LOW_CAP_WEI, "earned mandate cap is $10");
        uint256 balBefore = receiver.balance;
        uint256 amount = 5_000_000; // $5 * 1e6/micro == 5M wei, under cap
        vm.prank(executor);
        assertTrue(guard.execute(receiver, amount), "authorized under-cap transfer executes");
        assertEq(receiver.balance - balBefore, amount, "value actually moved on-chain");
    }

    function testPerTransactionCap_OverCap_Reverts() public {
        uint256 over = 20_000_000; // $20 > $10 cap
        uint256 preSpent = address(guard).balance;
        vm.prank(executor);
        vm.expectRevert("GuardedWallet: exceeds per-transaction cap");
        guard.execute(receiver, over);
        assertEq(address(guard).balance, preSpent, "no funds left the wallet (revert is atomic)");
    }

    function testCumulativePeriodCap_CannotBeBypassedByManySmall() public {
        uint256 a = 6_000_000; // allowed alone
        uint256 b = 6_000_000; // a+b = 12M > 10M cap -> must revert
        vm.prank(executor);
        assertTrue(guard.execute(receiver, a), "first within cap");
        assertEq(guard.spent(), a, "spent tracked cumulatively");
        vm.prank(executor);
        vm.expectRevert("GuardedWallet: exceeds cumulative period cap");
        guard.execute(receiver, b);
        assertEq(guard.spent(), a, "the second transfer did not add to spent");
    }

    function testUnauthorizedCaller_CannotExecute() public {
        vm.prank(receiver); // not the executor
        vm.expectRevert("GuardedWallet: not authorized executor");
        guard.execute(receiver, 1_000_000);
    }

    function testRevokedExecutor_CannotExecute() public {
        guard.setExecutor(address(0));
        vm.prank(executor);
        vm.expectRevert("GuardedWallet: not authorized executor");
        guard.execute(receiver, 1_000_000);
    }

    function testPaused_BlocksExecution() public {
        guard.setPaused(true);
        vm.prank(executor);
        vm.expectRevert("GuardedWallet: paused");
        guard.execute(receiver, 1_000_000);
    }

    function testNonAdmin_CannotChangePolicy() public {
        vm.prank(receiver);
        vm.expectRevert("GuardedWallet: not admin");
        guard.setRate(10);
        vm.prank(receiver);
        vm.expectRevert("GuardedWallet: not admin");
        guard.setExecutor(receiver);
    }

    function testStaleOrUnavailableScore_GrantsNothing_FailClosed() public {
        // point the guard at an UNREGISTERED agent: scoreOf reverts -> cap = 0 -> nothing can move
        guard.setReputation(address(reputation), 999);
        assertEq(guard.maxSpendWei(), 0, "fail-closed: no score, no authority");
        vm.prank(executor);
        vm.expectRevert("GuardedWallet: exceeds per-transaction cap");
        guard.execute(receiver, 1);
    }

    function testRateChange_ReflectedInCap() public {
        guard.setRate(2); // 1 wei == 2 micro-USD -> $10 cap == 5M wei
        assertEq(guard.maxSpendWei(), LOW_CAP_WEI / 2, "cap scales with the conversion rate");
    }
}