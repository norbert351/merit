// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
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

    receive() external payable {}
}