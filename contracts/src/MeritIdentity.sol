// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MeritIdentity
/// @notice Minimal ERC-8004-style agent identity registry (Monad-local for the testnet build).
///         Mirrors the Identity Registry surface Merit needs: register -> agentId.
///         For mainnet, the canonical ERC-8004 registry (0x8004A1...) is the anchor; this
///         contract exists so the full Merit loop can run live on Monad testnet (where the
///         ERC-8004 registry is NOT deployed) with our funded executor wallet.
contract MeritIdentity {
    struct Agent {
        string uri;
        address owner;
        address registeredBy;
        bool active;
    }

    uint256 public totalAgents;
    address public admin;

    mapping(uint256 => Agent) public agents;
    mapping(address => uint256) public ownerToAgentId; // one active agent per owner

    event AgentRegistered(uint256 indexed agentId, string uri, address indexed owner);
    event AgentDeactivated(uint256 indexed agentId);

    constructor(address _admin) {
        admin = _admin;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "MeritIdentity: only admin");
        _;
    }

    /// Register an agent. Returns the assigned agentId (increments from 1).
    function register(string calldata uri) external returns (uint256 agentId) {
        require(ownerToAgentId[msg.sender] == 0, "MeritIdentity: already registered");
        totalAgents++;
        agentId = totalAgents;
        agents[agentId] = Agent(uri, msg.sender, msg.sender, true);
        ownerToAgentId[msg.sender] = agentId;
        emit AgentRegistered(agentId, uri, msg.sender);
    }

    function isRegistered(uint256 agentId) public view returns (bool) {
        return agentId > 0 && agentId <= totalAgents && agents[agentId].active;
    }

    function ownerOf(uint256 agentId) external view returns (address) {
        require(isRegistered(agentId), "MeritIdentity: not registered");
        return agents[agentId].owner;
    }

    function updateURI(uint256 agentId, string calldata uri) external {
        require(agents[agentId].owner == msg.sender, "MeritIdentity: not owner");
        agents[agentId].uri = uri;
    }

    function deactivate(uint256 agentId) external {
        require(agents[agentId].owner == msg.sender || msg.sender == admin, "MeritIdentity: not owner/admin");
        agents[agentId].active = false;
        emit AgentDeactivated(agentId);
    }
}