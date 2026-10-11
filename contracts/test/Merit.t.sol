// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Vm } from "forge-std/Vm.sol";
import { MeritIdentity } from "../src/MeritIdentity.sol";
import { MeritReputation } from "../src/MeritReputation.sol";
import { MeritMandate } from "../src/MeritMandate.sol";

/// The on-chain moat proof. Mirrors test/sybil.test.mjs + test/phase23.test.mjs so the SAME
/// demos pass both off-chain and on-chain. Score must be identical to onchain-score.mjs.
contract MeritTest is Test {
    MeritIdentity identity;
    MeritReputation reputation;
    MeritMandate mandate;
    address admin = address(this);
    uint256 SYBIL_STAKE = 100;        // 0.0001 USD in micro-USD
    uint256 BIG = 1e6;                // $1

    function setUp() public {
        identity = new MeritIdentity(admin);
        reputation = new MeritReputation(address(identity), admin);
        mandate = new MeritMandate(address(reputation), admin);
    }

    function _agent(address owner) internal returns (uint256 agentId) {
        vm.prank(owner);
        agentId = identity.register("ipfs://merit-agent");
    }

    function _receipt(uint256 agentId, address payer, uint64 amt, bool verified, bool delivered) internal {
        reputation.recordReceipt(agentId, payer, amt, verified, delivered, 0x0);
    }

    function _puppets(uint256 agentId, uint256 n) internal {
        for (uint256 i = 0; i < n; i++) {
            address p = vm.addr(1000 + i); // fresh unverified wallets
            _receipt(agentId, p, uint64(SYBIL_STAKE), false, true); // dust, delivered
        }
    }

    function testDemo1_50SockPuppets_ScoreStaysZero() public {
        uint256 agentId = _agent(address(0xB0B));
        _puppets(agentId, 50);
        (uint256 score, , uint256 effSettled, uint256 distinctVerified, bool detected) = reputation.scoreOf(agentId);
        assertTrue(detected, "sybil cluster detected");
        assertEq(effSettled, 0, "dust cluster fully suppressed");
        assertEq(distinctVerified, 0, "no verified clients");
        assertEq(score, 0, "50 fake agents cannot buy a score");
    }

    function testDemo2_OneRealSettlement_MovesScore() public {
        uint256 agentId = _agent(address(0xB0B));
        _puppets(agentId, 50);
        address buyer = vm.addr(0xCAFE);
        _receipt(agentId, buyer, 1e6, true, true); // $1 settled by a VERIFIED client
        (uint256 score, , uint256 effSettled, uint256 distinctVerified, ) = reputation.scoreOf(agentId);
        assertEq(effSettled, BIG, "settled USD = $1");
        assertEq(distinctVerified, 1, "one distinct verified client");
        // score = effSettled(1e6) + 1 * 5 * 1e6 = 6e6 micro-USD = $6 (matches JS: 1 + 5)
        assertEq(score, 6e6, "score moved off zero (matches off-chain onchain-score.mjs)");
    }

    function testPromiseUnpaid_ScoresZero() public {
        uint256 agentId = _agent(address(0xB0B));
        _receipt(agentId, vm.addr(0x111), 100_000 * 1e6, true, false); // promises $100k but NOT delivered
        (uint256 score,, uint256 effSettled,,) = reputation.scoreOf(agentId);
        assertEq(effSettled, 0, "undelivered contributes nothing");
        assertEq(score, 0, "a promise is not reputation");
    }

    function testEscalationProof_RequestedTierCapped() public {
        uint256 agentId = _agent(address(0xB0B));
        // settle $100 -> score 100e6 micro-USD -> LOW tier (>=50), maxSpend $10
        _receipt(agentId, vm.addr(0xAAA), 100 * 1e6, true, true);
        // SAME as JS test: score 100 => LOW tier, max $10. attacker requests HIGH tier + $50 spend
        (uint256 s, , uint256 eff, , ) = reputation.scoreOf(agentId);
        assertEq(eff, 100 * 1e6, "settled $100");
        (bool allowed, MeritMandate.Tier effTier, uint256 maxSpend) = mandate.enforce(agentId, uint256(MeritMandate.Tier.HIGH), 50 * 1e6);
        assertFalse(allowed, "large spend denied despite requested HIGH");
        assertEq(uint256(effTier), uint256(MeritMandate.Tier.LOW), "HIGH clamped to earned LOW");
        assertEq(maxSpend, 10 * 1e6, "mandate max is $10");
    }

    function testEscalationProof_SpendWithinEarned_LowAllowed() public {
        uint256 agentId = _agent(address(0xB0B));
        _receipt(agentId, vm.addr(0xAAA), 100 * 1e6, true, true); // $100 -> LOW
        // spend $5 (within LOW's $10) is allowed even if caller claims a lower tier
        (bool allowed, MeritMandate.Tier effTier, ) = mandate.enforce(agentId, uint256(MeritMandate.Tier.LOW), 5 * 1e6);
        assertTrue(allowed, "$5 within LOW mandate");
        assertEq(uint256(effTier), uint256(MeritMandate.Tier.LOW), "effective tier LOW");
    }

    function testEarningReputation_RaisesMandate() public {
        uint256 agentId = _agent(address(0xB0B));
        // score 3000 -> HIGH tier, max spend $1000. Caller claims HIGH (its earned default).
        _receipt(agentId, vm.addr(0xDDD), 3000 * 1e6, true, true);
        (bool allowed, MeritMandate.Tier effTier, uint256 maxSpend) = mandate.enforce(agentId, uint256(MeritMandate.Tier.HIGH), 50 * 1e6);
        assertTrue(allowed, "$50 spend allowed at HIGH mandate");
        assertEq(uint256(effTier), uint256(MeritMandate.Tier.HIGH), "earned HIGH tier");
        assertEq(maxSpend, 1000 * 1e6, "max spend $1000");
    }

    /// The Envio indexer folds ReceiptRecorded into the on-chain re-derivable graph, so the
    /// event MUST carry every field a stranger needs (amount, verified, delivered, hash, scoreAfter).
    function testReceiptRecordedEvent_EnrichedForIndexer() public {
        uint256 agentId = _agent(address(0xB0B));
        address buyer = vm.addr(0xCAFE);
        bytes32 hash = bytes32(uint256(0xabc));
        // expect exactly the first ReceiptRecorded: delivered $1 by a verified client, no sybil yet
        vm.expectEmit(true, true, false, true);
        emit MeritReputation.ReceiptRecorded(agentId, buyer, 1e6, true, true, hash, 1e6, false);
        reputation.recordReceipt(agentId, buyer, 1e6, true, true, hash);
    }

    /// When a dust cluster crosses the sybil threshold, the suppression event fires with the
    /// suppressed total — this is what proves "fake agents can't buy a score" on-chain.
    function testSybilClusterSuppressedEvent() public {
        uint256 agentId = _agent(address(0xB0B));
        _puppets(agentId, 3); // below threshold: no suppression yet
        vm.recordLogs();
        address p4 = vm.addr(1000 + 3);
        _receipt(agentId, p4, uint64(SYBIL_STAKE), false, true); // 4th dust payer -> crosses threshold
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("SybilClusterSuppressed(uint256,uint256,uint256)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == sig) {
                found = true;
                assertEq(uint256(logs[i].topics[1]), agentId, "suppression bound to the agent");
                (uint256 clusterSize, uint256 suppressed) = abi.decode(logs[i].data, (uint256, uint256));
                assertEq(clusterSize, 4, "cluster size 4");
                assertEq(suppressed, 4 * SYBIL_STAKE, "all dust suppressed");
            }
        }
        assertTrue(found, "SybilClusterSuppressed emitted when cluster crosses threshold");
    }

    receive() external payable {}
}