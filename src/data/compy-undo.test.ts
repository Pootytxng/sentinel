import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import en from "../i18n/locales/en/paramedic.json";
import zh from "../i18n/locales/zh-CN/paramedic.json";
import type { AppliedChange } from "../types";
import { NO_ADMIN_UNDO_KINDS, compyUndoOffer, newestOpenRecord, recordUndoableFromCard, undoNeedsNoAdmin } from "./compy-undo";

// B10 (owner decision 2026-11-24: the coordinator's recommendation, no-admin undos only). What the Something's-wrong
// card may offer for its compy-change row, the no-admin allowlist pinned against the Rust undo dispatch, and the
// source guards on who may run the undo.

const W = { from: "2026-11-19T05:00:00Z", to: "2026-11-19T17:00:00Z", countFrom: "3", countTo: "4" };
const rec = (over: Partial<AppliedChange> = {}): AppliedChange =>
  ({
    id: "gm-1",
    rec_id: "game-mode",
    rec_title: "Game Mode",
    applied_at: "2026-11-19T10:00:00Z",
    snapshot: null,
    status: "applied",
    is_still_active: true,
    active_check: "on",
    undo_contract: true,
    rollback_action: { kind: "restore-game-mode-from-snapshot" },
    ...over,
  }) as AppliedChange;
const NONE = new Set<string>();

describe("B10 offer rules (each break: drop that rule -> the button comes back, fails)", () => {
  it("offers the button when every rule holds", () => {
    expect(compyUndoOffer(W, [rec()], NONE)).toEqual({ kind: "button", recId: "game-mode", id: "gm-1", title: "Game Mode" });
  });
  it.each([
    ["the count went down", { countFrom: "4", countTo: "3" }],
    ["the count went up by two", { countFrom: "3", countTo: "5" }],
    ["the count is not a number", { countFrom: "n/a", countTo: "4" }],
    ["no count evidence", { countFrom: undefined, countTo: undefined }],
  ] as const)("%s: named, no button", (_why, over) => {
    expect(compyUndoOffer({ ...W, ...over }, [rec()], NONE)).toEqual({ kind: "noUndoHere", title: "Game Mode" });
  });
  it.each([
    ["undone inside the window", [rec(), rec({ id: "x-1", rec_id: "x", rec_title: "X", applied_at: "2026-11-01T00:00:00Z", status: "rolled_back", rolled_back_at: "2026-11-19T12:00:00Z" })], NONE],
    ["the drift list names the setting", [rec()], new Set(["game-mode"])],
    ["the drift list is not loaded", [rec()], null],
    ["Compy can't confirm it is on", [rec({ active_check: "unreadable" })], NONE],
    ["no saved undo", [rec({ undo_contract: false })], NONE],
    ["the result was never received", [rec({ result_unconfirmed: true })], NONE],
    ["a Trial is tied to it", [rec({ justified_by_experiment: { experiment_id: "exp:1" } as unknown as AppliedChange["justified_by_experiment"] })], NONE],
    ["its undo needs admin rights", [rec({ rollback_action: { kind: "restore-hw-sch-mode-from-snapshot" } })], NONE],
    ["a legacy row with no typed undo (counted as admin)", [rec({ rollback_action: null })], NONE],
    ["a newer record of the setting after the window", [rec(), rec({ id: "gm-2", applied_at: "2026-11-20T10:00:00Z" })], NONE],
    // Review r1 F1: an older record undone after the window, out of order: this record's saved value is Compy's own.
    // Break check: drop `undoneOutOfOrder` from recordUndoableFromCard -> the button comes back, fails.
    ["an older record of it undone out of order after the window", [rec({ id: "gm-0", applied_at: "2026-11-10T00:00:00Z", status: "rolled_back", rolled_back_at: "2026-11-20T00:00:00Z" }), rec()], NONE],
    ["an older record of it undone with no undo date", [rec({ id: "gm-0", applied_at: "2026-11-10T00:00:00Z", status: "rolled_back", rolled_back_at: null }), rec()], NONE],
    ["two records of the same setting in the window", [rec(), rec({ id: "gm-2", applied_at: "2026-11-19T12:00:00Z" })], NONE],
  ] as const)("%s: named, no button", (_why, list, drift) => {
    expect(compyUndoOffer(W, list as readonly AppliedChange[], drift)).toEqual({ kind: "noUndoHere", title: "Game Mode" });
  });
  it("two records in the window are listed; none is offered", () => {
    const two = [rec(), rec({ id: "v-1", rec_id: "visual-effects", rec_title: "Visual effects", applied_at: "2026-11-19T11:00:00Z" })];
    expect(compyUndoOffer(W, two, NONE)).toEqual({ kind: "several", count: 2, titles: ["Game Mode", "Visual effects"] });
  });
  it("nothing applied in the window: nothing added", () => {
    expect(compyUndoOffer(W, [rec({ applied_at: "2026-11-18T10:00:00Z" })], NONE)).toEqual({ kind: "none" });
  });
  // Break check: date "undone" from applied_at -> fails.
  it("the in-window record undone after the window: the ledger's own rolled_back_at", () => {
    const at = "2026-11-22T09:30:00Z";
    expect(compyUndoOffer(W, [rec({ status: "rolled_back", rolled_back_at: at, active_check: null })], NONE)).toEqual({ kind: "undone", title: "Game Mode", at });
  });
  // Review r1 F2: an undone record is never named as one "to undo if you choose".
  // Break check: return noUndoHere for these -> fails.
  it.each([
    ["undone inside the window", "2026-11-19T12:00:00Z"],
    ["undone with no undo date", null],
    ["undone with an unreadable undo date", "not a date"],
  ] as const)("the in-window record %s: nothing is offered or named", (_why, at) => {
    expect(compyUndoOffer(W, [rec({ status: "rolled_back", rolled_back_at: at, active_check: null })], NONE)).toEqual({ kind: "none" });
  });
  // Review r1 F4: the count is of settings, never records. Break check: count records -> 3, fails.
  it("several counts the settings it lists", () => {
    const list = [
      rec(),
      rec({ id: "gm-2", applied_at: "2026-11-19T12:00:00Z" }),
      rec({ id: "v-1", rec_id: "visual-effects", rec_title: "Visual effects", applied_at: "2026-11-19T11:00:00Z" }),
    ];
    expect(compyUndoOffer(W, list, NONE)).toEqual({ kind: "several", count: 2, titles: ["Game Mode", "Visual effects"] });
  });
  it("the newest open record is the last in change-history order, and App's re-check uses the same rules", () => {
    const list = [rec(), rec({ id: "gm-2", applied_at: "2026-11-01T00:00:00Z" })];
    expect(newestOpenRecord(list, "game-mode")?.id).toBe("gm-2");
    expect(recordUndoableFromCard(list, list[0])).toBe(false);
  });
});

describe("B10 the no-admin allowlist matches the Rust undo dispatch", () => {
  const actions = readFileSync(join("src-tauri", "src", "actions.rs"), "utf8");
  const pascal = (kebab: string) => kebab.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  const dispatch = actions.slice(actions.indexOf("pub(crate) fn dispatch_rollback("), actions.indexOf("pub(crate) fn synthesize_legacy_rollback("));
  /** The function an action's arm in `dispatch_rollback` calls. */
  const handlerOf = (variant: string): string => {
    const at = dispatch.search(new RegExp(`R::${variant}\\b`));
    expect(at, `${variant} has an arm in dispatch_rollback`).toBeGreaterThan(-1);
    const m = /=>\s*\{?\s*(rollback_[a-z_]+)\(/.exec(dispatch.slice(at));
    expect(m, `${variant}'s handler`).not.toBeNull();
    return m![1];
  };
  /** A function's body, from its signature to the next top-level `}`. */
  const bodyOf = (fn: string): string => {
    const start = actions.search(new RegExp(`\\bfn ${fn}\\(`));
    expect(start, fn).toBeGreaterThan(-1);
    return actions.slice(start, actions.indexOf("\n}\n", start));
  };
  const ELEVATED = /run_elevated|HKEY_LOCAL_MACHINE|Command::new|powershell|sys_exe|SysTool|elevat/i;

  // Break check: add "restore-hw-sch-mode-from-snapshot" (HAGS, an elevated undo) to the list -> fails.
  it("every listed variant's undo writes only HKCU and calls no elevated runner or process", () => {
    expect([...NO_ADMIN_UNDO_KINDS].sort()).toEqual([
      "restore-game-bar-from-snapshot",
      "restore-game-mode-from-snapshot",
      "restore-mouse-accel-from-snapshot",
      "restore-startup-approval-from-snapshot",
      "restore-visual-effects-from-snapshot",
    ]);
    for (const kind of NO_ADMIN_UNDO_KINDS) {
      const body = bodyOf(handlerOf(pascal(kind)));
      expect(body, kind).toMatch(/HKEY_CURRENT_USER/);
      expect(body, kind).not.toMatch(ELEVATED);
    }
  });

  // Review r1: a handler that later calls a helper must not pass by hiding the elevation one call down. Every free
  // function a listed handler calls is followed one call deep: it must be a helper on this short list, and its own
  // body must elevate nothing and call no further function of this file. Break check: make a listed handler call
  // `run_elevated_powershell` through a new helper -> fails (the helper is not on the list).
  it("the listed handlers call no helper beyond a short pure list, followed one call deep", () => {
    const ALLOWED_HELPERS = new Set(["startup_reg_type_from_u32"]);
    const NOT_CALLS = new Set(["Ok", "Err", "Some", "if", "match", "while", "for", "restore", "map_err", "fn"]);
    const freeCalls = (body: string) =>
      [...body.matchAll(/(?<![.:\w])([a-z_][a-z0-9_]*)\(/g)].map((m) => m[1]).filter((n) => !NOT_CALLS.has(n));
    for (const kind of NO_ADMIN_UNDO_KINDS) {
      const handler = handlerOf(pascal(kind));
      const body = bodyOf(handler).slice(`fn ${handler}(`.length);
      expect(body, kind).not.toMatch(/\bcrate::|\bsuper::|\bstd::process/);
      for (const name of freeCalls(body)) {
        expect(ALLOWED_HELPERS.has(name), `${kind} calls ${name}`).toBe(true);
        const helper = bodyOf(name);
        expect(helper, name).not.toMatch(ELEVATED);
        expect(freeCalls(helper.slice(`fn ${name}(`.length)), name).toEqual([]);
      }
    }
  });

  it("the check is not vacuous: an undo the list leaves out does elevate", () => {
    expect(bodyOf(handlerOf("RestoreHwSchModeFromSnapshot"))).toMatch(/run_elevated/);
  });

  it("the preloaded-app reinstall and any unknown or missing variant count as admin", () => {
    expect(undoNeedsNoAdmin({ rollback_action: { kind: "reinstall-preload-app", app: "x" } })).toBe(false);
    expect(undoNeedsNoAdmin({ rollback_action: { kind: "restore-something-new-from-snapshot" } })).toBe(false);
    expect(undoNeedsNoAdmin({ rollback_action: null })).toBe(false);
    expect(undoNeedsNoAdmin({})).toBe(false);
    expect(undoNeedsNoAdmin({ rollback_action: { kind: "restore-game-mode-from-snapshot" } })).toBe(true);
  });
});

describe("B10 who may run the undo (source guards)", () => {
  const read = (rel: string) => readFileSync(join("src", ...rel.split("/")), "utf8");
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

  // Break check: call writeLedger("rollback_change") from the card -> fails.
  it("the card and its offer module run nothing: no writeLedger, no ledger-write import, no undo command", () => {
    const card = code(read("surfaces/glass/ParamedicCard.tsx"));
    expect(card).not.toMatch(/\bwriteLedger\b|ledger-write/);
    expect(card).not.toMatch(/rollback_change/);
    // The card's only command is the diagnosis.
    expect([...card.matchAll(/invoke[^(]*\(\s*"([a-z_]+)"/g)].map((m) => m[1])).toEqual(["paramedic_diagnose"]);
    const offer = code(read("data/compy-undo.ts"));
    expect(offer).not.toMatch(/\bwriteLedger\b|ledger-write|@tauri-apps|\binvoke\b/);
  });

  // Break checks: call `rollback(` or `walkSetting(` from undoOneRecord -> fails; drop the at-click re-read -> fails.
  it("App's undoOneRecord re-reads at the click and makes exactly one rollback_change of the expected id", () => {
    const app = read("App.tsx");
    const body = app.split("const undoOneRecord = async")[1].split("\n  };\n")[0];
    expect(body).toMatch(/invoke<AppliedChange\[\]>\("get_applied_changes"\)/);
    expect(body).toMatch(/invoke<\{ status: string \}\[\]>\("get_experiments"\)/);
    expect(body).toMatch(/trialInProgress\(xs, journey\.kind === "idle"\) !== "none"/);
    expect(body).toMatch(/row\.id !== expectedId \|\| !recordUndoableFromCard\(fresh, row\)/);
    expect(body.match(/writeLedger\(/g)).toHaveLength(1);
    expect(body).toMatch(/writeLedger\("rollback_change", \{ changeId: expectedId \}\)/);
    expect(body).not.toMatch(/\brollback\(|walkSetting|runSettingWalk|settingUndo|apply_recommendation/);
    // The confirm is always shown before the call.
    expect(body.indexOf("await confirm(")).toBeGreaterThan(-1);
    expect(body.indexOf("await confirm(")).toBeLessThan(body.indexOf("writeLedger("));
  });

  // Review r1: each line of undoOneRecord, literally and in this order: the busy gate, both re-reads, the Trial check,
  // the unread list, the expected newest open record re-checked by the card's own rules, the confirm, then the one
  // write. Break checks: move the Trial check after the confirm, or drop `recordUndoableFromCard(fresh, row)` -> fails.
  it("App's undoOneRecord does its steps in this order, each literally", () => {
    const app = read("App.tsx");
    const body = app.split("const undoOneRecord = async")[1].split("\n  };\n")[0];
    const steps = [
      'if (busyId !== null) return { kind: "busy" };',
      'const fresh = await invoke<AppliedChange[]>("get_applied_changes")',
      'const xs = await invoke<{ status: string }[]>("get_experiments")',
      'if (trialInProgress(xs, journey.kind === "idle") !== "none") return { kind: "trial" };',
      'if (!fresh) return { kind: "unread" };',
      "const row = newestOpenRecord(fresh, recId);",
      'if (!row || row.id !== expectedId || !recordUndoableFromCard(fresh, row)) return { kind: "changed" };',
      'const dialog = undoDialog({ kind: "one", why: "single", open: 1 }, row, t);',
      "const ok = await confirm({ ...dialog, body: `${dialog.body} ${extraBody}` });",
      'if (!ok) return { kind: "cancelled" };',
      "setBusyId(expectedId);",
      'await writeLedger("rollback_change", { changeId: expectedId });',
    ];
    let at = -1;
    for (const s of steps) {
      const next = body.indexOf(s);
      expect(next, s).toBeGreaterThan(at);
      at = next;
    }
    expect(body.split('writeLedger("rollback_change"').length - 1).toBe(1);
  });
});

describe("B10 strings", () => {
  const k = (l: typeof en) => l.fix.compyChange as Record<string, string>;
  const NEW = ["undoButton", "undoExtra", "undone", "several_other", "noUndoHere", "changedSinceDrawn", "trialRunning", "listUnread"];
  it("both languages have every new string; the path is the screen's own name", () => {
    for (const key of NEW) {
      expect(k(en)[key], key).toBeTruthy();
      expect(k(zh)[key], key).toMatch(/[一-鿿]/);
    }
    expect(k(en).several_other).toContain("Test → Applied & history");
    expect(k(en).noUndoHere).toContain("Test → Applied & history");
    expect(k(zh).several_other).toContain("「测试 → 已应用与历史记录」");
    expect(k(zh).noUndoHere).toContain("「测试 → 已应用与历史记录」");
  });
  // Break check: write "fix" or "better" into undoExtra -> fails.
  it("mechanism only: never fix, better, smoother or faster; no promise", () => {
    for (const key of NEW) {
      expect(k(en)[key], key).not.toMatch(/\b(fix|fixed|fixes|better|smoother|faster|guarantee|safe)\b/i);
      expect(k(zh)[key], key).not.toMatch(/修复|更好|更流畅|更快|保证|安全/);
    }
  });
});