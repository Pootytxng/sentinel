// @vitest-environment node
// Fleet trust-root guard: a normal release may not silently rotate the public key already embedded
// in signed-updater clients. Rotation is an explicit two-release owner/security procedure.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const trust = JSON.parse(readFileSync(join(root, "scripts", "updater-trust-root.json"), "utf8"));
const conf = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const release = readFileSync(join(root, "scripts", "release.ps1"), "utf8");

const FLEET_V094_PUBLIC_KEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDQzNzExREQxMEFBQjY3RDcKUldUWFo2c0swUjF4UTFta1F6b1lJMW15YnBHSWZyNXEwWDRvOSthSGdSVm9DYkQzMFZ3ZnpPMWUK";
const FLEET_V094_PUBLIC_KEY_SHA256 =
  "a9b2df7ea775a4a3a095791222e781b2629ef2bafa077d2f0e89be99bf50662e";

describe("updater fleet trust root", () => {
  it("pins the normal-release key to the v0.9.4 fleet anchor", () => {
    expect(trust.schema_version).toBe(1);
    expect(trust.key_id).toBe("43711DD10AAB67D7");
    expect(trust.public_key).toBe(FLEET_V094_PUBLIC_KEY);
    expect(conf.plugins.updater.pubkey).toBe(FLEET_V094_PUBLIC_KEY);
    expect(trust.public_key_sha256).toBe(FLEET_V094_PUBLIC_KEY_SHA256);
    expect(createHash("sha256").update(trust.public_key, "utf8").digest("hex")).toBe(
      FLEET_V094_PUBLIC_KEY_SHA256,
    );
  });

  it("makes normal staging fail closed on trust-root drift", () => {
    expect(release).toContain("Assert-UpdaterTrustRoot");
    expect(release).toContain("updater-trust-root.json");
    expect(release).toContain(FLEET_V094_PUBLIC_KEY_SHA256);
    expect(release).toContain("UPDATER TRUST-ROOT DRIFT");
  });
});
