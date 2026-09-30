import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { buildLogbook, type LogbookChange } from "./surfaces/blackbook/logbook";
import type { AppliedChange } from "./types";

// HISTORY STILL-ACTIVE SOURCE GUARD (#625, found by the #453 four-screen proof).
//
// WHY THIS EXISTS: History marked a change "still on" from `AppliedChange.is_still_active`, the
// legacy bool. That bool stays TRUE when the live re-check could not read the machine
// ("unreadable") or has no check for that kind of change ("unrecognised") — on purpose, so a
// rollback is never hidden (history.rs `ActiveCheck::legacy_active`). Printed as "still on", it
// claims a state nobody measured: on the owner's machine History said "15 still on" while Health
// and Diagnostics said 10 active and 6 that Compy can't confirm.
//
// Health reads the Machine Model's per-change `still_active` Fact. History cannot read that list
// row for row — it is capped (MAX_CHANGES in machine_model.rs) and History tapes the whole ledger —
// so History reads the field the Fact is built FROM, `active_check`, and this guard pins three
// things: History's source never reads the legacy bool, its mapping matches the Rust one arm for
// arm, and a change whose state is unknown never lands in the "still on" state.

// ── Corpus: every non-test source of the History room ──────────────────────────────────────────

const BLACKBOOK = join("src", "surfaces", "blackbook");

function collect(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const rel = join(dir, name);
    if (statSync(rel).isDirectory()) out.push(...collect(rel));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(rel);
    }
  }
  return out.sort();
}

const files = [...collect(BLACKBOOK), join("src", "surfaces", "BlackbookV2.tsx")];

// Comments legitimately NAME the legacy bool while explaining why it is not read.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(?<!:)\/\/[^\n]*/g, " ");
}

export function readsLegacyBool(source: string): boolean {
  return /\bis_still_active\b/.test(stripComments(source));
}

// ── The Rust mapping, and the History state each arm must produce ──────────────────────────────

const RUST = readFileSync(join("src-tauri", "src", "machine_model.rs"), "utf8");

/** The `still_active: match c.active_check { … }` block that builds the Fact Health reads. */
function stillActiveBlock(rs: string): string {
  const start = rs.indexOf("still_active: match c.active_check {");
  if (start < 0) return "";
  let depth = 0;
  for (let i = rs.indexOf("{", start); i < rs.length; i++) {
    if (rs[i] === "{") depth++;
    else if (rs[i] === "}" && --depth === 0) return rs.slice(start, i + 1);
  }
  return "";
}

type HistoryState = "still on" | "can't confirm" | "not on";

// One table drives both sides: the Rust arm that must exist, and the state History must give an
// applied change carrying that `active_check`. Every row sets the legacy bool to TRUE — the value
// that caused the defect — so a mapping that reads it instead puts "still on" everywhere.
const ARMS: { check: AppliedChange["active_check"]; rust: RegExp; history: HistoryState }[] = [
  { check: "on", rust: /Some\(ActiveCheck::On\)\s*=>\s*Fact::live\(true\b/, history: "still on" },
  { check: "off", rust: /Some\(ActiveCheck::Off\)\s*=>\s*Fact::live\(false\b/, history: "not on" },
  { check: "unreadable", rust: /Some\(ActiveCheck::Unreadable\)\s*=>\s*Fact::unknown\(/, history: "can't confirm" },
  { check: "unrecognised", rust: /Some\(ActiveCheck::Unrecognised\)\s*=>\s*Fact::unknown\(/, history: "can't confirm" },
  { check: null, rust: /\bNone\s*=>\s*Fact::not_applicable\(/, history: "not on" },
];

const applied = (over: Partial<AppliedChange> = {}): AppliedChange => ({
  id: "c1",
  rec_id: "startup-entry:AF_counter",
  rec_title: "Disable startup entry: AF_counter",
  applied_at: "2026-09-29T10:00:00Z",
  snapshot: {},
  status: "applied",
  is_still_active: true,
  ...over,
});

function stateOf(r: LogbookChange): HistoryState {
  if (r.active && r.unconfirmed) throw new Error("a row cannot be both confirmed on and unconfirmed");
  return r.active ? "still on" : r.unconfirmed ? "can't confirm" : "not on";
}

const onlyChange = (c: AppliedChange): LogbookChange => {
  const [r] = buildLogbook({ changes: [c] });
  if (r?.kind !== "change") throw new Error("expected one change row");
  return r;
};

// ── Tests ──────────────────────────────────────────────────────────────────────────────────────

describe("History's change state reads the live check, never the legacy bool (#625)", () => {
  it("walks the real History room", () => {
    expect(files).toContain(join(BLACKBOOK, "logbook.ts"));
    expect(files).toContain(join(BLACKBOOK, "LogbookTape.tsx"));
    expect(files.length).toBeGreaterThan(4);
  });

  it("no History source reads is_still_active", () => {
    const offenders = files.filter((f) => readsLegacyBool(readFileSync(f, "utf8")));
    expect(
      offenders,
      "read `active_check` (the live re-check's verdict) — `is_still_active` stays true for a check " +
        "that read nothing, and History would print that as 'still on'",
    ).toEqual([]);
  });

  it("the detector fires on a read and not on a comment", () => {
    expect(readsLegacyBool("const on = c.status === 'applied' && c.is_still_active;")).toBe(true);
    expect(readsLegacyBool("// is_still_active is the legacy bool\nconst on = false;")).toBe(false);
    expect(readsLegacyBool("/* is_still_active */ const on = false;")).toBe(false);
  });

  it("finds the Rust mapping the Machine Model builds still_active from", () => {
    expect(stillActiveBlock(RUST)).toMatch(/^still_active: match c\.active_check \{/);
  });

  for (const arm of ARMS) {
    it(`active_check ${String(arm.check)}: the Rust arm exists, and History says "${arm.history}"`, () => {
      expect(stillActiveBlock(RUST), `machine_model.rs arm for ${String(arm.check)}`).toMatch(arm.rust);
      expect(stateOf(onlyChange(applied({ active_check: arm.check })))).toBe(arm.history);
    });
  }

  it("a change with no live check recorded at all is not 'still on'", () => {
    // Legacy rows predate `active_check`; the model counts them as not in effect, and so does History.
    const legacy = applied();
    delete legacy.active_check;
    expect(stateOf(onlyChange(legacy))).toBe("not on");
  });

  it("a rolled-back change is history whatever its check says", () => {
    const r = onlyChange(applied({ status: "rolled_back", active_check: "on" }));
    expect(stateOf(r)).toBe("not on");
    expect(r.rolledBack).toBe(true);
  });

  it("an unconfirmed apply still represents a collapsed group, so its undo target is kept", () => {
    // The undo target of a repeated tweak is the apply that may still be in place. Losing the
    // "can't confirm" one to a newer OFF row would point undo at a superseded snapshot.
    const [r] = buildLogbook({
      changes: [
        applied({ id: "unconfirmed", applied_at: "2026-09-01T10:00:00Z", active_check: "unrecognised" }),
        applied({ id: "newer-off", applied_at: "2026-09-05T10:00:00Z", active_check: "off" }),
      ],
    });
    expect(r.kind === "change" && r.id).toBe("unconfirmed");
    expect(r.kind === "change" && r.count).toBe(2);
  });
});
