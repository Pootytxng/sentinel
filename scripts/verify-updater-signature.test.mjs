// @vitest-environment node
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyUpdaterArtifactBuffer } from "./verify-updater-signature.mjs";

function fixture(artifact = Buffer.from("Compy release candidate")) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPublicKey = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const keyId = randomBytes(8);
  const publicRecord = Buffer.concat([Buffer.from("Ed"), keyId, rawPublicKey]);
  const publicText = `untrusted comment: test updater key\n${publicRecord.toString("base64")}\n`;
  const encodedPublicKey = Buffer.from(publicText, "utf8").toString("base64");

  const digest = createHash("blake2b512").update(artifact).digest();
  const artifactSignature = sign(null, digest, privateKey);
  const signatureRecord = Buffer.concat([Buffer.from("ED"), keyId, artifactSignature]);
  const trustedComment = "timestamp:1784764800\tfile:Compy_test_x64-setup.exe\tprehashed";
  const globalSignature = sign(
    null,
    Buffer.concat([artifactSignature, Buffer.from(trustedComment, "utf8")]),
    privateKey,
  );
  const signatureText = [
    "untrusted comment: signature from test updater key",
    signatureRecord.toString("base64"),
    `trusted comment: ${trustedComment}`,
    globalSignature.toString("base64"),
  ].join("\n");

  return { artifact, encodedPublicKey, signatureText };
}

describe("updater artifact signature verification", () => {
  it("accepts a valid pre-hashed Minisign-compatible signature and trusted comment", () => {
    const value = fixture();
    expect(() =>
      verifyUpdaterArtifactBuffer(value.artifact, value.signatureText, value.encodedPublicKey),
    ).not.toThrow();
  });

  it("accepts Tauri's base64-wrapped signature-file format", () => {
    const value = fixture();
    const wrapped = Buffer.from(value.signatureText, "utf8").toString("base64");
    expect(() =>
      verifyUpdaterArtifactBuffer(value.artifact, wrapped, value.encodedPublicKey),
    ).not.toThrow();
  });

  it("rejects changed installer bytes", () => {
    const value = fixture();
    const changed = Buffer.from(value.artifact);
    changed[0] ^= 0xff;
    expect(() =>
      verifyUpdaterArtifactBuffer(changed, value.signatureText, value.encodedPublicKey),
    ).toThrow(/installer signature verification failed/i);
  });

  it("rejects a signature made by a different configured key", () => {
    const value = fixture();
    const other = fixture();
    expect(() =>
      verifyUpdaterArtifactBuffer(value.artifact, value.signatureText, other.encodedPublicKey),
    ).toThrow(/key ID does not match/i);
  });
});
