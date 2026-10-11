# Merit — settled-receipt graph (Envio HyperIndex)

The **on-chain re-derivability layer**. Every settled x402 receipt emitted by the deployed
`MeritReputation` contract on Monad testnet is indexed into a queryable graph, so a stranger can
recompute an agent's Merit score **from on-chain data alone** — no trust in our server.

```
score = effectivelySettledUsd + distinctVerifiedClients × 5
```

This is the exact formula in [`../src/reputation/onchain-score.mjs`](../src/reputation/onchain-score.mjs)
(off-chain) and `scoreOf()` in [`../contracts/src/MeritReputation.sol`](../contracts/src/MeritReputation.sol)
(on-chain). The indexer is what makes the receipt graph greppable/queryable for a judge.

## Run it

```bash
cd indexer
npm install
npm run codegen      # generate types from config.yaml + schema.graphql
npm run dev          # local indexer against Monad testnet (10143)
npm run deploy       # Envio Cloud hosting (the $5K bounty target)
```

## Query the graph

```graphql
query AgentScore {
  agent(id: "1") {
    id
    scoreUsd
    settledUsd
    effectivelySettledUsd
    distinctVerifiedClients
    sybilDetected
    receipts { payer verified amountMicroUsd delivered deliverableHash txHash }
  }
}
```

Then re-derive the score with the same formula the on-chain contract uses. If the indexed
numbers match `scoreOf(1)` read directly from the contract, the graph is honest.

## Events indexed

| Event | Purpose |
|---|---|
| `ReceiptRecorded(agentId, payer, amountMicroUsd, verified, delivered, deliverableHash, scoreAfter, sybilDetected)` | one settled receipt → one graph node |
| `SybilClusterSuppressed(agentId, clusterSize, suppressedMicroUsd)` | proves the anti-sybil suppression on-chain |

Both are emitted by `MeritReputation.recordReceipt()` — see `contracts/src/MeritReputation.sol`.
