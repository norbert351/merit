// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MeritReputation
/// @notice On-chain settled-receipt ledger + sybil-resistant score, mirroring
///         src/reputation/onchain-score.mjs EXACTLY so a stranger recomputes the same
///         number on-chain and off-chain.
///
///         The whole point of Merit: reputation is computed ONLY from money that actually
///         settled, weighted by DISTINCT VERIFIED client identity, with sybil clusters zeroed.
///         Remove settled-money weighting + verified-client weighting and sock-puppet agents
///         run the system. That is the proof bar.
///
///         Amounts are stored in MICRO-USD (1e6 = $1) to keep integer precision for sub-cent
///         dust (sybil threshold at 0.5 USD = 500_000 micro-USD).
import { MeritIdentity } from "./MeritIdentity.sol";

contract MeritReputation {
    MeritIdentity public identity;
    address public admin;
    uint256 public constant VERIFIED_CLIENT_BONUS_USD = 5;        // $5 floor per distinct verified client
    uint256 public constant SYBIL_STAKE_MICRO_USD = 500_000;      // 0.5 USD
    uint256 public constant SYBIL_CLUSTER_MIN = 4;                // >=4 unverified sub-stake payers = sybil
    uint256 public constant SCALE = 1e6;                          // micro-USD per $1

    struct Receipt {
        address payer;
        bool verified;
        uint64 amountMicroUsd;
        bool delivered;
        bytes32 deliverableHash;
        uint64 ts;
        bool filled;
    }

    // one settled receipt per (agent, index)
    mapping(uint256 => Receipt[]) private _receipts;
    mapping(uint256 => mapping(address => bool)) private _hasPayer;

    event ReceiptRecorded(uint256 indexed agentId, address indexed payer, uint64 amountMicroUsd, bool delivered);
    event FeedbackWritten(uint256 indexed agentId, address indexed client, int128 value, string tag);

    constructor(address _identity, address _admin) {
        identity = MeritIdentity(_identity);
        admin = _admin;
    }

    modifier onlyAdmin() { require(msg.sender == admin, "MeritReputation: only admin"); _; }

    function receiptCount(uint256 agentId) external view returns (uint256) { return _receipts[agentId].length; }

    function receipt(uint256 agentId, uint256 i) external view returns (Receipt memory) { return _receipts[agentId][i]; }

    /// Record a SETTLED receipt. CALLED BY THE ADMIN (the settlement oracle) ONLY AFTER the
    /// x402 tx confirms on-chain (err===null). A receipt exists IFF money actually settled.
    function recordReceipt(
        uint256 agentId,
        address payer,
        uint64 amountMicroUsd,
        bool verified,
        bool delivered,
        bytes32 deliverableHash
    ) external onlyAdmin {
        require(identity.isRegistered(agentId), "MeritReputation: agent not registered");
        _receipts[agentId].push(Receipt(payer, verified, amountMicroUsd, delivered, deliverableHash, uint64(block.timestamp), true));
        emit ReceiptRecorded(agentId, payer, amountMicroUsd, delivered);
    }

    /// ERC-8004-style reputation feedback (value in [0,1] scaled). Mirrors giveFeedback shape;
    /// the RESULT the judge sees is the settled-money score below, not this (feedback alone is sybil-able).
    function giveFeedback(uint256 agentId, int128 value, string calldata tag) external {
        // feedback is allowed but does NOT move the anti-sybil score; it is informational.
        emit FeedbackWritten(agentId, msg.sender, value, tag);
    }

    // --------- SYBIL DETECTION + WEIGHTED SCORE (mirrors onchain-score.mjs) ---------

    function _detectSybil(uint256 agentId) internal view returns (bool detected, uint256 clusterSize) {
        Receipt[] storage rs = _receipts[agentId];
        uint256 n;
        for (uint256 i = 0; i < rs.length; i++) {
            if (!rs[i].verified && rs[i].amountMicroUsd < SYBIL_STAKE_MICRO_USD) n++;
        }
        return (n >= SYBIL_CLUSTER_MIN, n);
    }

    /// The anti-sybil weighted score for an agent, recomputed on-chain.
    /// score = effectivelySettledMicroUsd + distinctVerifiedClients * VERIFIED_CLIENT_BONUS_USD
    function scoreOf(uint256 agentId) public view returns (uint256 score, uint256 settledMicroUsd, uint256 effectivelySettledMicroUsd, uint256 distinctVerifiedClients, bool sybilDetected) {
        require(identity.isRegistered(agentId), "MeritReputation: agent not registered");
        Receipt[] storage rs = _receipts[agentId];

        uint256 settled;
        for (uint256 i = 0; i < rs.length; i++) {
            if (rs[i].delivered) settled += rs[i].amountMicroUsd;
        }

        (bool detected, ) = _detectSybil(agentId);
        uint256 effSettled;
        uint256 distinctVerified;

        if (detected) {
            // zero the sybil dust cluster entirely; count distinct verified clients among the rest
            address[] memory seen = new address[](rs.length);
            uint256 seenLen;
            for (uint256 i = 0; i < rs.length; i++) {
                Receipt memory r = rs[i];
                if (!r.verified && r.amountMicroUsd < SYBIL_STAKE_MICRO_USD) continue; // sybil dust -> $0
                if (r.delivered) effSettled += r.amountMicroUsd;
                if (r.verified && r.delivered) {
                    bool dup;
                    for (uint256 j = 0; j < seenLen; j++) if (seen[j] == r.payer) { dup = true; break; }
                    if (!dup) { seen[seenLen++] = r.payer; distinctVerified++; }
                }
            }
        } else {
            address[] memory seen = new address[](rs.length);
            uint256 seenLen;
            for (uint256 i = 0; i < rs.length; i++) {
                Receipt memory r = rs[i];
                if (r.delivered) effSettled += r.amountMicroUsd;
                if (r.verified && r.delivered) {
                    bool dup;
                    for (uint256 j = 0; j < seenLen; j++) if (seen[j] == r.payer) { dup = true; break; }
                    if (!dup) { seen[seenLen++] = r.payer; distinctVerified++; }
                }
            }
        }

        uint256 scoreVal = effSettled + distinctVerified * VERIFIED_CLIENT_BONUS_USD * SCALE;
        return (scoreVal, settled, effSettled, distinctVerified, detected);
    }
}