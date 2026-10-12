// Probe Monad's P256/WebAuthn precompile (EIP-7951, 0x0100) LIVE via eth_call.
// Input (160 bytes): msgHash(32) || r(32) || s(32) || pubX(32) || pubY(32)
// Returns 32-byte 0x..01 if the signature is valid.
import { webcrypto as crypto } from "node:crypto";
import { createWalletClient, createPublicClient, http, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz";
const P256 = "0x0000000000000000000000000000000000000100";

function hexBytes(h) { return Uint8Array.from(h.replace(/^0x/, "").match(/../g).map((b) => parseInt(b, 16))); }
function toHex32(u8) { return toHex(u8); }

const pub = createPublicClient({ transport: http(RPC) });

// 1) make a P-256 keypair + sign a message with Node webcrypto (ES256, raw r||s)
const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)); // 65 bytes: 0x04||X||Y
const pubX = rawPub.slice(1, 33), pubY = rawPub.slice(33, 65);

const msg = new TextEncoder().encode("merit:verified-client:v1");
const msgHash = new Uint8Array(await crypto.subtle.digest("SHA-256", msg));
const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, msg));
console.log("sig length:", sig.length, "(expect 64 = raw r||s)");
const r = sig.slice(0, 32), s = sig.slice(32, 64);

const input = toHex(new Uint8Array([...msgHash, ...r, ...s, ...pubX, ...pubY]));
console.log("precompile input bytes:", (input.length - 2) / 2);

// 3) eth_call the precompile directly
try {
  const res = await pub.call({ to: P256, data: input });
  console.log("P256 precompile 0x0100 ->", res?.data ?? JSON.stringify(res));
} catch (e) {
  console.log("precompile call threw:", e.shortMessage || e.message);
}

// 4) negative control: tamper one signature byte
const bad = new Uint8Array([...msgHash, ...r.slice(0,31), new Uint8Array([r[31] ^ 0xff]), ...s, ...pubX, ...pubY]);
try {
  const res = await pub.call({ to: P256, data: toHex(bad) });
  console.log("tampered sig 0x0100 ->", res?.data ?? JSON.stringify(res), "(expect 0x00..00)");
} catch (e) {
  console.log("tampered threw:", e.shortMessage || e.message);
}
