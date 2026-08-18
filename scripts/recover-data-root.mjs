#!/usr/bin/env node
// DATA-ROOT RECOVERY — the one-time union merge for the split Trust Ledger (#130).
//
// WHY THIS EXISTS
//
//   Compy was launched at least once as a child of the MSIX-packaged Claude desktop app, which
//   inherits that package's filesystem overlay. `APPDATA` still READ correctly while resolution
//   landed in `…\AppData\Local\Packages\<family>\LocalCache\Roaming\`. The Trust Ledger split:
//   61 receipts of real, machine-affecting Windows changes went to the overlay, and a normally
//   launched Compy sees 3. Twelve of those changes are live on the machine right now with no
//   receipt the app can find — LOCKED rule 3 (never apply what you cannot roll back), inverted.
//
//   `src-tauri/src/data_root.rs` stops it happening again. This tool is the other half: it puts
//   the surviving receipts back where the app will look for them. Owner decision 2026-08-18,
//   option B on issue #130.
//
// THE ONE RULE THIS TOOL OBEYS: it never invents, reshapes, drops, dedupes or repairs a receipt.
//
//   Receipts are spliced as their EXACT source text, not re-serialized. Both ledgers are written by
//   `serde_json::to_string_pretty` (history.rs `save_history_to`), so every element already carries
//   the indentation it needs at array depth; lifting the raw substring out of one file and into
//   another is byte-preserving by construction. Re-serializing through `JSON.parse`/`stringify`
//   would risk silently rewriting a float (`1.0` -> `1`) or an integer past 2^53 inside a snapshot,
//   and a snapshot is the thing a rollback restores from. That is not a risk worth taking to save
//   twenty lines.
//
// WHAT IT REFUSES TO DO — each of these aborts with a nonzero exit and writes nothing:
//   - merge when any receipt id appears in BOTH ledgers (the union would be a guess)
//   - merge when either ledger repeats an id internally, or is not an array of objects
//   - merge when any receipt lacks a string `id` or a string `applied_at`
//   - roll back, re-apply, dedupe, "repair", or touch Windows in any way. It moves JSON. Nothing else.
//
// It is dry-run by default. `--apply` is required to write, and it takes byte-for-byte backups of
// BOTH ledgers first, verifies them by hash, and writes through a temp file + rename (the same
// crash-safe swap `save_history_to` uses).
//
// Tests: scripts/recover-data-root.test.mjs — the merge core is pure and every refusal above is
// falsified there over fixtures.

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, renameSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";

// ── The pure core ───────────────────────────────────────────────────────────────────────────────

/**
 * Split a pretty-printed JSON array into its top-level elements, keeping each element's EXACT
 * source text. Returns `{ raw, value }[]`. Throws if the text is not an array of objects.
 *
 * Hand-written rather than regex-based because a receipt's `rec_title` can legitimately contain
 * braces and quotes, and a regex that gets that wrong would corrupt a rollback contract silently.
 */
export function splitLedgerEntries(text) {
  const src = text.trim();
  if (!src.startsWith("[")) throw new Error("not a JSON array: the ledger must start with '['");
  if (!src.endsWith("]")) throw new Error("not a JSON array: the ledger must end with ']'");

  const out = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 1; i < src.length - 1; i++) {
    const c = src[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === "{" || c === "[") {
      if (depth === 0) {
        if (c !== "{") throw new Error("ledger elements must be objects");
        start = i;
      }
      depth++;
      continue;
    }
    if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) {
        const raw = src.slice(start, i + 1);
        out.push({ raw, value: JSON.parse(raw) });
        start = -1;
      }
      continue;
    }
    if (depth === 0 && !/[\s,]/.test(c)) {
      throw new Error(`unexpected character '${c}' between ledger elements`);
    }
  }
  if (depth !== 0 || inString) throw new Error("ledger text ends inside an element");
  return out;
}

function idsOf(entries, label) {
  const ids = [];
  for (const [i, e] of entries.entries()) {
    const { id, applied_at: appliedAt } = e.value;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`${label}[${i}] has no string \`id\` — refusing to merge receipts I cannot tell apart`);
    }
    if (typeof appliedAt !== "string" || appliedAt.length === 0) {
      throw new Error(`${label}[${i}] (${id}) has no string \`applied_at\` — refusing to order receipts by guesswork`);
    }
    ids.push(id);
  }
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`${label} repeats receipt id ${id} — that ledger is already inconsistent; stopping`);
    seen.add(id);
  }
  return ids;
}

/**
 * The union. Order is `applied_at` ascending, ties broken by source order (foreign first, since it
 * is wholly older) so the result is deterministic and re-running produces an identical file.
 */
export function planMerge(canonicalText, foreignText) {
  const canonical = splitLedgerEntries(canonicalText);
  const foreign = splitLedgerEntries(foreignText);

  const canonicalIds = idsOf(canonical, "canonical ledger");
  const foreignIds = idsOf(foreign, "redirected ledger");

  const overlap = canonicalIds.filter((id) => foreignIds.includes(id));
  if (overlap.length) {
    throw new Error(
      `${overlap.length} receipt id(s) appear in BOTH ledgers (${overlap.slice(0, 5).join(", ")}). ` +
        "A union would have to pick a winner, and picking is the failure this whole lane exists to " +
        "prevent. Nothing written.",
    );
  }

  const tagged = [
    ...foreign.map((e, i) => ({ ...e, order: i })),
    ...canonical.map((e, i) => ({ ...e, order: foreign.length + i })),
  ];
  tagged.sort((a, b) => {
    if (a.value.applied_at < b.value.applied_at) return -1;
    if (a.value.applied_at > b.value.applied_at) return 1;
    return a.order - b.order;
  });

  // `to_string_pretty` renders an empty vec as `[]`; match it so a re-read is never surprised.
  const text = tagged.length
    ? `[\n${tagged.map((e) => "  " + e.raw).join(",\n")}\n]`
    : "[]";

  // Every receipt must survive the splice unchanged, and the count must be exact. Cheap to check,
  // and the only assertion that actually matters here.
  const reparsed = JSON.parse(text);
  if (reparsed.length !== canonical.length + foreign.length) {
    throw new Error("internal: merged ledger lost or gained a receipt");
  }
  const sources = new Map([...canonical, ...foreign].map((e) => [e.value.id, JSON.stringify(e.value)]));
  for (const entry of reparsed) {
    if (JSON.stringify(entry) !== sources.get(entry.id)) {
      throw new Error(`internal: receipt ${entry.id} changed during the merge`);
    }
  }

  const count = (entries, status) => entries.filter((e) => e.value.status === status).length;
  return {
    text,
    stats: {
      canonical: canonical.length,
      foreign: foreign.length,
      merged: reparsed.length,
      applied: count(tagged, "applied"),
      rolledBack: count(tagged, "rolled_back"),
      firstAt: tagged[0]?.value.applied_at,
      lastAt: tagged[tagged.length - 1]?.value.applied_at,
    },
  };
}

// ── IO wrapper ──────────────────────────────────────────────────────────────────────────────────

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex").toUpperCase();

function backup(src, dir, name) {
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, name);
  copyFileSync(src, dest);
  const a = sha256(readFileSync(src));
  const b = sha256(readFileSync(dest));
  if (a !== b) throw new Error(`backup of ${src} does not match the original — stopping before any write`);
  return { dest, sha256: a };
}

function main(argv) {
  const arg = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i === -1 ? fallback : argv[i + 1];
  };
  const apply = argv.includes("--apply");
  const canonicalPath = arg("--canonical");
  const foreignPath = arg("--foreign");
  const archiveDir = arg("--archive");

  if (!canonicalPath || !foreignPath || !archiveDir) {
    console.error("usage: recover-data-root.mjs --canonical <path> --foreign <path> --archive <dir> [--apply]");
    process.exit(2);
  }
  for (const p of [canonicalPath, foreignPath]) {
    if (!existsSync(p)) throw new Error(`missing ledger: ${p}`);
  }

  const canonicalText = readFileSync(canonicalPath, "utf8");
  const foreignText = readFileSync(foreignPath, "utf8");
  const { text, stats } = planMerge(canonicalText, foreignText);

  console.log("canonical  ", canonicalPath, `\n             ${stats.canonical} receipts, sha256 ${sha256(readFileSync(canonicalPath))}`);
  console.log("redirected ", foreignPath, `\n             ${stats.foreign} receipts, sha256 ${sha256(readFileSync(foreignPath))}`);
  console.log(
    `merged      ${stats.merged} receipts (${stats.applied} applied, ${stats.rolledBack} rolled back), ` +
      `${stats.firstAt} -> ${stats.lastAt}`,
  );

  if (!apply) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to perform the merge.");
    return;
  }

  const backups = {
    canonical: backup(canonicalPath, archiveDir, "history.canonical.pre-merge.json"),
    foreign: backup(foreignPath, archiveDir, "history.redirected.pre-merge.json"),
  };
  console.log(`\nbackup      ${backups.canonical.dest}  sha256 ${backups.canonical.sha256}`);
  console.log(`backup      ${backups.foreign.dest}  sha256 ${backups.foreign.sha256}`);

  // Same crash-safe swap the app uses: write beside, then rename over.
  const tmp = canonicalPath + ".tmp";
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, canonicalPath);

  const after = splitLedgerEntries(readFileSync(canonicalPath, "utf8"));
  if (after.length !== stats.merged) throw new Error("post-write verification failed — restore from the backup above");
  console.log(`\nWROTE       ${canonicalPath}  ${after.length} receipts, sha256 ${sha256(readFileSync(canonicalPath))}`);
  console.log("The redirected ledger was NOT touched. Archive it as a separate, deliberate step.");
}

if (process.argv[1] && process.argv[1].endsWith("recover-data-root.mjs")) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error("\nREFUSED:", err.message);
    process.exit(1);
  }
}
