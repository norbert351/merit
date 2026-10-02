// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { MeritReputation } from "./MeritReputation.sol";

/// @title MeritMandate
/// @notice Binding, escalation-proof authority derived from settled reputation.
///         Agent authority = f(earned, settled score). Checked on EVERY spend/action.
///         Escalation-proof: requesting a higher permission tier has NO effect above the
///         mandate its settled reputation earned — direct refutation of the Bankr post-mortem
///         ("spending limits didn't apply because the attacker had unlocked a higher tier first").
contract MeritMandate {
    enum Tier { NONE, LOW, MEDIUM, HIGH }

    struct Mandate {
        uint256 minScoreMicroUsd;
        Tier tier;
        uint256 maxSpendMicroUsd;
    }

    MeritReputation public reputation;
    address public admin;

    // settled USD thresholds (micro-USD): score -> authority tier
    Mandate[] public mandateTable;

    event MandateEnforced(uint256 indexed agentId, bool allowed, Tier effectiveTier, uint256 maxSpendMicroUsd, string reason);

    constructor(address _reputation, address _admin) {
        reputation = MeritReputation(_reputation);
        admin = _admin;
        // mirrors src/mandate/mandate.mjs MANDATE_TABLE
        mandateTable.push(Mandate(0, Tier.NONE, 0));                       // score < 50   -> none, $0
        mandateTable.push(Mandate(50 * 1e6, Tier.LOW, 10 * 1e6));          // >= 50        -> low, $10
        mandateTable.push(Mandate(500 * 1e6, Tier.MEDIUM, 100 * 1e6));     // >= 500       -> medium, $100
        mandateTable.push(Mandate(2500 * 1e6, Tier.HIGH, 1000 * 1e6));     // >= 2500      -> high, $1000
    }

    function _mandateForScore(uint256 scoreMicroUsd) internal view returns (Mandate memory m) {
        m = mandateTable[0];
        for (uint256 i = 0; i < mandateTable.length; i++) {
            if (scoreMicroUsd >= mandateTable[i].minScoreMicroUsd) m = mandateTable[i];
        }
    }

    /// Escalation-proof mandate check. Runs on EVERY spend/action, not once at setup.
    /// @return allowed whether the requested spend fits the EARNED mandate
    /// @return effectiveTier requested tier clamped to the earned mandate tier
    /// @return maxSpendMicroUsd the mandate's authorized spend cap
    function enforce(
        uint256 agentId,
        uint256 requestedTier,      // the tier the caller claims/requested
        uint256 requestedSpendMicroUsd
    ) public returns (bool allowed, Tier effectiveTier, uint256 maxSpendMicroUsd) {
        (uint256 score, , , , ) = reputation.scoreOf(agentId);
        Mandate memory m = _mandateForScore(score);
        // escalate-proof: requested tier clamped DOWN to the earned mandate
        Tier earned = m.tier;
        effectiveTier = uint256(requestedTier) > uint256(earned) ? earned : Tier(requestedTier);
        allowed = requestedSpendMicroUsd <= m.maxSpendMicroUsd;

        string memory reason;
        if (uint256(requestedTier) > uint256(earned) && !allowed) {
            reason = "requested tier capped to earned; spend exceeds mandate";
        } else if (uint256(requestedTier) > uint256(earned)) {
            reason = "requested tier capped to earned tier (escalation-proof)";
        } else if (!allowed) {
            reason = "spend exceeds mandate max";
        } else {
            reason = "mandate satisfied";
        }
        emit MandateEnforced(agentId, allowed, effectiveTier, m.maxSpendMicroUsd, reason);
        return (allowed, effectiveTier, m.maxSpendMicroUsd);
    }

    function mandateOf(uint256 agentId) external view returns (Tier tier, uint256 maxSpendMicroUsd, uint256 scoreMicroUsd) {
        (uint256 score, , , , ) = reputation.scoreOf(agentId);
        Mandate memory m = _mandateForScore(score);
        return (m.tier, m.maxSpendMicroUsd, score);
    }
}