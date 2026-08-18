import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const KEY_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function decodeRecord(value, expectedLength, label) {
  const record = Buffer.from(value, "base64");
  if (record.length !== expectedLength) {
    throw new Error(`${label} has ${record.length} decoded bytes; expected ${expectedLength}`);
  }
  return record;
}

function configuredPublicKey(encoded) {
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const lines = decoded.trim().split(/\r?\n/);
  if (lines.length !== 2 || !lines[0].startsWith("untrusted comment:")) {
    throw new Error("configured updater public key is not a two-line Minisign key");
  }

  const record = decodeRecord(lines[1], 42, "public key");
  const algorithm = record.subarray(0, 2).toString("ascii");
  if (algorithm !== "Ed" && algorithm !== "ED") {
    throw new Error(`unsupported public-key algorithm: ${algorithm}`);
  }

  return {
    keyId: record.subarray(2, 10),
    key: createPublicKey({
      key: Buffer.concat([KEY_PREFIX, record.subarray(10, 42)]),
      format: "der",
      type: "spki",
    }),
  };
}

function decodedSignature(text) {
  const trimmed = text.trim();
  const minisignText = trimmed.startsWith("untrusted comment:")
    ? trimmed
    : Buffer.from(trimmed, "base64").toString("utf8").trim();
  const lines = minisignText.split(/\r?\n/);
  if (
    lines.length !== 4 ||
    !lines[0].startsWith("untrusted comment:") ||
    !lines[2].startsWith("trusted comment: ")
  ) {
    throw new Error("updater signature is not a four-line Minisign signature");
  }

  const record = decodeRecord(lines[1], 74, "signature");
  const algorithm = record.subarray(0, 2).toString("ascii");
  if (algorithm !== "ED") {
    throw new Error(`updater signature must use pre-hashed Minisign mode; found ${algorithm}`);
  }

  return {
    keyId: record.subarray(2, 10),
    signature: record.subarray(10, 74),
    trustedComment: Buffer.from(lines[2].slice("trusted comment: ".length), "utf8"),
    globalSignature: decodeRecord(lines[3], 64, "trusted-comment signature"),
  };
}

export function verifyUpdaterArtifactBuffer(artifact, signatureText, encodedPublicKey) {
  const publicKey = configuredPublicKey(encodedPublicKey);
  const signature = decodedSignature(signatureText);
  if (!publicKey.keyId.equals(signature.keyId)) {
    throw new Error("signature key ID does not match the configured updater key");
  }

  const digest = createHash("blake2b512").update(artifact).digest();
  if (!verify(null, digest, publicKey.key, signature.signature)) {
    throw new Error("installer signature verification failed");
  }

  const trustedPayload = Buffer.concat([signature.signature, signature.trustedComment]);
  if (!verify(null, trustedPayload, publicKey.key, signature.globalSignature)) {
    throw new Error("trusted-comment signature verification failed");
  }
}

export function verifyUpdaterArtifactFiles(installerPath, signaturePath, configPath) {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const encodedPublicKey = config?.plugins?.updater?.pubkey;
  if (typeof encodedPublicKey !== "string" || encodedPublicKey.length === 0) {
    throw new Error("tauri.conf.json is missing the updater public key");
  }

  verifyUpdaterArtifactBuffer(
    readFileSync(installerPath),
    readFileSync(signaturePath, "utf8"),
    encodedPublicKey,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , installerPath, signaturePath, configPath] = process.argv;
  if (!installerPath || !signaturePath || !configPath || process.argv.length !== 5) {
    console.error("usage: node verify-updater-signature.mjs <installer> <signature> <tauri.conf.json>");
    process.exit(2);
  }

  try {
    verifyUpdaterArtifactFiles(installerPath, signaturePath, configPath);
    console.log("updater artifact signature verified");
  } catch (error) {
    console.error(`updater artifact verification failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
