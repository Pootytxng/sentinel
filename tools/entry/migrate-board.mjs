// Migrate Work Control's `Worktree / branch` field to the canonical grammar (spec §5.1).
//
// Dry-run by default: prints a per-item `before → after` diff and writes nothing. `--apply` writes.
// Ambiguous items are LISTED for Kuya, never resolved by the tool — collision rule 4 says unknown
// means locked, and a migration that guesses would hand the guards a confident wrong answer.
//
// planMigration() is pure so the whole classification is testable against the real board without
// touching it; only main() talks to `gh`.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { normalizeWorktreeField } from "./worktree-field.mjs";

export const PROJECT_NUMBER = 1;
export const PROJECT_OWNER = "Pootytxng";
export const FIELD_NAME = "Worktree / branch";
export const DEFAULT_CODE_ROOT = "C:\\Users\\Kuya\\code";

/**
 * Classify every board row as change / same / refuse.
 * @param {Array<{number: number, value: string, itemId?: string}>} rows
 * @returns {Array<{number, itemId, before, after, action, code, reason, notes, entries}>}
 */
export function planMigration(rows, { codeRoot = DEFAULT_CODE_ROOT } = {}) {
  return (rows ?? []).map((row) => {
    const before = row.value ?? "";
    const base = { number: row.number, itemId: row.itemId ?? null, before };
    const norm = normalizeWorktreeField(before, { codeRoot });
    if (!norm.ok) {
      return { ...base, after: null, action: "refuse", code: norm.code, reason: norm.reason, notes: [], entries: [] };
    }
    return {
      ...base,
      after: norm.value,
      action: norm.changed ? "change" : "same",
      code: null,
      reason: null,
      notes: norm.notes,
      entries: norm.entries,
    };
  });
}

/** Human-readable dry-run report. Returns lines rather than printing, so it is testable too. */
export function renderPlan(plan) {
  const lines = [];
  for (const row of plan) {
    if (row.action === "same") lines.push(`  = #${row.number}  ${row.before}`);
    else if (row.action === "change") {
      lines.push(`  ~ #${row.number}  ${row.before}`);
      lines.push(`         -> ${row.after}${row.notes.length ? `   [note: ${row.notes.join("; ")}]` : ""}`);
    } else lines.push(`  ! #${row.number}  ${row.before}\n         REFUSED (${row.code}): ${row.reason}`);
  }
  const counts = { change: 0, same: 0, refuse: 0 };
  for (const r of plan) counts[r.action] += 1;
  lines.push(
    `\n  ${counts.change} to rewrite · ${counts.same} already canonical · ${counts.refuse} refused (Kuya decides)`,
  );
  return lines;
}

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

export function readBoard() {
  const raw = gh(["project", "item-list", String(PROJECT_NUMBER), "--owner", PROJECT_OWNER, "--format", "json", "--limit", "100"]);
  return JSON.parse(raw).items.map((it) => ({
    number: it.content?.number,
    itemId: it.id,
    value: it[FIELD_NAME.toLowerCase()] ?? "",
  }));
}

function main(argv) {
  const apply = argv.includes("--apply");
  const plan = planMigration(readBoard());
  console.log(`\n${FIELD_NAME} migration — ${apply ? "APPLY" : "dry run, nothing will be written"}\n`);
  for (const line of renderPlan(plan)) console.log(line);

  if (!apply) {
    console.log("\n  Re-run with --apply to write the rewrites. Refused items stay untouched.\n");
    return 0;
  }

  const projectId = JSON.parse(gh(["project", "view", String(PROJECT_NUMBER), "--owner", PROJECT_OWNER, "--format", "json"])).id;
  const fields = JSON.parse(gh(["project", "field-list", String(PROJECT_NUMBER), "--owner", PROJECT_OWNER, "--format", "json"])).fields;
  const fieldId = fields.find((f) => f.name === FIELD_NAME)?.id;
  if (!fieldId) throw new Error(`Field "${FIELD_NAME}" not found on project ${PROJECT_NUMBER}`);

  for (const row of plan.filter((r) => r.action === "change")) {
    gh(["project", "item-edit", "--project-id", projectId, "--id", row.itemId, "--field-id", fieldId, "--text", row.after]);
    console.log(`  wrote #${row.number}`);
  }
  console.log("\n  Refused items were NOT written — they need a human decision.\n");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
