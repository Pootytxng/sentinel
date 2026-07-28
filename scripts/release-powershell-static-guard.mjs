#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const releaseCriticalPowerShell = [
  "scripts/release.ps1",
  "scripts/release-prepare.ps1",
  "scripts/release-publish.ps1",
  "scripts/release-prove.ps1",
  "scripts/ship-reinstall.ps1",
  "scripts/verify-release.ps1",
  "scripts/doc-budget.ps1",
  "scripts/lib/native-process.ps1",
  "scripts/lib/release-artifacts.ps1",
  "scripts/lib/runtime-proof.ps1",
  "scripts/lib/release-transaction.ps1",
  "scripts/lib/release-publish-adapter.ps1",
];

const entrypoints = new Set([
  "scripts/release.ps1",
  "scripts/release-prepare.ps1",
  "scripts/release-publish.ps1",
  "scripts/release-prove.ps1",
  "scripts/ship-reinstall.ps1",
  "scripts/verify-release.ps1",
  "scripts/doc-budget.ps1",
]);

const stripFullLineComments = (text) =>
  text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

const stripStaticallyDisabledBlocks = (text) => {
  let output = text;
  const startPattern = /\bif\s*\(\s*\$(?:false|null)\s*\)\s*\{/gi;
  for (;;) {
    const match = startPattern.exec(output);
    if (!match) return output;
    let depth = 1;
    let quote = "";
    let index = match.index + match[0].length;
    for (; index < output.length && depth > 0; index += 1) {
      const char = output[index];
      if (quote) {
        if (char === quote && output[index - 1] !== "`") quote = "";
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
      }
    }
    output = `${output.slice(0, match.index)}${output.slice(index)}`;
    startPattern.lastIndex = 0;
  }
};

const listPowerShell = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listPowerShell(path);
    return entry.name.toLowerCase().endsWith(".ps1") ? [path] : [];
  });

const braceDepthAt = (text, end) => {
  let depth = 0;
  let quote = "";
  for (let index = 0; index < end; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote && text[index - 1] !== "`") quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
    }
  }
  return depth;
};

const requiredTokens = new Map([
  [
    "scripts/release.ps1",
    [
      "Read-Utf8 $stageReceiptPath",
      "staged receipt signature verification",
      'Get-GitLine @("cat-file", "-t", $context.Receipt.tag)',
      'Assert-ReceiptHash "Installer"',
      "publish-time updater signature verification",
      "Assert-PublicVersionCanPublish",
      "Invoke-ReleaseTransaction",
    ],
  ],
  [
    "scripts/ship-reinstall.ps1",
    [
      "ExpectedInstallerSha256",
      "Invoke-NativeProcess -Command $dest",
      "Invoke-CompyRuntimeProof",
      "VerifyRuntime",
      "ProofOnly",
      "Start-NativeProcess",
      "Wait-LoopbackPortClosed -Port $debugPort",
      "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $null",
      "normal relaunch exited during the health window",
    ],
  ],
  [
    "scripts/lib/native-process.ps1",
    [
      "StandardOutputEncoding = [System.Text.Encoding]::UTF8",
      "StandardErrorEncoding = [System.Text.Encoding]::UTF8",
      "ReadToEndAsync()",
      "Stop-NativeProcessTree",
      "Set-NativeEnvironment",
      "Test-GhNotFound",
    ],
  ],
  [
    "scripts/lib/release-artifacts.ps1",
    [
      "Assert-ReceiptHash",
      "Read-BoundManifest",
      "Invoke-DownloadWithRetry",
      "Manifest signature does not match",
    ],
  ],
  [
    "scripts/lib/runtime-proof.ps1",
    [
      '("" + $payload.railVersion).Trim() -cne $ExpectedVersion',
      "Wait-LoopbackPortClosed",
      "CDP/debugging port",
    ],
  ],
  [
    "scripts/lib/release-transaction.ps1",
    [
      "receipt_schema",
      "installer_sha256",
      "signature_sha256",
      "manifest_sha256",
      "journal records",
      "real state is not compatible",
      "OWNER BOUNDARY",
      "return & $ScriptBlock @ArgumentList",
    ],
  ],
  [
    "scripts/lib/release-publish-adapter.ps1",
    [
      "Test-GhNotFound $result",
      "exact annotated tag object and receipt commit",
      "MissingDraftAssets",
      "downloaded draft signature verification",
      "Public tag-specific installer",
      "Public latest manifest",
      "--draft=false",
    ],
  ],
]);

export function scanReleasePowerShell({ overrides = {} } = {}) {
  const errors = [];
  const sources = new Map();
  const report = (file, rule, message) => errors.push({ file, rule, message });

  for (const file of releaseCriticalPowerShell) {
    const text = Object.hasOwn(overrides, file)
      ? overrides[file]
      : readFileSync(join(root, file), "utf8");
    const executable = stripFullLineComments(text);
    const liveExecutable = stripStaticallyDisabledBlocks(executable);
    sources.set(file, { text, executable, liveExecutable });

    if (entrypoints.has(file) && !text.includes('$ErrorActionPreference = "Stop"')) {
      report(file, "strict-error-policy", 'entrypoint must set $ErrorActionPreference = "Stop"');
    }
    if (/\$ErrorActionPreference\s*=\s*["'](?:Continue|SilentlyContinue|Ignore)["']/i.test(executable)) {
      report(file, "strict-error-policy", "release code weakens ErrorActionPreference");
    }
    if (/\bInvoke-Expression\b/i.test(executable)) {
      report(file, "no-eval", "Invoke-Expression is forbidden");
    }
    if (/(?:^|[^\d])2>\s*\$null\b/m.test(executable)) {
      report(file, "native-stderr", "2>$null cannot control a native-process result on PowerShell 5.1");
    }
    const dynamicAllowlist =
      file === "scripts/lib/release-transaction.ps1"
        ? ["return & $ScriptBlock @ArgumentList"]
        : [];
    let withoutApprovedDynamicCalls = liveExecutable;
    for (const approved of dynamicAllowlist) {
      withoutApprovedDynamicCalls = withoutApprovedDynamicCalls.replaceAll(approved, "");
    }
    if (/(?<![&|])&(?![&|])\s+/m.test(withoutApprovedDynamicCalls)) {
      report(file, "direct-native", "call-operator invocation is forbidden outside the typed ScriptBlock gateway");
    }
    if (
      /^\s*(?:gh|git|node|npm|npx|cargo|rustc|tauri|powershell|pwsh|cmd|curl|wget|where|signtool|wsl|bash|sh)(?:\.exe|\.cmd|\.bat|\.com)?\s+/im.test(
        liveExecutable,
      ) ||
      /^\s*[A-Za-z_][\w.-]*\.(?:exe|cmd|bat|com)\b/im.test(liveExecutable)
    ) {
      report(file, "direct-native", "bare native executable invocation is forbidden");
    }
    if (file !== "scripts/lib/native-process.ps1") {
      if (/\bStart-Process\b/i.test(executable)) {
        report(file, "process-bypass", "Start-Process bypasses the approved native-process abstraction");
      }
      if (/System\.Diagnostics\.ProcessStartInfo/i.test(executable)) {
        report(file, "process-bypass", "ProcessStartInfo is allowed only in native-process.ps1");
      }
      if (/System\.Diagnostics\.Process(?:\]\s*::|\.)Start\s*\(/i.test(executable)) {
        report(file, "process-bypass", "System.Diagnostics.Process.Start bypasses native-process.ps1");
      }
      if (
        /\bNew-Object\s+(?:System\.)?Diagnostics\.Process\b/i.test(executable) ||
        /\[(?:System\.)?Diagnostics\.Process\]\s*::\s*Start\s*\(/i.test(executable)
      ) {
        report(file, "process-bypass", "direct Diagnostics.Process construction/start bypasses native-process.ps1");
      }
      if (/\b-ArgumentString\b/i.test(executable)) {
        report(file, "shell-string", "shell-string command construction is forbidden outside the helper");
      }
      if (/\bshell\s*:\s*true\b/i.test(executable) || /\bcmd\.exe\b/i.test(executable)) {
        report(file, "shell-string", "shell reparsing is forbidden on the release surface");
      }
    }
  }

  for (const [file, tokens] of requiredTokens) {
    const source = sources.get(file)?.liveExecutable ?? "";
    for (const token of tokens) {
      if (!source.includes(token)) {
        report(file, "required-verification", `missing invariant token: ${token}`);
      }
    }
  }

  // The explicit list is an allowlist, not a blind spot. Any real .ps1 basename referenced from
  // executable release code must also be scanned, so a newly dot-sourced/signing helper cannot
  // silently escape the permanent guard.
  const declared = new Set(releaseCriticalPowerShell.map((file) => basename(file).toLowerCase()));
  const actualByBase = new Set(
    listPowerShell(join(root, "scripts")).map((path) => basename(path).toLowerCase()),
  );
  for (const [file, source] of sources) {
    for (const match of source.liveExecutable.matchAll(/["']([^"']+\.ps1)["']/gi)) {
      const referenced = basename(match[1].replaceAll("\\", "/")).toLowerCase();
      if (actualByBase.has(referenced) && !declared.has(referenced)) {
        report(file, "surface-discovery", `referenced PowerShell helper is not guarded: ${referenced}`);
      }
    }
  }

  const transaction = sources.get("scripts/lib/release-transaction.ps1")?.executable ?? "";
  const stageBlock = transaction.match(/\$script:ReleaseTransactionStages\s*=\s*@\(([\s\S]*?)\)/)?.[1] ?? "";
  const stages = [...stageBlock.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  const expectedStages = [
    "receipt_verified",
    "runtime_proved",
    "source_main_pushed",
    "source_tag_pushed",
    "releases_tag_created",
    "draft_created",
    "draft_assets_verified",
    "release_published",
    "public_assets_verified",
  ];
  if (JSON.stringify(stages) !== JSON.stringify(expectedStages)) {
    report(
      "scripts/lib/release-transaction.ps1",
      "transaction-order",
      `unsafe transaction stage order: ${stages.join(" -> ")}`,
    );
  }
  const release = sources.get("scripts/release.ps1")?.liveExecutable ?? "";
  const receiptValidator =
    release.match(/\$validateReceipt\s*=\s*\{([\s\S]*?)\n\s*\}\s*\n\s*\$assertPublicVersion\s*=/)?.[1] ?? "";
  for (const token of [
    'Assert-ReceiptHash "Installer"',
    'Assert-ReceiptHash "Updater signature"',
    'Assert-ReceiptHash "Updater manifest"',
    "Read-BoundManifest $context.Manifest",
    "publish-time updater signature verification",
    'Get-GitLine @("cat-file", "-t", $context.Receipt.tag)',
  ]) {
    const index = receiptValidator.indexOf(token);
    if (index < 0 || braceDepthAt(receiptValidator, index) !== 0) {
      report("scripts/release.ps1", "verification-structure", `receipt validator is missing: ${token}`);
    }
  }
  if (/\bfunction\s+[A-Za-z_]/i.test(receiptValidator)) {
    report(
      "scripts/release.ps1",
      "verification-structure",
      "receipt checks may not be hidden in a nested, never-called function",
    );
  }
  const adapter = sources.get("scripts/lib/release-publish-adapter.ps1")?.liveExecutable ?? "";
  if ((adapter.match(/--draft=false/g) ?? []).length !== 1) {
    report(
      "scripts/lib/release-publish-adapter.ps1",
      "publication-order",
      "exactly one public-release transition is permitted",
    );
  }
  if (!adapter.includes("Inspect-ProductionDraftAssets") || !adapter.includes("Inspect-ProductionPublished")) {
    report(
      "scripts/lib/release-publish-adapter.ps1",
      "publication-order",
      "draft assets must be inspected before publication",
    );
  }
  const publicationHandler =
    adapter.match(/release_published\s*=\s*@\{([\s\S]*?)public_assets_verified\s*=\s*@\{/)?.[1] ?? "";
  if (!publicationHandler.includes("--draft=false") || !publicationHandler.includes("$publicVersionGate")) {
    report(
      "scripts/lib/release-publish-adapter.ps1",
      "publication-order",
      "the sole public transition and final public-version check must be inside release_published",
    );
  }
  if (
    publicationHandler.indexOf("Invoke-ReleaseScriptBlock -ScriptBlock $publicVersionGate") < 0 ||
    publicationHandler.indexOf("--draft=false") <
      publicationHandler.indexOf("Invoke-ReleaseScriptBlock -ScriptBlock $publicVersionGate")
  ) {
    report(
      "scripts/lib/release-publish-adapter.ps1",
      "publication-order",
      "the final public-version gate must execute before the sole public transition",
    );
  }

  return { ok: errors.length === 0, errors, files: releaseCriticalPowerShell };
}

function main() {
  const result = scanReleasePowerShell();
  if (!result.ok) {
    for (const error of result.errors) {
      console.error(`${error.file}: ${error.rule}: ${error.message}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`release PowerShell static guard OK (${result.files.length} files)`);
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) main();
