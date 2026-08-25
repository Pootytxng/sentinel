#!/usr/bin/env node
// Durable release receipt — issue #199 item 3.
//
// THE DEFECT THIS ANSWERS. `docs/RELEASE_STATE.md` cited release-transaction journals as the
// re-verification evidence for its "transaction complete, 9 of 9" claims. Those journals are
// written to `src-tauri/target/release/bundle/nsis/`, which `src-tauri/.gitignore:3` ignores by
// construction. No journal has ever been committed; the directory has since been cleaned. So the
// stage-completion claim for every past release rests on prose alone — GitHub independently proves
// publication, assets, hashes and release identity, but nine INTERNAL pipeline stages cannot be
// reconstructed from GitHub by anyone, ever.
//
// #199 is explicit that the historical record is what it is: **do not fabricate or regenerate
// journals for past releases.** This script changes only the future. After a transaction completes,
// it derives a small, sanitized, DURABLE receipt from the journal plus the signed staged receipt
// and writes it under `docs/release-receipts/`, which is tracked. The operator commits it in a
// follow-up commit; from then on the stage claim has evidence that outlives `target/`.
//
// WHY NOT JUST COMMIT THE JOURNAL. Two reasons, and the first is sufficient. (1) The journal's
// `evidence` map is whatever each stage's inspector returned — local paths, bundle directories, and
// whatever a future adapter adds. Committing it publishes machine detail nobody audited. (2) It is
// large and it is a build artifact; `target/` is gitignored for good reasons that this issue does
// not overturn. The receipt instead carries an ALLOWLIST of fields plus a SHA-256 of the journal
// bytes, so the summary is bound to one exact journal without republishing its contents.
//
// SANITIZED IS ENFORCED, NOT PROMISED. `scrubViolations` re-reads the finished object and refuses
// to write if any string in it looks like a filesystem path, a UNC share, an environment
// expansion, a `file://` URL, this machine's user name, or this machine's hostname. That mirrors
// how `src-tauri/src/receipts.rs` treats anonymity — by schema and an adversarial check, never by
// the author remembering.
//
// Usage:
//   node scripts/emit-release-receipt.mjs --journal <path> --receipt <path> [--out-dir <dir>]
//                                         [--emitted-at <iso8601>]
//
// Exit 0 and print the written path, or exit 1 with the reason on stderr. The caller
// (`scripts/release.ps1`) treats a failure here as a LOUD WARNING and not as a release failure:
// the publication has already happened at that point, and throwing would misreport a release that
// actually succeeded.

import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { hostname, userInfo } from "node:os";
import { join } from "node:path";

/** The nine stages the engine defines (scripts/lib/release-transaction.ps1:7-17), in order. */
export const EXPECTED_STAGES = [
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

const SHA256 = /^[0-9a-f]{64}$/i;
const COMMIT = /^[0-9a-f]{40}$/i;
const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * Strings that must never reach a tracked file. Deliberately broad — a false positive costs one
 * warning line on a release that already succeeded; a false negative commits machine detail
 * permanently to a public repository.
 */
export function scrubViolations(value, { user = userInfo().username, host = hostname() } = {}) {
  const rules = [
    [/[A-Za-z]:[\\/]/, "a drive-letter path"],
    [/\\\\[^\\]/, "a UNC share path"],
    [/(^|[\\/])(Users|home)[\\/]/i, "a user-home path"],
    [/%[A-Za-z_][A-Za-z0-9_]*%/, "an environment-variable expansion"],
    [/file:\/\//i, "a file:// URL"],
  ];
  // The machine's own names are checked separately: they are runtime values, and an empty or
  // one-character value (a CI container, a stripped environment) would match everything.
  if (user && user.length > 2) rules.push([new RegExp(escapeRe(user), "i"), "this machine's user name"]);
  if (host && host.length > 2) rules.push([new RegExp(escapeRe(host), "i"), "this machine's hostname"]);

  const out = [];
  const walk = (node, path) => {
    if (typeof node === "string") {
      for (const [re, what] of rules) {
        if (re.test(node)) out.push({ path, what, value: node });
      }
    } else if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(value, "");
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The one numeric release id, dug out of whatever the adapter's inspectors happened to record.
 * Read from an allowlist of key names and accepted only as digits — an adapter that starts
 * returning a URL or an object under `release_id` yields null here rather than leaking a field
 * nobody reviewed.
 */
export function findReleaseId(evidence) {
  if (!evidence || typeof evidence !== "object") return null;
  const keys = ["release_id", "releaseId", "id"];
  for (const stage of Object.values(evidence)) {
    if (!stage || typeof stage !== "object") continue;
    for (const key of keys) {
      const raw = stage[key];
      if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) return String(raw);
      if (typeof raw === "string" && /^\d+$/.test(raw)) return raw;
    }
  }
  return null;
}

/**
 * Build the durable receipt. Pure — the guard test drives it directly with synthetic inputs, which
 * is the only way to falsify a script that otherwise runs once per release.
 *
 * Throws on any inconsistency between the journal and the signed staged receipt. A receipt that
 * summarized a journal it does not actually match would be worse than no receipt at all.
 */
export function buildDurableReceipt({ journal, receipt, journalSha256, emittedAt }) {
  if (!journal || journal.schema_version !== 1) {
    throw new Error(`Unsupported transaction journal schema: ${journal?.schema_version}`);
  }
  const binding = journal.binding;
  if (!binding) throw new Error("Transaction journal carries no binding.");
  if (receipt?.schema_version !== 3) {
    throw new Error(`Unsupported staged receipt schema: ${receipt?.schema_version}`);
  }

  // The journal binds itself to the receipt at creation (Get-ReleaseTransactionBinding,
  // scripts/lib/release-transaction.ps1:55-90). Re-check here rather than trusting it: this file
  // is read back long after both processes are gone.
  const mismatches = [];
  const check = (name, a, b) => {
    if (String(a).toLowerCase() !== String(b).toLowerCase()) mismatches.push(`${name} (${a} vs ${b})`);
  };
  check("version", binding.version, receipt.version);
  check("commit", binding.release_commit, receipt.commit);
  check("tag", binding.source_tag, receipt.tag);
  check("installer.sha256", binding.installer_sha256, receipt.installer?.sha256);
  check("signature.sha256", binding.signature_sha256, receipt.signature?.sha256);
  check("manifest.sha256", binding.manifest_sha256, receipt.manifest?.sha256);
  if (mismatches.length) {
    throw new Error(`Journal and staged receipt disagree: ${mismatches.join("; ")}`);
  }

  const stages = Array.isArray(journal.completed_stages) ? journal.completed_stages : [];
  const missing = EXPECTED_STAGES.filter((s) => !stages.includes(s));
  if (missing.length) {
    // A durable receipt exists only for a COMPLETED transaction. Emitting one for a partial run is
    // exactly the unverifiable stage claim #199 is about, just with a new filename.
    throw new Error(`Transaction is not complete — missing stages: ${missing.join(", ")}`);
  }

  const version = String(binding.version);
  if (!SEMVER.test(version)) throw new Error(`Malformed version: ${version}`);
  const commit = String(binding.release_commit).toLowerCase();
  if (!COMMIT.test(commit)) throw new Error(`Malformed source commit: ${commit}`);
  for (const [name, hash] of [
    ["installer", binding.installer_sha256],
    ["signature", binding.signature_sha256],
    ["manifest", binding.manifest_sha256],
    ["journal", journalSha256],
  ]) {
    if (!SHA256.test(String(hash))) throw new Error(`Malformed ${name} SHA-256: ${hash}`);
  }

  // Installer NAME only — never its path. The name is a public fact (it is the asset filename on
  // the GitHub release); the path names a directory on one machine.
  const installerName = String(receipt.installer?.path ?? "").split(/[\\/]/).pop() ?? "";
  if (!installerName) throw new Error("Staged receipt carries no installer filename.");

  const durable = {
    schema_version: 1,
    kind: "release-transaction-receipt",
    // Says out loud what this file is and is not, for whoever finds it without the issue open.
    note:
      "Sanitized durable summary of one completed release transaction (issue #199 item 3). " +
      "The full journal is a build artifact under a gitignored path and is not preserved; " +
      "journal_sha256 binds this summary to those exact bytes.",
    version,
    tag: String(binding.source_tag),
    source_commit: commit,
    release_id: findReleaseId(journal.evidence),
    installer: { name: installerName, sha256: String(binding.installer_sha256).toLowerCase() },
    signature_sha256: String(binding.signature_sha256).toLowerCase(),
    manifest_sha256: String(binding.manifest_sha256).toLowerCase(),
    transaction: {
      completed: true,
      stages_completed: EXPECTED_STAGES.length,
      stages_expected: EXPECTED_STAGES.length,
      stages: EXPECTED_STAGES.slice(),
    },
    journal_sha256: String(journalSha256).toLowerCase(),
    emitted_at: emittedAt,
  };

  const leaks = scrubViolations(durable);
  if (leaks.length) {
    throw new Error(
      `Refusing to write — sanitization failed: ${leaks
        .map((l) => `${l.path} contains ${l.what}`)
        .join("; ")}`,
    );
  }
  return durable;
}

/** `docs/release-receipts/v0.9.26.json` — one file per published tag, named by the tag. */
export const receiptPathFor = (outDir, tag) => join(outDir, `${tag}.json`);

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const journalPath = arg("journal");
  const receiptPath = arg("receipt");
  const outDir = arg("out-dir") ?? join("docs", "release-receipts");
  const emittedAt = arg("emitted-at") ?? new Date().toISOString();
  if (!journalPath || !receiptPath) {
    throw new Error("usage: emit-release-receipt.mjs --journal <path> --receipt <path> [--out-dir <dir>]");
  }

  const journalBytes = readFileSync(journalPath);
  const journalSha256 = createHash("sha256").update(journalBytes).digest("hex");
  const journal = JSON.parse(journalBytes.toString("utf8"));
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));

  const durable = buildDurableReceipt({ journal, receipt, journalSha256, emittedAt });
  mkdirSync(outDir, { recursive: true });
  const out = receiptPathFor(outDir, durable.tag);
  writeFileSync(out, `${JSON.stringify(durable, null, 2)}\n`, "utf8");
  return out;
}

// Guarded so the guard test can import the pure functions without running the CLI.
if (process.argv[1] && process.argv[1].endsWith("emit-release-receipt.mjs")) {
  try {
    console.log(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`emit-release-receipt: ${e.message}`);
    process.exit(1);
  }
}
