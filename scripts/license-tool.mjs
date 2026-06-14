#!/usr/bin/env node
// Compy Pro — OWNER-SIDE offline license tool (keygen + mint). Pairs with src-tauri/src/license.rs.
//
// This is the manual-issuance path: it lets the owner sell a Pro license for $0 — mint a key, send it
// (Ko-fi / DM) — before any payment processor is wired. It runs OFFLINE on the owner's machine.
//
// HARD LINE — the private signing key NEVER enters the repo. `keygen` writes it to a file the owner keeps
// OFFLINE (and .gitignore-protected); `mint` reads that file. This script holds no secret itself.
//
// Token format (must match license.rs::verify_license exactly): `<hex(payloadJSON)>.<hex(ed25519_sig)>`,
// signature over the EXACT payload bytes. Payload = { email_hash, tier, issued_at, expires_at? } — the
// same fields license.rs deserializes (deny_unknown_fields; expires_at absent = perpetual/one-time,
// present = subscription/time-limited).
//
// Usage:
//   node scripts/license-tool.mjs keygen [out-dir]
//       → generates an Ed25519 keypair. Prints the 32-byte PUBLIC key as hex (paste into license.rs's
//         LICENSE_SIGNING_PUBKEY_BYTES to ARM licensing) and writes the PRIVATE key to
//         <out-dir>/compy-license.key (hex). KEEP THAT FILE OFFLINE — never commit it.
//   node scripts/license-tool.mjs mint <privkey-file> <buyer-email> [tier=pro] [expires-RFC3339]
//       → prints a signed license token to give the buyer.
//
// Examples:
//   node scripts/license-tool.mjs keygen ./secrets
//   node scripts/license-tool.mjs mint ./secrets/compy-license.key buyer@example.com pro
//   node scripts/license-tool.mjs mint ./secrets/compy-license.key buyer@example.com pro 2027-06-14T00:00:00Z

import crypto from "node:crypto";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const hex = (buf) => Buffer.from(buf).toString("hex");
const fromHex = (s) => Buffer.from(s.trim(), "hex");

// PKCS8 DER prefix for a raw 32-byte Ed25519 private seed (RFC 8410).
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
// SPKI DER prefix for a raw 32-byte Ed25519 public key.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function privFromSeedHex(seedHex) {
  const seed = fromHex(seedHex);
  if (seed.length !== 32) throw new Error("private key must be 32 bytes (64 hex chars)");
  return crypto.createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
}
function pubFromRawHex(rawHex) {
  return crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, fromHex(rawHex)]), format: "der", type: "spki" });
}
/** Raw 32-byte public key (hex) from a private key object — via the JWK `x` (base64url). */
function rawPubHex(privKeyObj) {
  const jwk = crypto.createPublicKey(privKeyObj).export({ format: "jwk" });
  return hex(Buffer.from(jwk.x, "base64url"));
}
/** Raw 32-byte private seed (hex) from a freshly generated key — via the JWK `d`. */
function rawSeedHex(privKeyObj) {
  const jwk = privKeyObj.export({ format: "jwk" });
  return hex(Buffer.from(jwk.d, "base64url"));
}

function keygen(outDir = ".") {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const seedHex = rawSeedHex(privateKey);
  const pubHex = rawPubHex(privateKey);
  mkdirSync(outDir, { recursive: true });
  const keyPath = join(outDir, "compy-license.key");
  writeFileSync(keyPath, seedHex + "\n", { mode: 0o600 });
  console.log("Compy Pro keypair generated.\n");
  console.log("PUBLIC KEY (paste into src-tauri/src/license.rs LICENSE_SIGNING_PUBKEY_BYTES to ARM):");
  // Emit as a Rust byte array for a copy-paste arm.
  const bytes = [...fromHex(pubHex)].map((b) => b).join(", ");
  console.log(`  pub hex: ${pubHex}`);
  console.log(`  rust:    const LICENSE_SIGNING_PUBKEY_BYTES: [u8; 32] = [${bytes}];\n`);
  console.log(`PRIVATE KEY written to: ${keyPath}`);
  console.log("  ⚠ KEEP THIS FILE OFFLINE. Never commit it, never put it in the repo / app / CI.");
}

function mint(privFile, email, tier = "pro", expires) {
  if (!privFile || !email) throw new Error("usage: mint <privkey-file> <buyer-email> [tier] [expires-RFC3339]");
  const seedHex = readFileSync(privFile, "utf8").trim();
  const privKey = privFromSeedHex(seedHex);
  const email_hash = crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  const payload = { email_hash, tier, issued_at: new Date().toISOString() };
  if (expires) {
    if (Number.isNaN(Date.parse(expires))) throw new Error(`bad expires date: ${expires}`);
    payload.expires_at = expires;
  }
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const sig = crypto.sign(null, payloadBytes, privKey); // Ed25519: algorithm must be null
  const token = `${hex(payloadBytes)}.${hex(sig)}`;
  // Self-verify before printing (catches any key/format mistake on the owner's side).
  const ok = crypto.verify(null, payloadBytes, pubFromRawHex(rawPubHex(privKey)), sig);
  if (!ok) throw new Error("internal: minted token failed self-verify");
  console.log(`# Compy Pro license for ${email} (${tier}${expires ? `, expires ${expires}` : ", perpetual"})`);
  console.log(token);
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === "keygen") keygen(args[0]);
  else if (cmd === "mint") mint(args[0], args[1], args[2], args[3]);
  else {
    console.log("Compy Pro license tool. Commands:\n  keygen [out-dir]\n  mint <privkey-file> <email> [tier=pro] [expires-RFC3339]");
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(1);
}
