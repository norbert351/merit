// Merit — Envio/HyperSync parity proof (token-powered, no Docker).
//
// Proves the "on-chain re-derivability" claim behind the Envio integration WITHOUT running the
// indexer locally: it fetches the REAL `ReceiptRecorded` / `SybilClusterSuppressed` events for the
// deployed MeritReputation contract straight from Envio HyperSync, reconstructs agent 1's score with
// the SAME algorithm as indexer/src/EventHandlers.ts, and compares it to on-chain `scoreOf(1)`.
//
//   node scripts/indexer-parity.mjs
//
// Reads ENVIO_API_TOKEN from indexer/.env (or the environment). Never prints the token.
import { readFileSync } from "node:fs";
import { createPublicClient, http, parseAbi, decodeEventLog, keccak256, toBytes, getAddress } from "viem";

const CONTRACT = getAddress("0x92A11Ad0E988C6cd0Bd434e140331A620393114D");
const AGENT_ID = 1n;
const CHAIN_ID = 10143;
const HYPERSYNC = "https://monad-testnet.hypersync.xyz/query";
const RPC = "https://testnet-rpc.monad.xyz";
const BONUS_MICRO = 5_000_000n; // 5 USD
const SCALE = 1_000_000n;

function token() {
  if (process.env.ENVIO_API_TOKEN) return process.env.ENVIO_API_TOKEN.trim();
  try {
    const line = readFileSync(new URL("../indexer/.env", import.meta.url), "utf8")
      .split("\n").find((l) => l.startsWith("ENVIO_API_TOKEN="));
    return line ? line.split("=").slice(1).join("=").trim() : null;
  } catch { return null; }
}

const abi = parseAbi([
  "event ReceiptRecorded(uint256 indexed agentId, address indexed payer, uint64 amountMicroUsd, bool verified, bool delivered, bytes32 deliverableHash, uint256 scoreAfter, bool sybilDetected)",
  "event SybilClusterSuppressed(uint256 indexed agentId, uint256 clusterSize, uint256 suppressedMicroUsd)",
]);
const T_RECEIPT = keccak256(toBytes("ReceiptRecorded(uint256,address,uint64,bool,bool,bytes32,uint256,bool)"));
const T_SYBIL = keccak256(toBytes("SybilClusterSuppressed(uint256,uint256,uint256)"));

const t = token();
if (!t) { console.error("No ENVIO_API_TOKEN found (indexer/.env or env)."); process.exit(1); }

console.log("Querying Envio HyperSync for real contract events on Monad testnet (10143)…");
const res = await fetch(HYPERSYNC, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
  body: JSON.stringify({
    from_block: 0,
    logs: [{ address: [CONTRACT], topics: [[T_RECEIPT, T_SYBIL]] }],
    field_selection: { log: ["block_number", "log_index", "transaction_hash", "data", "topic0", "topic1", "topic2", "topic3"] },
  }),
});
if (!res.ok) { console.error("HyperSync HTTP", res.status, (await res.text()).slice(0, 200)); process.exit(1); }
const j = await res.json();
// HyperSync returns { data: [ { logs: [...] } ] } (array of per-query pages)
const d = j?.data;
const logs = Array.isArray(d) ? d.flatMap((x) => x.logs || []) : (d?.logs || []);
console.log(`Fetched ${logs.length} raw logs (HTTP ${res.status}).`);

// Reconstruct exactly like indexer/src/EventHandlers.ts.
const receipts = [];
const suppressions = [];
for (const lg of logs) {
  const topics = [lg.topic0, lg.topic1, lg.topic2, lg.topic3].filter(Boolean);
  let dec;
  try { dec = decodeEventLog({ abi, data: lg.data, topics }); } catch { continue; }
  if (dec.eventName === "ReceiptRecorded") {
    const a = dec.args;
    if (BigInt(a.agentId) !== AGENT_ID) continue;
    receipts.push({
      payer: String(a.payer).toLowerCase(),
      verified: !!a.verified, delivered: !!a.delivered,
      amountMicro: BigInt(a.amountMicroUsd), scoreAfter: BigInt(a.scoreAfter),
      sybil: !!a.sybilDetected, block: Number(lg.block_number),
    });
  } else if (dec.eventName === "SybilClusterSuppressed") {
    if (BigInt(dec.args.agentId) !== AGENT_ID) continue;
    suppressions.push({ clusterSize: BigInt(dec.args.clusterSize), suppressedMicro: BigInt(dec.args.suppressedMicroUsd) });
  }
}
receipts.sort((a, b) => a.block - b.block);

const settledMicro = receipts.filter((r) => r.delivered).reduce((s, r) => s + r.amountMicro, 0n);
const distinct = new Set(receipts.filter((r) => r.verified && r.delivered).map((r) => r.payer)).size;
// contract emits effSettled (post-suppression) as scoreAfter — take the monotonic max
let effMicro = 0n;
for (const r of receipts) if (r.scoreAfter > effMicro) effMicro = r.scoreAfter;
const reconScoreMicro = effMicro + BigInt(distinct) * BONUS_MICRO;

// On-chain truth
const pc = createPublicClient({ transport: http(RPC) });
const onchain = await pc.readContract({
  address: CONTRACT,
  abi: parseAbi(["function scoreOf(uint256) view returns (uint256 score, uint256 settledMicroUsd, uint256 effectivelySettledMicroUsd, uint256 distinctVerifiedClients, bool sybilDetected)"]),
  functionName: "scoreOf", args: [AGENT_ID],
});
const [oCScore, oSettled, oEff, oDistinct, oSybil] = onchain;

const usd = (micro) => "$" + (Number(micro) / 1e6).toFixed(2);
console.log("\n=== MeritReputation (Monad testnet 10143) · agent 1 ===");
console.log(`events: ${receipts.length} ReceiptRecorded · ${suppressions.length} SybilClusterSuppressed`);
console.log(`distinct verified payers:  indexer=${distinct}   on-chain=${oDistinct}`);
console.log(`effective settled (micro): indexer=${effMicro}   on-chain=${oEff}`);
console.log(`reconstructed SCORE:       indexer=${usd(reconScoreMicro)} (${reconScoreMicro})`);
console.log(`on-chain scoreOf(1).score: ${usd(oCScore)} (${oCScore})`);
const parity = reconScoreMicro === oCScore;
console.log(`\n${parity ? "✅ PARITY: indexer reconstruction == on-chain scoreOf(1)" : "❌ MISMATCH"}`);
console.log("   score = effectivelySettled + distinctVerifiedClients × $5  (re-derived from raw HyperSync events)");
if (suppressions.length) {
  const maxCluster = suppressions.reduce((m, s) => (s.clusterSize > m ? s.clusterSize : m), 0n);
  const totalSuppressed = suppressions.reduce((s, x) => s + x.suppressedMicro, 0n);
  console.log(`   sybil suppressions on record: ${suppressions.length} emits · max cluster ${maxCluster} payers · ${usd(totalSuppressed)} suppressed total`);
}
process.exit(parity ? 0 : 2);