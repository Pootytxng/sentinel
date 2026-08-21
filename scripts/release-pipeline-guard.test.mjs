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
const releaseArtifacts = read("lib", "release-artifacts.ps1");
const releaseTransaction = read("lib", "release-transaction.ps1");
const publishAdapter = read("lib", "release-publish-adapter.ps1");
const executable = stripComments(script);
const reinstallExecutable = stripComments(reinstall);
const runtimeProofExecutable = stripComments(runtimeProof);
const nativeProcessExecutable = stripComments(nativeProcess);
const releaseArtifactsExecutable = stripComments(releaseArtifacts);
const transactionExecutable = stripComments(releaseTransaction);
const publishAdapterExecutable = stripComments(publishAdapter);
const productionExecutable = [executable, transactionExecutable, publishAdapterExecutable].join("\n");

// The COMPLETE release-critical PowerShell surface: every .ps1 the release pipeline can execute.
// The v0.9.9 publish died because the previous ban covered only ship-reinstall.ps1 + runtime-proof.ps1,
// so the structurally identical native invocation one file over (release.ps1's expected-404 releases-tag
// probe) was never guarded. Anything added to the pipeline must be added here too.
const releaseCriticalSurface = [
  { name: "release.ps1", text: script, executable },
  { name: "release-prepare.ps1", text: read("release-prepare.ps1") },
  { name: "release-publish.ps1", text: read("release-publish.ps1") },
  { name: "release-prove.ps1", text: read("release-prove.ps1") },
  { name: "verify-release.ps1", text: read("verify-release.ps1") },
  { name: "ship-reinstall.ps1", text: reinstall, executable: reinstallExecutable },
  { name: "doc-budget.ps1", text: read("doc-budget.ps1") },
  { name: "lib/native-process.ps1", text: nativeProcess, executable: nativeProcessExecutable },
  { name: "lib/release-artifacts.ps1", text: releaseArtifacts, executable: releaseArtifactsExecutable },
  { name: "lib/runtime-proof.ps1", text: runtimeProof, executable: runtimeProofExecutable },
  { name: "lib/release-transaction.ps1", text: releaseTransaction, executable: transactionExecutable },
  { name: "lib/release-publish-adapter.ps1", text: publishAdapter, executable: publishAdapterExecutable },
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
    expect(script).toMatch(/ValidateSet\("stage",\s*"prove",\s*"publish"\)/i);
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

  // bug->guard (2026-08-19): the v0.9.26 stage spent two ~13-minute verify+build cycles discovering
  // two states that were knowable in the first second - a leftover local tag from an abandoned
  // attempt, and a RELEASE_STATE still naming the previous candidate. The preflight only pays for
  // itself if it runs BEFORE the expensive gates, so the ordering is the assertion.
  it("resolves the next version and clears the cheap blockers before the expensive gates", () => {
    const preflight = position("Assert-StageCandidateReady $nextText");
    const verify = position('Invoke-StreamedProcess "verify-release.ps1"');
    const versionWrite = position("Write-NoBom $confPath");
    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(verify);
    expect(preflight).toBeLessThan(versionWrite);
    // The version math must be hoisted above the preflight, or it has nothing to check against.
    expect(position("$nextText = $next.ToString()")).toBeLessThan(preflight);
    // Both blockers, and the doc rule kept in ONE implementation (the node checker owns it).
    expect(executable).toContain('Get-GitLine @("tag", "--list", $tag)');
    expect(executable).toContain('Get-GitLine @("ls-remote", "--tags", "origin", "refs/tags/$tag")');
    expect(executable).toContain('"--stage-candidate", $NextVersion');
    expect(executable).toContain("git tag -d $tag");
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
    expect(script).toMatch(/if\s*\(\$Mode\s+-eq\s+"publish"\s+-or\s+\$Mode\s+-eq\s+"prove"\)/i);
    expect(script).toMatch(/HEAD neither matches nor contains the staged release commit/i);
    expect(script).toContain('"merge-base", "--is-ancestor", $context.Receipt.commit, "HEAD"');
    expect(script).toContain("verify-updater-signature.mjs");
    expect(executable).toContain("schema_version = 3");
    expect(executable).toContain("staged receipt signature verification");
    expect(executable).toContain("staged receipt self-verification");
    expect(executable).toContain("$canonicalInstaller");
    expect(executable).toContain('"$canonicalInstaller.sig"');
    expect(executable).toContain("src-tauri/target/release/bundle/nsis/latest.json");
    expect(executable).toContain("Invoke-ReleaseTransaction");
  });

  it("refuses a pending Gaming Mode contract in both stage and publish (reconcile 2026-07-23)", () => {
    expect(executable).toContain('Assert-NoPendingGamingContract "stage"');
    expect(executable).toContain("Assert-NoPendingGamingContract $Mode");
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
    expect(publishAdapterExecutable).toContain("push exact source tag");
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
        { cwd: root, encoding: "utf8", shell: false, windowsHide: true },
      );
      expect(result.status, result.stderr || result.error?.message).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    },
  );

  it("revalidates manifest binding and cryptography when publishing", () => {
    const receiptHashes = position('Assert-ReceiptHash "Updater manifest"');
    const bind = position("Read-BoundManifest $context.Manifest");
    const crypto = position("publish-time updater signature verification");
    expect(receiptHashes).toBeLessThan(bind);
    expect(bind).toBeLessThan(crypto);
    expect(transactionExecutable).toContain('"receipt_verified"');
    expect(transactionExecutable.indexOf('"receipt_verified"')).toBeLessThan(
      transactionExecutable.indexOf('"runtime_proved"'),
    );
    expect(releaseArtifacts).toContain("Manifest URL does not bind the staged release");
    expect(releaseArtifacts).toContain("Manifest signature does not match the staged updater signature");
  });

  it("publishes only after local verification and exact-source push", () => {
    const stages = [
      "runtime_proved",
      "source_main_pushed",
      "source_tag_pushed",
      "releases_tag_created",
      "draft_created",
      "draft_assets_verified",
      "release_published",
      "public_assets_verified",
    ];
    const indices = stages.map((stage) => transactionExecutable.indexOf(`"${stage}"`));
    expect(indices.every((index) => index >= 0)).toBe(true);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(publishAdapterExecutable).toContain("local ship-reinstall runtime proof");
    expect(publishAdapterExecutable).toContain("push staged source");
    expect(publishAdapterExecutable).toContain("create private draft release");
    expect(publishAdapterExecutable).toContain("downloaded draft signature verification");
    expect(publishAdapterExecutable).toContain("--draft=false");
    expect(publishAdapterExecutable).toContain("--verify-tag");
  });

  it("rechecks source identity after verification, install, build, and push", () => {
    const verify = position('Invoke-StreamedProcess "verify-release.ps1"');
    const postVerify = position("$postVerifyHead = Get-GitLine");
    const versionWrite = position("Write-NoBom $confPath");
    const postBuild = position("$postBuildHead = Get-GitLine");
    const receiptWrite = position("Write-NoBom $stageReceiptPath");
    expect(verify).toBeLessThan(postVerify);
    expect(postVerify).toBeLessThan(versionWrite);
    expect(postBuild).toBeLessThan(receiptWrite);
    expect(publishAdapterExecutable).toContain("Inspect-ProductionSourceMain");
    expect(publishAdapterExecutable).toContain("merge-base");
    expect(publishAdapterExecutable).toContain("origin/main and the staged release commit have diverged");
  });

  it("checks remote truth before install and the exact public latest URLs after publish", () => {
    const remoteList = position("function Assert-PublicVersionCanPublish");
    const downgrade = position("Refusing updater downgrade/non-increase");
    expect(remoteList).toBeLessThan(downgrade);
    expect(executable).toContain("Assert-PublicVersionCanPublish $context.Receipt.version");
    expect(publishAdapterExecutable).toContain("publicVersionGate");
    expect(publishAdapterExecutable).toContain("releases/latest/download/latest.json");
    expect(publishAdapterExecutable).toContain("public updater signature verification");
    expect(transactionExecutable.indexOf('"release_published"')).toBeLessThan(
      transactionExecutable.indexOf('"public_assets_verified"'),
    );
    expect(executable).toContain("Authentication/network failure is not treated as an absent tag");
    expect(transactionExecutable).toContain("OWNER BOUNDARY");
  });

  it("proves the installed build's embedded commit, executable version, and Windows app metadata before success", () => {
    expect(reinstall).toContain("Built release executable is missing before install");
    expect(reinstall).toContain("Could not resolve the expected source commit before install");
    expect(reinstall).toContain("Could not verify the source worktree before install");
    expect(reinstallExecutable).toContain(
      "Invoke-NativeProcess -Command $dest -ArgumentList @(\"/S\") -TimeoutMs 180000 -KillTreeOnTimeout $false",
    );
    expect(reinstall).toContain("Silent install timed out after 180 seconds");
    // Correctness invariant is the embedded HEAD commit + version, NOT byte-identity vs
    // target/release/compy.exe: NSIS packaging + non-reproducible Rust links mean a legitimate
    // install of THIS build has a different SHA-256 (same commit/version/size). See ship-reinstall.ps1.
    expect(reinstall).toContain('$proofCommit = if ($VerifyRuntime) { $ExpectedCommit } else { "HEAD" }');
    expect(reinstall).toContain("Select-String -Path $exe -Pattern $expectedShortCommit -Quiet");
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

  // bug->guard (2026-08-21, issue #156): a silent NSIS install exited 0, rewrote the Desktop
  // shortcut, and left %LOCALAPPDATA%\Compy\compy.exe carrying its PREVIOUS mtime and its previous
  // embedded stamp (402b0080). Only the step-4 Select-String stamp gate caught it, and only as "a
  // wrong/older build is installed" -- after the fact, with no name for the cause. Every compy
  // PROCESS being gone is not the same fact as the exe being WRITABLE, and NSIS in silent mode
  // SKIPS a file it cannot overwrite rather than failing. These assertions pin the two gates that
  // make the skip impossible to pass silently, and pin that the fix was NOT to loosen the stamp
  // gate -- which the issue forbids in as many words.
  it("proves compy.exe is unlocked before installing and proves the payload changed after (#156)", () => {
    // The probe must demand EXCLUSIVE access. A narrower share mode succeeds against a file NSIS
    // will still decline to replace, which would make the gate decorative.
    expect(reinstallExecutable).toContain("[System.IO.FileShare]::None");
    expect(reinstall).toContain("PAYLOAD LOCKED (issue #156)");

    // Ordering: prove-unlocked BEFORE the installer runs, prove-replaced AFTER it.
    const lockGate = reinstallPosition("Wait-CompyExeWritable -Path $exe");
    const install = reinstallPosition('Invoke-NativeProcess -Command $dest -ArgumentList @("/S")');
    const replacementGate = reinstallPosition("$payloadUntouched");
    expect(lockGate).toBeLessThan(install);
    expect(install).toBeLessThan(replacementGate);

    // The replacement proof compares BOTH mtime and size against the pre-install identity: mtime
    // alone would miss a same-second rebuild of a same-size binary.
    expect(reinstallExecutable).toContain("LastWriteTimeUtc");
    expect(reinstallExecutable).toContain("$prePayload.WriteTimeUtc");
    expect(reinstallExecutable).toContain("$prePayload.Length");

    // Exactly ONE retry, loud, and keyed to that exact signature -- never a blanket retry (the
    // accepted #171 precedent), and it re-proves the lock cleared instead of hammering the installer.
    expect(reinstallExecutable).toContain("if ($installAttempts -ge 2)");
    expect(reinstallExecutable).toContain("Write-Warning");
    expect(reinstall).toContain("WARN issue #156");
    expect(reinstall).toContain("SILENT INSTALL SKIPPED THE PAYLOAD (issue #156)");
    expect(reinstallExecutable.lastIndexOf("Wait-CompyExeWritable -Path $exe")).toBeGreaterThan(install);

    // The issue's own instruction: do NOT fix this by loosening the stamp gate. It stays, and it
    // stays LAST -- the payload gate diagnoses the cause, the stamp gate still owns the verdict.
    const stampGate = reinstallPosition("Select-String -Path $exe -Pattern $expectedShortCommit -Quiet");
    expect(replacementGate).toBeLessThan(stampGate);
    expect(reinstall).toContain("INSTALLED-BINARY STALE");
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
    expect(stripComments(read("release-prove.ps1"))).toContain('Invoke-StreamedProcess "release local proof"');
    expect(stripComments(read("release-publish.ps1"))).toContain('Invoke-StreamedProcess "release publish"');
    expect(executable.match(/^\s*exit 0\s*$/gm) ?? [], "release.ps1 stage+prove+publish must all exit 0").toHaveLength(3);
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
    // The production adapter branches on the classification instead of collapsing failures to absence.
    expect(publishAdapterExecutable).toContain("Test-GhNotFound $result");
    expect(publishAdapterExecutable).toContain("GitHub API lookup timed out");
    expect(publishAdapterExecutable).toContain(
      "Authentication, permission, network, and malformed failures are fatal",
    );
    expect(publishAdapterExecutable).toContain("GitHub API lookup succeeded with an empty response");
    expect(publishAdapterExecutable).toContain("GitHub API lookup returned malformed JSON");
  });

  it("keeps the source-tag and releases-lookup verifications fail-closed", () => {
    // Coverages (6) and (7). Get-GitLine throws on any nonzero git, so an unreadable ls-remote can
    // never present as "tag absent"; an empty answer cannot equal the staged commit either.
    expect(publishAdapterExecutable).toContain('"ls-remote", "origin"');
    expect(publishAdapterExecutable).toContain('"refs/tags/$($Context.Receipt.tag)^{}"');
    expect(publishAdapterExecutable).toContain("exact annotated tag object and receipt commit");
    expect(publishAdapterExecutable).toContain("Invoke-ProductionGitChecked");
    expect(publishAdapterExecutable).toContain('else { "git" }');
    // The release-list query and the releases-main lookup both abort on an unreadable answer.
    const releaseList = executable.slice(
      position("$releaseListProbe = Invoke-NativeProcess"),
      position("Refusing updater downgrade/non-increase"),
    );
    expect(releaseList).toMatch(/\$releaseListProbe\.TimedOut\s+-or\s+\$releaseListProbe\.ExitCode\s+-ne\s+0/);
    expect(releaseList).toContain("Could not query the releases repository.");
    expect(releaseList).toContain("Empty response.");
    expect(publishAdapterExecutable).toContain("Get-ProductionReleasesMain");
    expect(publishAdapterExecutable).toContain("Releases repository main lookup returned a malformed object id");
    expect(publishAdapterExecutable).toContain("Inspect-ProductionPublicAssets");
    expect(publishAdapterExecutable).toContain("Public latest manifest");
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
    const proofStart = runtimeProofExecutable.indexOf("function Invoke-CompyRuntimeProof");
    const proofEnd = runtimeProofExecutable.indexOf("function Wait-LoopbackPortClosed");
    const proofBody = runtimeProofExecutable.slice(proofStart, proofEnd);
    expect(proofBody).not.toBe("");
    expect(proofBody.match(/\bcatch\b/g) ?? []).toHaveLength(1);
    expect(proofBody).not.toMatch(/\btrap\b/);
  });
});
