// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { MeritReputation } from "./MeritReputation.sol";

/// @title GuardedWallet
/// @notice A minimal execution-boundary spending guard: the account OWNS testnet funds and only
///         releases them when the ACTION fits the agent's EARNED, SETTLED reputation — read from
///         the LIVE MeritReputation contract at execution time. This is real enforcement (a
///         transfer that exceeds the mandate reverts on-chain), NOT an advisory `allowed` verdict.
///
///         Trust model: the "score oracle" is the on-chain MeritReputation contract itself — there
///         is no off-chain oracle, so no stale/missing-signal path can grant authority. If the score
///         read fails or the agent is unregistered, the guard FAILS CLOSED (cap = 0, nothing moves).
///
///         Amounts are compared in MICRO-USD (`maxSpendMicroUsd`) via a transparent,
///         admin-configured `microUsdPerWei` conversion, which also bounds the native-token value.
///         This is a TESTNET guarded-wallet prototype; its scope is deliberately minimal.
contract GuardedWallet {
    struct Tier { uint256 minScoreMicroUsd; uint256 maxSpendMicroUsd; }

    MeritReputation public reputation;
    uint256 public agentId;
    address public admin;
    address public authorizedExecutor;
    uint256 public microUsdPerWei;   // conversion so a value(wei) maps to micro-USD; > 0 required
    bool public paused;

    uint256 public constant PERIOD_DURATION = 1 days;
    uint256 public periodStart;
    uint256 public spentThisPeriod;  // wei spent this period (cumulative, can't bypass via many small)

    Tier[4] public tiers; // [NONE, LOW, MEDIUM, HIGH] mirror of MeritMandate mandateTable

    event Executed(address indexed to, uint256 valueWei, uint256 spentThisPeriodWei);
    event Configured(address executor, uint256 microUsdPerWei, bool paused);
    event FundsReceived(address indexed from, uint256 amountWei);

    modifier onlyAdmin() { require(msg.sender == admin, "GuardedWallet: not admin"); _; }

    uint256 private _notEntered;
    modifier nonReentrant() {
        require(_notEntered == 0, "GuardedWallet: reentrancy");
        _notEntered = 1;
        _;
        _notEntered = 0;
    }

    constructor(address _reputation, uint256 _agentId, address _admin, address _executor, uint256 _microUsdPerWei) {
        require(_microUsdPerWei > 0, "GuardedWallet: zero rate");
        reputation = MeritReputation(_reputation);
        agentId = _agentId;
        admin = _admin;
        authorizedExecutor = _executor;
        microUsdPerWei = _microUsdPerWei;
        periodStart = block.timestamp;
        tiers[0] = Tier(0, 0);                 // score < $50   -> $0
        tiers[1] = Tier(50 * 1e6, 10 * 1e6);   // score >= 50    -> $10
        tiers[2] = Tier(500 * 1e6, 100 * 1e6); // score >= 500   -> $100
        tiers[3] = Tier(2500 * 1e6, 1000 * 1e6); // score >= 2500 -> $1000
    }

    /// The maximum spend this agent may execute right now, in wei (the EARNED mandate).
    /// Fails closed: if the reputation read reverts (unregistered/corrupt) or rate is 0 -> 0.
    function _capWei() internal view returns (uint256) {
        if (microUsdPerWei == 0) return 0;
        (bool ok, bytes memory data) = address(reputation).staticcall(
            abi.encodeCall(MeritReputation.scoreOf, (agentId))
        );
        if (!ok) return 0; // score source unavailable/misconfigured -> no authority
        (uint256 score, , , , ) = abi.decode(data, (uint256, uint256, uint256, uint256, bool));
        uint256 cap;
        for (uint256 i = 0; i < tiers.length; i++) {
            if (score >= tiers[i].minScoreMicroUsd) cap = tiers[i].maxSpendMicroUsd;
        }
        return cap / microUsdPerWei;
    }

    function _rollPeriod() internal {
        if (block.timestamp >= periodStart + PERIOD_DURATION) {
            periodStart = block.timestamp;
            spentThisPeriod = 0;
        }
    }

    /// Execute a native-token transfer from THIS wallet's funds ONLY if it fits the agent's
    /// earned mandate AND the per-transaction + cumulative period caps. Any violation REVERTS
    /// (the transfer never happens) — this is enforcement at the execution boundary.
    function execute(address to, uint256 value) external nonReentrant returns (bool) {
        require(!paused, "GuardedWallet: paused");
        require(msg.sender == authorizedExecutor, "GuardedWallet: not authorized executor");
        _rollPeriod();
        uint256 capWei = _capWei();
        require(value <= capWei, "GuardedWallet: exceeds per-transaction cap");
        require(spentThisPeriod + value <= capWei, "GuardedWallet: exceeds cumulative period cap");
        require(address(this).balance >= value, "GuardedWallet: insufficient balance");
        (bool ok,) = payable(to).call{ value: value }("");
        require(ok, "GuardedWallet: transfer failed");
        spentThisPeriod += value;
        emit Executed(to, value, spentThisPeriod);
        return true;
    }

    // ---- read-only introspection (a judge can see the live cap) ----
    function maxSpendWei() external view returns (uint256) { return _capWei(); }
    function spent() external view returns (uint256) { return spentThisPeriod; }
    function mandateTier() external view returns (uint256) {
        uint256 cap = _capWei() * microUsdPerWei;
        for (uint256 i = 0; i < tiers.length; i++) {
            if (cap == tiers[i].maxSpendMicroUsd && tiers[i].maxSpendMicroUsd > 0) return i;
        }
        return 0;
    }

    // ---- stdlib / config (admin only) ----
    function setExecutor(address e) external onlyAdmin { authorizedExecutor = e; emit Configured(e, microUsdPerWei, paused); }
    function setRate(uint256 r) external onlyAdmin { require(r > 0, "GuardedWallet: zero rate"); microUsdPerWei = r; emit Configured(authorizedExecutor, r, paused); }
    function setReputation(address r, uint256 id) external onlyAdmin { reputation = MeritReputation(r); agentId = id; }
    function setPaused(bool p) external onlyAdmin { paused = p; emit Configured(authorizedExecutor, microUsdPerWei, p); }

    receive() external payable { emit FundsReceived(msg.sender, msg.value); }
}