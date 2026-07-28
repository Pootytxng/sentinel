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
const read = (...parts) => readFileSync(join(root, "scripts", ...parts), "utf8");
const stripComments = (text) =>
  text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

const script = read("release.ps1");
const reinstall = read("ship-reinstall.ps1");
const runtimeProof = read("lib", "runtime-proof.ps1");
const nativeProcess = read("lib", "native-process.ps1");
const executable = stripComments(script);
const reinstallExecutable = stripComments(reinstall);
const runtimeProofExecutable = stripComments(runtimeProof);
const nativeProcessExecutable = stripComments(nativeProcess);

// The COMPLETE release-critical PowerShell surface: every .ps1 the release pipeline can execute.
// The v0.9.9 publish died because the previous ban covered only ship-reinstall.ps1 + runtime-proof.ps1,
// so the structurally identical native invocation one file over (release.ps1's expected-404 releases-tag
// probe) was never guarded. Anything added to the pipeline must be added here too.
const releaseCriticalSurface = [
  { name: "release.ps1", text: script, executable },
  { name: "release-prepare.ps1", text: read("release-prepare.ps1") },
  { name: "release-publish.ps1", text: read("release-publish.ps1") },
  { name: "verify-release.ps1", text: read("verify-release.ps1") },
  { name: "ship-reinstall.ps1", text: reinstall, executable: reinstallExecutable },
  { name: "doc-budget.ps1", text: read("doc-budget.ps1") },
  { name: "lib/native-process.ps1", text: nativeProcess, executable: nativeProcessExecutable },
  { name: "lib/runtime-proof.ps1", text: runtimeProof, executable: runtimeProofExecutable },
].map((entry) => ({ ...entry, executable: entry.executable ?? stripComments(entry.text) }));

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
    expect(position("verify-release.ps1")).toBeLessThan(position("commit staged release version"));
  });

  it("runs the complete gate again on the exact clean release commit before building", () => {
    const releaseCommit = position("$releaseCommit = Get-GitLine");
    const exactGate = position("=== Exact release-commit verification ===");
    const signedBuild = position('Invoke-TauriSigned $keyPath @("build")');
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
    expect(executable).toContain('"tag", "-a", $releaseTag, $releaseCommit');
    expect(executable).toContain("does not point at the staged commit");
    expect(executable).toContain("push release tag");
  });

  it("signs via the grandfathered fleet-anchor path and proves the key before the version commit", () => {
    // The passwordless anchor is grandfathered (docs/UPDATER_TRUST_ROOT.md); the REAL gate is the
    // cryptographic sign-probe (key signs AND the pinned pubkey accepts), before any version write.
    const signingProbe = position("signing-key preflight verification");
    const versionWrite = position("Write-NoBom $confPath");
    const commit = position("commit staged release version");
    expect(script).toContain("GRANDFATHERED FLEET ANCHOR"); // the grandfather rationale is documented
    expect(signingProbe).toBeLessThan(versionWrite);
    expect(signingProbe).toBeLessThan(commit);
    // A real password passes THROUGH when set; passwordless fleet-key mode uses a child-only,
    // present-but-empty override without mutating the parent environment.
    expect(executable).toContain("TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $password");
    expect(executable).toContain("-Environment $signingEnvironment");
    expect(executable).not.toContain("[Environment]::SetEnvironmentVariable");
    // bug->guard (2026-07-23): signing carries the key CONTENT, not the path. `tauri signer sign`
    // (sign-probe preflight + receipt signing) treats TAURI_SIGNING_PRIVATE_KEY as literal base64
    // key material and never path-resolves it, so a path fails "failed to decode base64 secret key".
    expect(executable).toContain("Get-Content -LiteralPath $KeyPath -Raw");
    expect(executable).not.toContain("$env:COMPY_SIGN_KEY = $KeyPath");
    // Build + signer launch the actual Tauri JS entry point through node, without cmd.exe or shell:true.
    expect(executable).toContain("node_modules\\@tauri-apps\\cli\\tauri.js");
    expect(executable).not.toContain("shell:true");
    expect(executable).not.toContain("cmd.exe");
    expect(executable).toContain('Invoke-TauriSigned $keyPath @("build")');
    expect(executable).toContain('Invoke-TauriSigned $KeyPath @("signer", "sign", $Path)');
  });

  it("commits the release version via a parse-safe message file, never -m $Notes", () => {
    // bug->guard (2026-07-23): Windows PowerShell 5.1 mangles a multi-line note, or one with an
    // embedded double-quote, when it is passed to git.exe as a native -m argument -- git read a
    // fragment of the note as a pathspec and "commit staged release version" failed. The release
    // commit message must come from a file (-F), which is parse-safe for any note content.
    expect(executable).toContain('"commit", "-F", $commitMsgPath');
    expect(executable).toContain("Write-NoBom $commitMsgPath");
    expect(executable).not.toMatch(/"commit",\s*"-m"/);
  });

  it("bumps the release-state version anchor in lockstep with the version files and stages the doc", () => {
    // bug->guard (2026-07-23): the strict release-state verifier enforces tauri.conf version ==
    // STATE:latest_release_version. The first real release drifted because the bump updated the
    // version files but not the doc. The bump must rewrite the anchor AND stage docs/RELEASE_STATE.md
    // into the release commit so the exact-commit gate stays green.
    expect(executable).toContain("STATE:latest_release_version=");
    expect(executable).toContain('"src-tauri/Cargo.lock", "docs/RELEASE_STATE.md"');
  });

  it.runIf(process.platform === "win32")(
    "executes npm through node and npm-cli.js without a batch shim on Windows",
    () => {
      const result = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `. '${join(root, "scripts", "lib", "native-process.ps1").replaceAll("'", "''")}'; ` +
            "$npm=Get-NpmCliInvocation; " +
            '$result=Invoke-NativeProcess -Command $npm.Command -ArgumentList (@($npm.ArgumentPrefix)+@("--version")); ' +
            "if($result.ExitCode -ne 0){throw $result.StdErr}; $result.StdOut",
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
    const reinstall = position('Invoke-StreamedProcess "local ship-reinstall runtime proof"');
    expect(receiptHashes).toBeLessThan(bind);
    expect(bind).toBeLessThan(crypto);
    expect(crypto).toBeLessThan(reinstall);
    expect(script).toContain("Manifest URL does not bind the staged release");
    expect(script).toContain("Manifest signature does not match the staged updater signature");
  });

  it("publishes only after local verification and exact-source push", () => {
    const reinstall = position('Invoke-StreamedProcess "local ship-reinstall runtime proof"');
    const push = position('"push", "origin", "$($receipt.commit):main"');
    const draft = position("create draft GitHub release");
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
    const verify = position('Invoke-StreamedProcess "verify-release.ps1"');
    const postVerify = position("$postVerifyHead = Get-GitLine");
    const versionWrite = position("Write-NoBom $confPath");
    const postInstall = position("$postInstallHead = Get-GitLine");
    const literalPush = position('"push", "origin", "$($receipt.commit):main"');
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
    const reinstall = position('Invoke-StreamedProcess "local ship-reinstall runtime proof"');
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

  it("proves the installed build's embedded commit, executable version, and Windows app metadata before success", () => {
    expect(reinstall).toContain("Built release executable is missing before install");
    expect(reinstall).toContain("Could not resolve the source HEAD before install");
    expect(reinstall).toContain("Could not verify the source worktree before install");
    expect(reinstallExecutable).toContain(
      "Invoke-NativeProcess -Command $dest -ArgumentList @(\"/S\") -TimeoutMs 180000 -KillTreeOnTimeout $false",
    );
    expect(reinstall).toContain("Silent install timed out after 180 seconds");
    // Correctness invariant is the embedded HEAD commit + version, NOT byte-identity vs
    // target/release/compy.exe: NSIS packaging + non-reproducible Rust links mean a legitimate
    // install of THIS build has a different SHA-256 (same commit/version/size). See ship-reinstall.ps1.
    expect(reinstall).toContain("Select-String -Path $exe -Pattern $head -Quiet");
    expect(reinstall).toContain("INSTALLED-BINARY STALE");
    expect(reinstall).toContain("VersionInfo.ProductVersion");
    expect(reinstall).toContain("DisplayVersion");
    expect(reinstall).toContain("INSTALL-METADATA MISMATCH");
    expect(reinstallExecutable).toContain("ExpectedInstallerPath");
    expect(reinstallExecutable).toContain("ExpectedInstallerSha256");
    expect(reinstallExecutable).toContain("e2e-updater-probe.mjs");
    expect(reinstallExecutable).toContain("Invoke-CompyRuntimeProof");
    expect(runtimeProofExecutable).toContain("RUNTIME STAMP MISMATCH");
    expect(runtimeProofExecutable).toContain("RUNTIME VERSION MISMATCH");
    expect(reinstallExecutable).toContain("Start-NativeProcess -Command $exe");
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

// bug->guard (BOTH failed v0.9.9 publishes, 2026-07-27): release-critical PowerShell invoked tools
// as NATIVE commands. Under $ErrorActionPreference = "Stop", Windows PowerShell 5.1 promotes ANY
// native stderr write to a TERMINATING NativeCommandError once that stream is redirected, and
// `2>$null` does not prevent it -- it CAUSES it. Attempt 1 died on the CDP probe's always-expected
// first connection refusal; attempt 2 died on the releases-repo tag probe's expected HTTP 404, the
// correct first-publish answer, inside the branch written to act on it.
//
// The first guard for this only covered ship-reinstall.ps1 + lib/runtime-proof.ps1, so the
// structurally identical instance one file over survived and burned the next release. The bans below
// therefore cover the COMPLETE release-critical surface, not the two files that happened to fail.
// runtime-proof-guard.test.mjs and native-process-guard.test.mjs prove the behaviour end to end
// against real PowerShell 5.1 processes.
describe("release-critical PowerShell cannot be killed by an expected native failure", () => {
  it("keeps the strict error preference instead of relaxing it", () => {
    for (const { name, text, executable: exe } of releaseCriticalSurface) {
      // Every entry point declares Stop; the two dot-sourced libs inherit their caller's preference.
      if (!name.startsWith("lib/")) {
        expect(text, `${name} must set a strict error preference`).toContain('$ErrorActionPreference = "Stop"');
      }
      expect(exe, `${name} must not relax the error preference`).not.toMatch(
        /\$ErrorActionPreference\s*=\s*["'](?:Continue|SilentlyContinue|Ignore)["']/i,
      );
    }
  });

  it("routes every native invocation through the approved helper", () => {
    // Coverage (8). `& <tool>` is the exact shape that detonates; the approved helper is
    // scripts/lib/native-process.ps1, which is the ONLY file allowed to construct a process.
    for (const { name, executable: exe } of releaseCriticalSurface) {
      for (const tool of ["gh", "git", "node", "npm", "cargo", "powershell", "pwsh"]) {
        // A LONE `&` is PowerShell's call operator. `&&` is not: ship-reinstall.ps1's rebuild-advice
        // message quotes a cmd-style "cargo clean ... && npm run tauri build" for the owner to run,
        // and that text must not read as an invocation.
        expect(exe, `${name} invokes ${tool} natively`).not.toMatch(
          new RegExp(`(?<![&|])&(?![&|])\\s*"?\\$?\\w*${tool}\\b`, "i"),
        );
      }
      if (name !== "lib/native-process.ps1") {
        expect(exe, `${name} builds a process outside the approved helper`).not.toContain(
          "System.Diagnostics.ProcessStartInfo",
        );
      }
    }
    // Everything that runs a tool dot-sources the one helper.
    expect(executable).toContain('. (Join-Path $PSScriptRoot "lib\\native-process.ps1")');
    expect(reinstallExecutable).toContain('. (Join-Path $PSScriptRoot "lib\\runtime-proof.ps1")');
    expect(runtimeProofExecutable).toContain('. (Join-Path $PSScriptRoot "native-process.ps1")');
  });

  it("never substitutes a stderr redirect for explicit capture", () => {
    // Coverage (9). Redirecting a native command's stderr is what ARMS the promotion; there is no
    // safe form of it here, so none is permitted anywhere on the surface.
    for (const { name, executable: exe } of releaseCriticalSurface) {
      expect(exe, `${name} suppresses stderr instead of capturing it`).not.toContain("2>$null");
      expect(exe, `${name} merges stderr instead of capturing it`).not.toContain("2>&1");
      // `-ErrorAction SilentlyContinue` on a CMDLET (Get-Process, Get-Command, Remove-Item) is a
      // legitimate idiom and is not the defect -- the defect is a redirected NATIVE stream. But
      // silencing the process helpers themselves would defeat their fail-closed contract, so that
      // exact combination is banned.
      expect(exe, `${name} silences the process helper instead of letting it fail closed`).not.toMatch(
        /Invoke-(?:Native|Checked|Streamed|Captured)Process[^\n]*-ErrorAction/i,
      );
    }
  });

  it("never reads $LASTEXITCODE, including in the two thin wrappers", () => {
    // Once every tool and nested script runs through System.Diagnostics.Process, $LASTEXITCODE is
    // never set -- and `$null -ne 0` is TRUE. Wrappers use Invoke-StreamedProcess too.
    for (const { name, executable: exe } of releaseCriticalSurface) {
      expect(exe, `${name} still depends on $LASTEXITCODE`).not.toContain("$LASTEXITCODE");
    }
    expect(stripComments(read("release-prepare.ps1"))).toContain('Invoke-StreamedProcess "release prepare"');
    expect(stripComments(read("release-publish.ps1"))).toContain('Invoke-StreamedProcess "release publish"');
    expect(executable.match(/^\s*exit 0\s*$/gm) ?? [], "release.ps1 stage+publish must both exit 0").toHaveLength(2);
  });

  it("captures stdout, stderr and exit code explicitly, decoded as UTF-8", () => {
    // Coverages (4) and (5): structured stdout comes back as DATA, and stderr on a successful or
    // expected-result path is just another captured string.
    expect(nativeProcessExecutable).toContain("System.Diagnostics.ProcessStartInfo");
    expect(nativeProcessExecutable).toContain("$startInfo.RedirectStandardOutput = $true");
    expect(nativeProcessExecutable).toContain("$startInfo.RedirectStandardError = $true");
    // The build stamp carries U+00B7; console-code-page decoding would invent a mismatch.
    expect(nativeProcessExecutable).toContain("$startInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8");
    expect(nativeProcessExecutable).toContain("$startInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8");
    // Both pipes are drained asynchronously BEFORE the wait, or a chatty child deadlocks its buffer.
    expect((nativeProcessExecutable.match(/ReadToEndAsync\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(nativeProcessExecutable).toMatch(/ExitCode\s+=\s+\$exitCode/);
    // Optional timeout with termination, so a hung tool cannot hang a release.
    expect(nativeProcessExecutable).toMatch(/WaitForExit\(\$TimeoutMs\)/);
    expect(nativeProcessExecutable).toContain("$process.Kill()");
    expect(nativeProcessExecutable).toMatch(/TimedOut\s+=\s+\$timedOut/);
  });

  it("distinguishes an expected gh 404 from every other gh failure", () => {
    // Coverages (1)(2)(3): ONLY a real 404 reads as absence. Timeout, auth, permission, network and
    // malformed responses throw -- "I could not ask" is never "it is not there".
    expect(nativeProcessExecutable).toContain("function Test-GhNotFound");
    expect(nativeProcessExecutable).toContain("\\(HTTP 404\\)");
    expect(nativeProcessExecutable).toMatch(
      /if\s*\(\$Result\.TimedOut\s+-or\s+\$Result\.ExitCode\s+-eq\s+0\)\s*{\s*return\s*\$false\s*}/,
    );
    // The tag probe branches on the classification instead of collapsing every failure to "absent".
    const tagProbe = executable.slice(position("$tagProbe = Invoke-NativeProcess"), position("create releases-repo tag"));
    expect(tagProbe).toContain("$tagProbe.ExitCode -eq 0");
    expect(tagProbe).toContain("Test-GhNotFound $tagProbe");
    expect(tagProbe).toContain("Releases-repo tag lookup for $tag timed out.");
    expect(tagProbe).toMatch(/Releases-repo tag lookup for \$tag failed \(exit \$\(\$tagProbe\.ExitCode\)\)/);
    expect(tagProbe).toContain("Authentication/network failure is not treated as an absent tag");
    // A successful lookup that returns nothing is refused rather than guessed at.
    expect(tagProbe).toContain("succeeded but returned no sha");
  });

  it("keeps the source-tag and releases-lookup verifications fail-closed", () => {
    // Coverages (6) and (7). Get-GitLine throws on any nonzero git, so an unreadable ls-remote can
    // never present as "tag absent"; an empty answer cannot equal the staged commit either.
    expect(executable).toContain('Get-GitLine @("ls-remote", "origin", "refs/tags/$($receipt.tag)^{}")');
    expect(executable).toContain("does not resolve to the staged commit on origin");
    expect(executable).toMatch(/Invoke-CheckedProcess[^\n]*"git"/);
    // The release-list query and the releases-main lookup both abort on an unreadable answer.
    const releaseList = executable.slice(
      position("$releaseListProbe = Invoke-NativeProcess"),
      position("Refusing updater downgrade/non-increase"),
    );
    expect(releaseList).toMatch(/\$releaseListProbe\.TimedOut\s+-or\s+\$releaseListProbe\.ExitCode\s+-ne\s+0/);
    expect(releaseList).toContain("Could not query the releases repository.");
    expect(releaseList).toContain("Empty response.");
    expect(executable).toMatch(/\$releasesMainProbe\.TimedOut\s+-or\s+\$releasesMainProbe\.ExitCode\s+-ne\s+0/);
    expect(executable).toContain("Could not resolve $releasesRepo main sha for the release tag.");
    // Latest-release verification after publish is the same shape: unreadable is not verified.
    expect(executable).toMatch(/\$latestProbe\.TimedOut\s+-or\s+\$latestProbe\.ExitCode\s+-ne\s+0\s+-or\s+\$latestTag\s+-ne\s+\$tag/);
    expect(executable).toContain("latest-release verification failed");
  });

  it("treats a nonzero probe exit as a retryable attempt and still fails closed", () => {
    // The retry path exists...
    expect(runtimeProofExecutable).toMatch(/\$result\.ExitCode\s+-ne\s+0/);
    expect(runtimeProofExecutable).toContain("$transientFailures += 1");
    expect(runtimeProofExecutable).toContain("Start-Sleep -Milliseconds $RetryDelayMs");
    // ...and every real verdict still throws.
    expect(runtimeProofExecutable).toContain("RUNTIME PROOF FAILED: installed Compy exited");
    expect(runtimeProofExecutable).toContain("RUNTIME STAMP MISMATCH");
    expect(runtimeProofExecutable).toContain("RUNTIME VERSION MISMATCH");
    expect(runtimeProofExecutable).toContain("did not answer the build-stamp probe");
    // The only tolerated exception is a malformed payload; the verdicts live outside that catch.
    const parseCatch = runtimeProofExecutable.indexOf("$parseFailed = $true");
    const stampVerdict = runtimeProofExecutable.indexOf("RUNTIME STAMP MISMATCH");
    expect(parseCatch).toBeGreaterThanOrEqual(0);
    expect(parseCatch).toBeLessThan(stampVerdict);
    // "Do not simply suppress every exception around the entire proof block": the proof function
    // itself may contain exactly ONE catch -- the malformed-payload one above. Any second catch in
    // it could swallow a verdict. (The bounded cleanup catches in the capture helper are a
    // different function and are deliberately allowed.)
    const proofBody = runtimeProofExecutable.slice(runtimeProofExecutable.indexOf("function Invoke-CompyRuntimeProof"));
    expect(proofBody).not.toBe("");
    expect(proofBody.match(/\bcatch\b/g) ?? []).toHaveLength(1);
    expect(proofBody).not.toMatch(/\btrap\b/);
  });
});
