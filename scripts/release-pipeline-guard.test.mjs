// @vitest-environment node
// bug->guard (2026-07-22): the first updater release pipeline published the fleet release
// before reinstalling/verifying locally and before pushing its exact source. A failed signing
// attempt also left a release-version commit behind, so retries silently burned 0.9.2 -> 0.9.4.
// These guards inspect executable lines only (comments are stripped) so explanatory prose cannot
// satisfy an ordering assertion, which was itself a live review finding in the first guard.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = readFileSync(join(root, "scripts", "release.ps1"), "utf8");
const reinstall = readFileSync(join(root, "scripts", "ship-reinstall.ps1"), "utf8");
const executable = script
  .split(/\r?\n/)
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");
const reinstallExecutable = reinstall
  .split(/\r?\n/)
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");

const position = (needle) => {
  const index = executable.indexOf(needle);
  expect(index, `missing release invariant: ${needle}`).toBeGreaterThanOrEqual(0);
  return index;
};
const reinstallPosition = (needle) => {
  const index = reinstallExecutable.indexOf(needle);
  expect(index, `missing reinstall invariant: ${needle}`).toBeGreaterThanOrEqual(0);
  return index;
};

describe("release pipeline safety", () => {
  it("resolves the repository from PSScriptRoot, never a workstation path", () => {
    expect(script).toContain("$PSScriptRoot");
    expect(script).not.toMatch(/C:\\Users\\/i);
    expect(reinstall).toContain("$PSScriptRoot");
    expect(reinstall).not.toMatch(/C:\\Users\\/i);
  });

  it("defaults to staging and requires an explicit publish mode", () => {
    expect(script).toMatch(/ValidateSet\("stage",\s*"publish"\)/i);
    expect(script).toMatch(/\$Mode\s*=\s*"stage"/i);
    expect(script).not.toContain("NoPublish");
    expect(script).not.toContain("SkipReinstall");
  });

  it("refuses dirty, non-main, or unsynchronized source before changing a version", () => {
    const status = position("status --porcelain");
    const branch = position("branch --show-current");
    const fetch = position("fetch origin main");
    const versionWrite = position("Write-NoBom $confPath");
    expect(status).toBeLessThan(versionWrite);
    expect(branch).toBeLessThan(versionWrite);
    expect(fetch).toBeLessThan(versionWrite);
  });

  it("runs the canonical verification gate before creating a release commit", () => {
    expect(position("verify-release.ps1")).toBeLessThan(position("git -C $repo commit"));
  });

  it("runs the complete gate again on the exact clean release commit before building", () => {
    const releaseCommit = position("$releaseCommit = Get-GitLine");
    const exactGate = position("=== Exact release-commit verification ===");
    const signedBuild = position('Invoke-Native "Signed Tauri build"');
    const exactGateBlock = executable.slice(exactGate, signedBuild);
    expect(releaseCommit).toBeLessThan(exactGate);
    expect(exactGate).toBeLessThan(signedBuild);
    expect(exactGateBlock).toContain("verify-release.ps1");
    expect(exactGateBlock).toContain("Assert-CleanMain");
    expect(exactGateBlock).toContain("$postCommitVerifyHead = Get-GitLine");
  });

  it("uses a staged receipt so publishing never bumps or rebuilds a new version", () => {
    expect(script).toContain("release-stage.json");
    expect(script).toMatch(/if\s*\(\$Mode\s+-eq\s+"publish"\)/i);
    expect(script).toMatch(/HEAD does not match staged commit/i);
    expect(script).toContain("verify-updater-signature.mjs");
    expect(executable).toContain("schema_version = 3");
    expect(executable).toContain("staged receipt signature verification");
    expect(executable).toContain("staged receipt self-verification");
    expect(executable).toContain("canonicalInstallerRelative");
    expect(executable).toContain("canonicalSignatureRelative");
    expect(executable).toContain("canonicalManifestRelative");
  });

  it("refuses a pending Gaming Mode contract in both stage and publish (reconcile 2026-07-23)", () => {
    expect(executable).toContain('Assert-NoPendingGamingContract "stage"');
    expect(executable).toContain('Assert-NoPendingGamingContract "publish"');
    // A cleanly-cleared backup must NOT block; a live contract must — same rule in both scripts.
    expect(executable).toContain('-notlike "*.cleared-*.json.bak"');
    expect(reinstallExecutable).toContain('-notlike "*.cleared-*.json.bak"');
    // The pinned broad glob is preserved so the ordering guard still anchors.
    expect(reinstallExecutable).toContain('Where-Object { $_.Name -like "gaming-session*" }');
  });

  it("verifies the embedded release stamp, records installer size, and requires a pre-existing tag", () => {
    expect(executable).toContain("EMBEDDED-STAMP MISMATCH");
    expect(executable).toContain("bytes = (Get-Item -LiteralPath $installer).Length");
    expect(executable).toContain("git -C $repo tag -a $releaseTag $releaseCommit");
    expect(executable).toContain("does not point at the staged commit");
    expect(executable).toContain("push release tag");
  });

  it("refuses passwordless signing and proves the key before creating a version commit", () => {
    const passwordGate = position("requires a non-empty TAURI_SIGNING_PRIVATE_KEY_PASSWORD");
    const signingProbe = position("signing-key preflight verification");
    const versionWrite = position("Write-NoBom $confPath");
    const commit = position("commit staged release version");
    expect(passwordGate).toBeLessThan(versionWrite);
    expect(signingProbe).toBeLessThan(versionWrite);
    expect(signingProbe).toBeLessThan(commit);
    expect(script).not.toContain("TAURI_SIGNING_PRIVATE_KEY_PASSWORD:''");
    expect(executable).not.toContain("spawnSync");
    expect(executable).toContain("Get-Command npm.cmd");
    expect(executable).toContain("& $npmCmd run tauri -- signer sign $Path");
    expect(executable).toContain("& $npmCmd run tauri build");
  });

  it.runIf(process.platform === "win32")(
    "executes the exact PowerShell-resolved npm.cmd runner on Windows",
    () => {
      const result = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$npmCmd=(Get-Command npm.cmd -ErrorAction Stop).Source; & $npmCmd --version; exit $LASTEXITCODE",
        ],
        { cwd: root, encoding: "utf8", shell: false },
      );
      expect(result.status, result.stderr || result.error?.message).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    },
  );

  it("revalidates manifest binding and cryptography when publishing", () => {
    const receiptHashes = position('Assert-ReceiptHash "Updater manifest"');
    const bind = position("Read-BoundManifest $manifestPath");
    const crypto = position("publish-time updater signature verification");
    const reinstall = position('& (Join-Path $repo "scripts\\ship-reinstall.ps1") -VerifyRuntime');
    expect(receiptHashes).toBeLessThan(bind);
    expect(bind).toBeLessThan(crypto);
    expect(crypto).toBeLessThan(reinstall);
    expect(script).toContain("Manifest URL does not bind the staged release");
    expect(script).toContain("Manifest signature does not match the staged updater signature");
  });

  it("publishes only after local verification and exact-source push", () => {
    const reinstall = position('& (Join-Path $repo "scripts\\ship-reinstall.ps1") -VerifyRuntime');
    const push = position('git -C $repo push origin "$($receipt.commit):main"');
    const draft = position("gh release create");
    const downloadedCrypto = position("downloaded draft signature verification");
    const publish = position("--draft=false");
    expect(reinstall).toBeLessThan(push);
    expect(push).toBeLessThan(draft);
    expect(draft).toBeLessThan(downloadedCrypto);
    expect(downloadedCrypto).toBeLessThan(publish);
    expect(draft).toBeLessThan(publish);
    expect(executable.slice(draft, publish)).toContain("--draft");
    expect(executable.slice(draft, publish)).toContain("--verify-tag");
    expect(executable.slice(draft, publish)).not.toContain("--target $head");
  });

  it("rechecks source identity after verification, install, build, and push", () => {
    const verify = position('& (Join-Path $repo "scripts\\verify-release.ps1")');
    const postVerify = position("$postVerifyHead = Get-GitLine");
    const versionWrite = position("Write-NoBom $confPath");
    const postInstall = position("$postInstallHead = Get-GitLine");
    const literalPush = position('git -C $repo push origin "$($receipt.commit):main"');
    const postBuild = position("$postBuildHead = Get-GitLine");
    const receiptWrite = position("Write-NoBom $stageReceiptPath");
    expect(verify).toBeLessThan(postVerify);
    expect(postVerify).toBeLessThan(versionWrite);
    expect(postInstall).toBeLessThan(literalPush);
    expect(postBuild).toBeLessThan(receiptWrite);
    expect(executable).toContain("Source push did not publish the staged commit");
  });

  it("checks remote truth before install and the exact public latest URLs after publish", () => {
    const remoteList = position("function Assert-PublicVersionCanPublish");
    const downgrade = position("Refusing updater downgrade/non-increase");
    const reinstall = position('& (Join-Path $repo "scripts\\ship-reinstall.ps1") -VerifyRuntime');
    const firstMonotonicCheck = position("Assert-PublicVersionCanPublish $receipt.version $tag");
    const finalMonotonicCheck = position(
      "Assert-PublicVersionCanPublish $receipt.version $tag -AllowOwnDraft",
    );
    const publish = position("--draft=false");
    const publicManifest = position('releases/latest/download/latest.json" $publicManifest');
    const publicCrypto = position("public latest signature verification");
    expect(remoteList).toBeLessThan(downgrade);
    expect(firstMonotonicCheck).toBeLessThan(reinstall);
    expect(downgrade).toBeLessThan(reinstall);
    expect(finalMonotonicCheck).toBeLessThan(publish);
    expect(publish).toBeLessThan(publicManifest);
    expect(publicManifest).toBeLessThan(publicCrypto);
    expect(executable).toContain("Authentication/network failure is not treated as an absent tag");
    expect(script).toContain("single-writer owner action");
  });

  it("proves installed bytes, executable version, and Windows app metadata before success", () => {
    expect(reinstall).toContain("Built release executable is missing before install");
    expect(reinstall).toContain("Could not resolve the source HEAD before install");
    expect(reinstall).toContain("Could not verify the source worktree before install");
    expect(reinstallExecutable).toContain("WaitForExit(180000)");
    expect(reinstall).toContain("Silent install timed out after 180 seconds");
    expect(reinstall).toContain("Get-FileHash $releaseExe");
    expect(reinstall).toContain("Get-FileHash $exe");
    expect(reinstall).toContain("VersionInfo.ProductVersion");
    expect(reinstall).toContain("DisplayVersion");
    expect(reinstall).toContain("INSTALL-METADATA MISMATCH");
    expect(reinstallExecutable).toContain("ExpectedInstallerPath");
    expect(reinstallExecutable).toContain("ExpectedInstallerSha256");
    expect(reinstallExecutable).toContain("e2e-updater-probe.mjs");
    expect(reinstallExecutable).toContain("RUNTIME STAMP MISMATCH");
    expect(reinstallExecutable).toContain("RUNTIME VERSION MISMATCH");
    expect(reinstallExecutable).toContain("Start-Process $exe");
  });

  it("refuses every Gaming Mode contract before stopping Compy or touching installers", () => {
    const contractGate = reinstallPosition('Where-Object { $_.Name -like "gaming-session*" }');
    const refusal = reinstallPosition("GAMING MODE RESTORE REQUIRED");
    const processStop = reinstallPosition("Get-Process compy");
    const desktopTouch = reinstallPosition("Get-ChildItem $desk");
    expect(contractGate).toBeLessThan(refusal);
    expect(refusal).toBeLessThan(processStop);
    expect(refusal).toBeLessThan(desktopTouch);
    expect(reinstallExecutable).not.toContain("Remove-Item $pendingGamingContracts");
  });
});
