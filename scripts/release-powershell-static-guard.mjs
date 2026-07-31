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

const functionBody = (text, name) => {
  const start = text.search(new RegExp(String.raw`function\s+${name}\b`, "i"));
  if (start < 0) return null;
  const open = text.indexOf("{", start);
  if (open < 0) return null;
  let depth = 0;
  let quote = "";
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote && text[index - 1] !== "`") quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, index);
    }
  }
  return null;
};

const matchingParen = (text, open) => {
  let depth = 0;
  let quote = "";
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote && text[index - 1] !== "`") quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
};

// PowerShell 5.1 hands a parsed JSON array back as ONE Object[], so @(<pipeline> | ConvertFrom-Json)
// collects a single nested element instead of unrolling it, and every later property read silently
// member-enumerates instead of failing. Only the TAIL of an array subexpression is dangerous: a
// ConvertFrom-Json nested inside a ForEach-Object block still emits one parsed object per iteration.
const nestedJsonArrayParses = (text) => {
  const hits = [];
  for (const match of text.matchAll(/@\(/g)) {
    const open = match.index + 1;
    const close = matchingParen(text, open);
    if (close < 0) continue;
    const inner = text.slice(open + 1, close);
    let depth = 0;
    let quote = "";
    let tail = -1;
    for (let index = 0; index < inner.length; index += 1) {
      const char = inner[index];
      if (quote) {
        if (char === quote && inner[index - 1] !== "`") quote = "";
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === "(" || char === "{" || char === "[") {
        depth += 1;
      } else if (char === ")" || char === "}" || char === "]") {
        depth -= 1;
      } else if (char === "|" && depth === 0) {
        tail = index + 1;
      }
    }
    if (tail >= 0 && /^\s*ConvertFrom-Json\b/i.test(inner.slice(tail))) hits.push(match.index);
  }
  return hits;
};

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
      "$releaseList = @($parsedReleaseList)",
      "Unexpected release entry shape.",
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
      "$script:ReleaseNoCacheHeaders",
      "Add-ReleaseCacheBustingQuery",
      "Test-ReleasePropagationAbsence",
      "Compare-ReleaseVersion",
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
      '/releases?per_page=$PageSize&page=$Page',
      "Get-ProductionReleaseList -Context $Context",
      "incompletely paginated listing",
      "Refusing to act on an ambiguous release.",
      "MissingDraftAssets",
      "downloaded draft signature verification",
      "Public tag-specific installer",
      "Public latest manifest",
      "Public latest installer",
      "public updater signature verification",
      "Assert-ProductionLatestReleaseIdentity",
      "Wait-ProductionLatestAliasConvergence",
      "Assert-AliasPropagationLag",
      "--draft=false",
    ],
  ],
  [
    // Hosted CI is off, so this local runner is the only release proof. Each token below is a
    // check the gate would otherwise be able to lose silently: delete the line, the suite still
    // goes green, and the run reports a pass it did not earn.
    "scripts/verify-release.ps1",
    [
      '[ValidateSet("PASS", "FAIL", "BLOCKED", "PENDING")]',
      "Add-GateResult",
      '"git diff check"',
      "scripts/encoding-guard.mjs",
      "scripts/release-powershell-static-guard.mjs",
      "scripts/verify-release-state.mjs",
      "scripts/doc-budget.ps1",
      "scripts/supply-chain-gate.mjs",
      '$supplyChainChecks = @("npm audit", "Cargo audit", "dependency inventory")',
      "scripts/verify-updater-signature.mjs",
      '"updater signature verification"',
      '"TypeScript"',
      '"Vitest suite (frontend, hooks, entrypoint, release-pipeline guards)"',
      '"frontend production build"',
      '"Rust tests"',
      '"Rust clippy"',
      "verify-release-evidence.json",
      "exit 3",
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
    for (const index of nestedJsonArrayParses(liveExecutable)) {
      const snippet = liveExecutable.slice(index, index + 72).replace(/\s+/g, " ").trim();
      report(
        file,
        "json-array-parse",
        `array-wrapped ConvertFrom-Json nests a JSON array on PowerShell 5.1; assign the parse first, then wrap: ${snippet}`,
      );
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

  // GitHub answers 404 from `GET /repos/{repo}/releases/tags/{tag}` for a DRAFT release that
  // demonstrably exists, so a draft-sensitive stage resolved by tag reads "absent" for its own work
  // (the v0.9.11 failure). The authenticated, paginated list is the only draft-aware lookup, and this
  // rule is what stops any release-critical file from quietly regressing to the tag endpoint.
  for (const [file, source] of sources) {
    if (/releases\/tags\//i.test(source.liveExecutable)) {
      report(
        file,
        "draft-lookup",
        "the releases-by-tag endpoint is 404 for drafts and may not be used as a release lookup",
      );
    }
  }
  for (const stageFunction of [
    "Inspect-ProductionDraft",
    "Inspect-ProductionDraftAssets",
    "Inspect-ProductionPublished",
    "Inspect-ProductionPublicAssets",
  ]) {
    const body = functionBody(adapter, stageFunction);
    if (body === null) {
      report("scripts/lib/release-publish-adapter.ps1", "draft-lookup", `missing stage handler: ${stageFunction}`);
      continue;
    }
    if (!body.includes("Get-ProductionRelease $Context") && !body.includes("Get-ProductionRelease -Context $Context")) {
      report(
        "scripts/lib/release-publish-adapter.ps1",
        "draft-lookup",
        `${stageFunction} must resolve its release through the draft-aware Get-ProductionRelease lookup`,
      );
    }
  }
  const releaseLookup = functionBody(adapter, "Get-ProductionRelease");
  if (releaseLookup === null || !releaseLookup.includes("Get-ProductionReleaseList -Context $Context")) {
    report(
      "scripts/lib/release-publish-adapter.ps1",
      "draft-lookup",
      "Get-ProductionRelease must resolve through the paginated releases listing",
    );
  } else if (!/tag_name\s+-ceq\s+\$tag/.test(releaseLookup)) {
    report(
      "scripts/lib/release-publish-adapter.ps1",
      "draft-lookup",
      "Get-ProductionRelease must filter the listing by exact tag_name",
    );
  }
  const listPage = functionBody(adapter, "Get-ProductionReleasePage");
  if (listPage === null || !/\$result\.TimedOut/.test(listPage) || !/\$result\.ExitCode\s+-ne\s+0/.test(listPage)) {
    report(
      "scripts/lib/release-publish-adapter.ps1",
      "draft-lookup",
      "the releases listing must treat timeout and nonzero exit as fatal, never as absence",
    );
  }

  // GitHub's /releases/latest/download/ redirector is eventually consistent and served the PREVIOUS
  // release for a window after v0.9.11 went public, which failed the final stage against a release
  // that was in fact correct. The repair is a bounded poll, and this rule is what stops it from ever
  // collapsing back into a single immediate assertion (or into a poll that hides a real mismatch).
  const publicAssets = functionBody(adapter, "Inspect-ProductionPublicAssets");
  const aliasWait = functionBody(adapter, "Wait-ProductionLatestAliasConvergence");
  const aliasLag = functionBody(adapter, "Assert-AliasPropagationLag");
  const latestIdentity = functionBody(adapter, "Assert-ProductionLatestReleaseIdentity");
  const download = functionBody(adapter, "Invoke-ProductionDownload");
  const absence = functionBody(sources.get("scripts/lib/release-artifacts.ps1")?.liveExecutable ?? "", "Test-ReleasePropagationAbsence");
  if (publicAssets === null || aliasWait === null || aliasLag === null || latestIdentity === null || download === null || absence === null) {
    report(
      "scripts/lib/release-publish-adapter.ps1",
      "alias-propagation",
      "the latest-alias convergence handlers must exist: Inspect-ProductionPublicAssets, Wait-ProductionLatestAliasConvergence, Assert-AliasPropagationLag, Assert-ProductionLatestReleaseIdentity, Invoke-ProductionDownload, Test-ReleasePropagationAbsence",
    );
  } else {
    // Only the alias may be polled. The tag-specific assets, the updater signature and the
    // latest-release identity are consistent the instant a release is published, so each is proved
    // once, up front, and a failure there is never retried into a pass.
    const order = [
      'Assert-ReceiptHash "Public tag-specific installer"',
      'Assert-ReceiptHash "Public tag-specific manifest"',
      '"public updater signature verification"',
      "Assert-ProductionLatestReleaseIdentity",
      "Wait-ProductionLatestAliasConvergence",
    ];
    let previous = -1;
    for (const token of order) {
      const index = publicAssets.indexOf(token);
      if (index < 0) {
        report(
          "scripts/lib/release-publish-adapter.ps1",
          "alias-propagation",
          `Inspect-ProductionPublicAssets is missing a required step: ${token}`,
        );
        previous = Number.MAX_SAFE_INTEGER;
        continue;
      }
      if (index < previous) {
        report(
          "scripts/lib/release-publish-adapter.ps1",
          "alias-propagation",
          `Inspect-ProductionPublicAssets runs its steps out of order at: ${token}`,
        );
      }
      previous = index;
    }
    if (/Assert-ReceiptHash\s+"Public latest/.test(publicAssets)) {
      report(
        "scripts/lib/release-publish-adapter.ps1",
        "alias-propagation",
        "the eventually-consistent latest alias may not be asserted outside the bounded convergence poll",
      );
    }
    // A poll with no deadline is a hang, and a poll that accepts one of the two names is a fleet that
    // half-updates: both aliases are proved on the accepted attempt or the stage does not complete.
    for (const [pattern, message] of [
      [/\$deadlineSeconds\s*=\s*\d+/, "the convergence poll must carry an explicit overall deadline"],
      [/\$backoff\s*=\s*@\(\s*\d+\s*,/, "the convergence poll must use a stepped or exponential backoff"],
      [/did not converge/, "expiring the convergence deadline must fail the stage"],
      [/Assert-ReceiptHash "Public latest installer"/, "the accepted attempt must verify the aliased installer"],
      [/Assert-ReceiptHash "Public latest manifest"/, "the accepted attempt must verify the aliased manifest"],
      [/Read-BoundManifest/, "the accepted attempt must re-prove the aliased manifest binding"],
      [/Assert-AliasPropagationLag/, "a non-matching alias body must be classified before it is retried"],
      [/alias-attempt-/, "each attempt must download into its own directory so no stale file is reused"],
      [/\[guid\]::NewGuid\(\)/, "each attempt must issue a fresh cache-busting token"],
    ]) {
      if (!pattern.test(aliasWait)) {
        report("scripts/lib/release-publish-adapter.ps1", "alias-propagation", message);
      }
    }
    // Lag means strictly older, well-formed and bound to this repository. Anything else is an
    // unrelated payload and must fail immediately rather than be waited out.
    if (!/Compare-ReleaseVersion/.test(aliasLag) || !/-ge 0/.test(aliasLag)) {
      report(
        "scripts/lib/release-publish-adapter.ps1",
        "alias-propagation",
        "only a strictly older release version may be accepted as propagation lag",
      );
    }
    if (!/tag_name.*-cne/.test(latestIdentity) || !/prerelease/.test(latestIdentity) || !/draft/.test(latestIdentity)) {
      report(
        "scripts/lib/release-publish-adapter.ps1",
        "alias-propagation",
        "the latest-release identity check must pin tag, draft and prerelease state",
      );
    }
    if (!/Remove-Item -LiteralPath \$OutFile -Force/.test(download)) {
      report(
        "scripts/lib/release-publish-adapter.ps1",
        "alias-propagation",
        "a retried download must delete any file a previous attempt left behind",
      );
    }
    if (!/-eq 404/.test(absence)) {
      report(
        "scripts/lib/release-artifacts.ps1",
        "alias-propagation",
        "only an HTTP 404 may be classified as unpublished-yet; every other failure is real",
      );
    }
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
