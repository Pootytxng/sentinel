// @vitest-environment node
// Updater-key backup guard.
//
// scripts/backup-updater-key.ps1 exists because the fleet anchor `43711DD10AAB67D7` is
// PASSWORDLESS: the raw bytes of compy-updater.key ARE the whole secret, and whoever holds them can
// sign an update that every installed Compy applies silently. The owner still needs a copy OFF this
// machine (OWNER_ACTION_CHECKLIST §A0), so the backup has to be encrypted before it can travel.
//
// A backup tool that has never been restored is a guess. This suite is the proof, and it runs
// against a THROWAWAY key: the real key is never read, copied, or referenced here.
//
// What it pins:
//   1. round-trip fidelity      — restored bytes are byte-identical to the original
//   2. confidentiality          — the plaintext never appears in the armored file
//   3. wrong passphrase fails   — and writes nothing
//   4. tampering fails          — AES-GCM authentication, not silent garbage
//   5. weak passphrase refused  — before anything is written
//   6. no silent clobber        — restore will not overwrite a live key without -Force
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const BACKUP = join(scriptsDir, "backup-updater-key.ps1");
const RESTORE = join(scriptsDir, "restore-updater-key.ps1");

const GOOD_PASS = "correct-horse-battery-staple";
const PS_TIMEOUT = 120_000;

let work;
// A throwaway 348-byte blob shaped like the real key file, so the tool is exercised at the size it
// will actually see. It is random noise, not signing material.
const fakeKey = Buffer.from(
  Array.from({ length: 348 }, (_, i) => (i * 37 + 11) % 251),
);

/** Run a .ps1 with Read-Host stubbed, so the interactive passphrase prompt is scriptable. */
function runPs(script, args, passphrase) {
  // Parameter names and switches must stay bare -- quoting them makes PowerShell read them as
  // positional string arguments.
  const quoted = args
    .map((a) => (String(a).startsWith("-") ? String(a) : `'${String(a).replace(/'/g, "''")}'`))
    .join(" ");
  const pass = passphrase.replace(/'/g, "''");
  const command = [
    `function Read-Host { param([string]$Prompt, [switch]$AsSecureString)`,
    `  ConvertTo-SecureString '${pass}' -AsPlainText -Force }`,
    `& '${script.replace(/'/g, "''")}' ${quoted}`,
  ].join("\n");
  return execFileSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    timeout: PS_TIMEOUT,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function expectPsFailure(script, args, passphrase) {
  let threw = false;
  let output = "";
  try {
    output = runPs(script, args, passphrase);
  } catch (error) {
    threw = true;
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  expect(threw, `expected ${script} to fail but it succeeded:\n${output}`).toBe(true);
  return output;
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "compy-key-backup-guard-"));
  writeFileSync(join(work, "fake.key"), fakeKey);
});

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe("updater key backup", () => {
  it("round-trips the key byte-for-byte and never armors it in the clear", () => {
    const armored = join(work, "backup.txt");
    runPs(BACKUP, ["-KeyPath", join(work, "fake.key"), "-OutPath", armored], GOOD_PASS);
    expect(existsSync(armored)).toBe(true);

    // Confidentiality: the plaintext must not be reachable from the file in any obvious encoding.
    const text = readFileSync(armored, "utf8");
    expect(text).not.toContain(fakeKey.toString("base64"));
    expect(text).not.toContain(fakeKey.toString("latin1"));
    expect(text).not.toContain(fakeKey.toString("hex"));
    // ...and it must carry its own restore instructions, so recovery never depends on this repo.
    expect(text).toContain("COMPY-UPDATER-KEY-BACKUP-v1");
    expect(text).toContain("PBKDF2-HMAC-SHA256");

    const restored = join(work, "restored.key");
    runPs(RESTORE, ["-BackupPath", armored, "-OutPath", restored], GOOD_PASS);
    expect(readFileSync(restored).equals(fakeKey)).toBe(true);
  });

  it("verifies without writing anything", () => {
    const armored = join(work, "verify.txt");
    runPs(BACKUP, ["-KeyPath", join(work, "fake.key"), "-OutPath", armored], GOOD_PASS);

    const out = join(work, "should-not-exist.key");
    const stdout = runPs(RESTORE, ["-BackupPath", armored, "-OutPath", out, "-Verify"], GOOD_PASS);
    expect(stdout).toContain("VERIFIED");
    expect(existsSync(out)).toBe(false);
  });

  it("rejects a wrong passphrase and writes nothing", () => {
    const armored = join(work, "wrongpass.txt");
    runPs(BACKUP, ["-KeyPath", join(work, "fake.key"), "-OutPath", armored], GOOD_PASS);

    const out = join(work, "wrongpass-out.key");
    const output = expectPsFailure(
      RESTORE,
      ["-BackupPath", armored, "-OutPath", out],
      "not-the-right-passphrase",
    );
    expect(output).toMatch(/Decryption failed/);
    expect(existsSync(out)).toBe(false);
  });

  it("rejects a tampered backup instead of yielding garbage", () => {
    const armored = join(work, "tampered.txt");
    runPs(BACKUP, ["-KeyPath", join(work, "fake.key"), "-OutPath", armored], GOOD_PASS);

    // Flip one base64 character inside the armored block. AES-GCM must catch it.
    const text = readFileSync(armored, "utf8");
    const begin = text.indexOf("-----BEGIN COMPY UPDATER KEY BACKUP-----");
    const bodyStart = text.indexOf("\n", begin) + 1;
    const original = text[bodyStart + 40];
    const swapped = original === "A" ? "B" : "A";
    writeFileSync(
      armored,
      text.slice(0, bodyStart + 40) + swapped + text.slice(bodyStart + 41),
    );

    const out = join(work, "tampered-out.key");
    const output = expectPsFailure(RESTORE, ["-BackupPath", armored, "-OutPath", out], GOOD_PASS);
    expect(output).toMatch(/Decryption failed|not a COMPY-UPDATER-KEY-BACKUP|too short/);
    expect(existsSync(out)).toBe(false);
  });

  it("refuses a passphrase too weak for a fleet-signing key", () => {
    const armored = join(work, "weak.txt");
    const output = expectPsFailure(
      BACKUP,
      ["-KeyPath", join(work, "fake.key"), "-OutPath", armored],
      "short",
    );
    expect(output).toMatch(/under 12 characters/);
    expect(existsSync(armored)).toBe(false);
  });

  it("will not silently overwrite an existing key", () => {
    const armored = join(work, "clobber.txt");
    runPs(BACKUP, ["-KeyPath", join(work, "fake.key"), "-OutPath", armored], GOOD_PASS);

    const existing = join(work, "existing.key");
    writeFileSync(existing, "DO NOT CLOBBER ME");
    const output = expectPsFailure(
      RESTORE,
      ["-BackupPath", armored, "-OutPath", existing],
      GOOD_PASS,
    );
    expect(output).toMatch(/already exists/);
    expect(readFileSync(existing, "utf8")).toBe("DO NOT CLOBBER ME");
  });
});
