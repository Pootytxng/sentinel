// C1 "Your data": the pure half. What can break here is honesty: a headline that says "deleted" when the
// report is not complete, browser keys cleared beyond the inventory's list, or a code that silently
// vanishes from the screen.
import { describe, it, expect, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
import { readFileSync } from "fs";
import { join } from "path";
import {
  clearWebviewTargets,
  failureKind,
  failureLine,
  finishPendingClearAtBoot,
  planHasLicence,
  statusLine,
  storeGroup,
  undoOrder,
  EVERYTHING_GROUPS,
  type ClearStatus,
  groupDeletes,
  groupKept,
  KEPT_CODES,
  REFUSAL_CODES,
  resultKind,
  sizeLabel,
  STORE_GROUPS,
  type ClearPlan,
  type ClearReport,
  type StorageLike,
} from "./your-data";

function storage(init: Record<string, string>): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    removeItem: (k: string) => void data.delete(k),
  };
}

const REPORT: ClearReport = {
  scope: "play_history",
  deleted: ["sessions.json"],
  already_gone: [],
  failed: [],
  not_attempted: [],
  stopped: [],
  kept: [],
  unknown: [],
  complete: true,
  nothing_to_do: false,
  restart_required: true,
  restart_reasons: ["screen_memory"],
  webview: [],
};

describe("your-data: what the screen says", () => {
  it("says deleted only for a complete report", () => {
    expect(resultKind(REPORT)).toBe("deleted");
    expect(resultKind({ ...REPORT, deleted: [], complete: true, nothing_to_do: true })).toBe("nothing");
    expect(resultKind({ ...REPORT, complete: false, failed: [{ rel: "drift.json", error: "in use" }] })).toBe("not_finished");
    expect(resultKind({ ...REPORT, complete: false, not_attempted: ["drift.json"], stopped: [{ code: "capture_running", detail: "", files: [] }] })).toBe("stopped");
    // complete=false with nothing else listed is still not "deleted"
    expect(resultKind({ ...REPORT, complete: false })).toBe("not_finished");
  });

  it("groups the plan by store, counts files and bytes, and puts unknown stores under 'other'", () => {
    const plan = {
      delete: [
        { rel: "sessions.json", row_id: "sessions", store: "sessions", category: "play_history", size: 2048, modified_ms: 1 },
        { rel: "sessions.json.corrupt.1", row_id: "store-corrupt-stamped", store: "sessions", category: "play_history", size: 10, modified_ms: 1 },
        { rel: "runtime/fps.json", row_id: "fps-report", store: "fps-report", category: "transient", size: 5, modified_ms: 1 },
      ],
    } as ClearPlan;
    expect(groupDeletes(plan)).toEqual([
      { group: "sessions", files: ["sessions.json", "sessions.json.corrupt.1"], bytes: 2058 },
      { group: "other", files: ["runtime/fps.json"], bytes: 5 },
    ]);
    expect(groupKept([{ rel: "a", code: "undo_data", detail: "" }, { rel: "b", code: "new_code", detail: "" }])).toEqual([
      { code: "undo_data", known: true, files: ["a"] },
      { code: "new_code", known: false, files: ["b"] },
    ]);
    expect(sizeLabel(10)).toBe("10 B");
    expect(sizeLabel(1025)).toBe("1 KB");
  });

  it("clears exactly the targeted keys, prefixes included, from the right storage, and never clear()", () => {
    const local = storage({ compy_last_check_v1: "x", compy_bb_helpful_a: "1", compy_bb_helpful_b: "1", compy_theme: "dark", compy_onboarded_v1: "1" });
    const session = storage({ compy_learn_mode: "a", compy_autopsy_text: "mine" });
    const out = clearWebviewTargets(
      [
        { key: "compy_last_check_v1", prefix: false, session_storage: false },
        { key: "compy_bb_helpful_", prefix: true, session_storage: false },
        { key: "compy_learn_mode", prefix: false, session_storage: true },
        { key: "compy_absent", prefix: false, session_storage: false },
      ],
      local,
      session,
    );
    expect(out.removed.sort()).toEqual(["compy_bb_helpful_a", "compy_bb_helpful_b", "compy_last_check_v1", "compy_learn_mode"]);
    expect(out.stillThere).toEqual([]);
    expect([...local.data.keys()].sort()).toEqual(["compy_onboarded_v1", "compy_theme"]);
    expect([...session.data.keys()]).toEqual(["compy_autopsy_text"]);
  });

  it("reports a key that would not go", () => {
    const stuck = storage({ k: "v" });
    stuck.removeItem = () => {
      throw new Error("blocked");
    };
    expect(clearWebviewTargets([{ key: "k", prefix: false, session_storage: false }], stuck, storage({}))).toEqual({ removed: [], stillThere: ["k"] });
  });
});

describe("your-data: the confirm list names every play-history store the inventory has (review B3)", () => {
  // Every data-folder row the play-history clear deletes as a store of its own (category PlayHistory or
  // HardwareFacts; set-asides and working files group under their store, ledger rows are never in it) must have
  // its own words, so a new store of play data can't be deleted under the "other working files" label.
  const src = readFileSync(join("src-tauri", "src", "data_inventory.rs"), "utf8");
  const rows = [...src.matchAll(/InventoryRow \{([\s\S]*?)\n\s{4}\},/g)].map((m) => {
    const body = m[1];
    return {
      id: /\bid: "([^"]+)"/.exec(body)?.[1] ?? "",
      base: /\bbase: (?:Base::)?(\w+)/.exec(body)?.[1] ?? "",
      category: /\bcategory: (?:Category::)?(\w+)/.exec(body)?.[1] ?? "",
    };
  });
  const ids = new Set(rows.map((r) => r.id));
  const stores = rows.filter((r) => r.base === "DataRoot" && (r.category === "PlayHistory" || r.category === "HardwareFacts"));

  it("parses the inventory (non-vacuous)", () => {
    expect(rows.length).toBeGreaterThan(50);
    expect(stores.map((r) => r.id)).toContain("sessions");
    expect(stores.length).toBeGreaterThanOrEqual(11);
  });

  it("every play-history or hardware store row has a STORE_GROUPS entry", () => {
    expect(stores.map((r) => r.id).filter((id) => !(id in STORE_GROUPS))).toEqual([]);
  });

  it("every STORE_GROUPS key is an inventory id", () => {
    expect(Object.keys(STORE_GROUPS).filter((id) => !ids.has(id))).toEqual([]);
  });
});

describe("your-data: a failed delete never shows the backend's English (review should-fix)", () => {
  it("names the kinds it can and keeps only a Windows error number otherwise", () => {
    expect(failureKind("The process cannot access the file because it is being used by another process. (os error 32)")).toEqual({ kind: "in_use" });
    expect(failureKind("Access is denied. (os error 5)")).toEqual({ kind: "denied" });
    expect(failureKind("is still there after the delete")).toEqual({ kind: "still_there" });
    // A folder that changed is named as a folder (review r2 nit), a file that changed as a file.
    expect(failureKind("is not where it was planned (a folder was swapped for a link), so nothing was deleted")).toEqual({ kind: "folder_moved" });
    expect(failureKind("the data folder is a link or not a folder, so nothing was touched")).toEqual({ kind: "folder_moved" });
    expect(failureKind("`care` is a link or not a folder, so nothing inside it was touched")).toEqual({ kind: "folder_moved" });
    expect(failureKind("the folder leads outside Compy's data folder, so nothing was touched")).toEqual({ kind: "folder_moved" });
    expect(failureKind("is not a plain file, so it was left alone")).toEqual({ kind: "moved" });
    expect(failureKind("Something else (os error 1920)")).toEqual({ kind: "os", code: 1920 });
    expect(failureKind("the identity log lock is poisoned")).toEqual({ kind: "other" });
    const line = failureLine({ rel: "drift.json", error: "Something else (os error 1920)" });
    expect(line).toEqual({ key: "fileFailedCode", opts: { file: "drift.json", code: 1920 } });
    expect(JSON.stringify(line)).not.toContain("Something else");
  });

  it("a complete run whose files were all already gone does not say deleted", () => {
    expect(resultKind({ ...REPORT, deleted: [], already_gone: ["a"], complete: true, nothing_to_do: false })).toBe("all_gone");
  });
});

describe("your-data: every code has words in both languages", () => {
  const en = JSON.parse(readFileSync(join("src", "i18n", "locales", "en", "settings.json"), "utf8")).yourData;
  const zh = JSON.parse(readFileSync(join("src", "i18n", "locales", "zh-CN", "settings.json"), "utf8")).yourData;
  it("refusals, kept reasons and store groups", () => {
    for (const lang of [en, zh]) {
      for (const c of [...REFUSAL_CODES, "other"]) expect(lang.refusal[c], `refusal.${c}`).toBeTruthy();
      for (const c of [...KEPT_CODES, "other"]) expect(lang.kept[c], `kept.${c}`).toBeTruthy();
      for (const g of [...new Set(Object.values(STORE_GROUPS)), "other"]) expect(lang.store[g], `store.${g}`).toBeTruthy();
    }
  });

  it("English never says '1 files' or '1 were': a count goes before a plural only where a separate 'One' line exists (review r2)", () => {
    const bad = Object.entries(en as Record<string, unknown>)
      .filter(([k, v]) => typeof v === "string" && !(`${k}One` in en))
      .filter(([, v]) => /\{\{(n|m|left|failed)\}\} (files|were|notes|play-history)/.test(v as string))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("the crash-notes lines do not promise they are gone for good", () => {
    for (const s of [en.store.crashNotes, en.crashNotesReturn]) expect(s).toMatch(/Windows' own logs/);
    for (const s of [zh.store.crashNotes, zh.crashNotesReturn]) expect(s).toMatch(/Windows 自己的日志/);
  });

  it("every refusal code the Rust planner can give for play history has its own sentence", () => {
    const rust = readFileSync(join("src-tauri", "src", "data_clear.rs"), "utf8").split("#[cfg(test)]\nmod tests")[0];
    // Codes a play-history plan or run can refuse with (the ledger/everything-only codes are C2's).
    // C2b: every refusal of either choice has a sentence. Exempt: `ledger_lock_required` (only a programming
    // error can give it: a play-history entry handed an "everything" plan) and the acknowledge's own codes,
    // which the screen shows as "could not remove its note" (`ackFailed`).
    const everythingOnly = new Set(["ledger_lock_required", "clear_files_pending", "clear_intent_not_removed"]);
    const found = new Set<string>();
    for (const m of rust.matchAll(/(?:refuse\(\s*|Verdict::Refuse\(\s*|out\.push\(\(|code:\s*)"([a-z_]+)"/g)) found.add(m[1]);
    const missing = [...found].filter((c) => !everythingOnly.has(c) && !(REFUSAL_CODES as readonly string[]).includes(c) && !(KEPT_CODES as readonly string[]).includes(c));
    expect(found.size).toBeGreaterThan(10);
    expect(missing).toEqual([]);
  });
});

describe("your-data C2b: clear everything", () => {
  const src = readFileSync(join("src-tauri", "src", "data_inventory.rs"), "utf8");
  const rows = [...src.matchAll(/InventoryRow \{([\s\S]*?)\n\s{4}\},/g)].map((m) => ({
    id: /\bid: "([^"]+)"/.exec(m[1])?.[1] ?? "",
    base: /\bbase: (?:Base::)?(\w+)/.exec(m[1])?.[1] ?? "",
    category: /\bcategory: (?:Category::)?(\w+)/.exec(m[1])?.[1] ?? "",
  }));
  const ids = new Set(rows.map((r) => r.id));

  it("every store 'clear everything' can delete has its own words, so the change history is never 'other files'", () => {
    // Stores of their own (not working files or set-asides, which group under their owner): the change history
    // (`ledger-*` main and backup rows), support, saved reports, choices, caches and user text.
    const named = rows.filter(
      (r) =>
        r.base === "DataRoot" &&
        (["PlayHistory", "HardwareFacts", "Support", "Cache", "Choices", "UserText"].includes(r.category) ||
          r.id === "ledger-main" ||
          r.id === "ledger-backup" ||
          r.id === "ledger-restored-note"),
    );
    expect(named.length).toBeGreaterThan(20);
    expect(named.filter((r) => storeGroup(r.id) === "other").map((r) => r.id)).toEqual([]);
    expect(storeGroup("ledger-main")).toBe("changeHistory");
    expect(storeGroup("export-report-md")).toBe("reports");
    expect(Object.keys(EVERYTHING_GROUPS).filter((id) => !ids.has(id))).toEqual([]);
  });

  it("the licence box appears only when the plan involves the licence file", () => {
    const base = { delete: [], kept: [] } as unknown as ClearPlan;
    expect(planHasLicence(base)).toBe(false);
    expect(planHasLicence({ ...base, kept: [{ rel: "license.key", code: "licence_kept", detail: "" }] })).toBe(true);
    expect(planHasLicence({ ...base, delete: [{ rel: "license.key", row_id: "license", store: "license", category: "choices", size: 1, modified_ms: 1 }] })).toBe(true);
  });

  it("'Undo all first' undoes every row not rolled back, newest first", () => {
    const rows = [
      { id: "a", status: "applied", applied_at: "2026-11-01T00:00:00Z" },
      { id: "b", status: "rolled_back", applied_at: "2026-11-03T00:00:00Z" },
      { id: "c", status: "externally_reverted", applied_at: "2026-11-02T00:00:00Z" },
    ];
    expect(undoOrder(rows).map((r) => r.id)).toEqual(["c", "a"]);
  });

  it("the status line comes from the start-up result first, then an abandoned record; unknown codes are shown", () => {
    const s = (over: Partial<ClearStatus>): ClearStatus => ({ roll_forward: null, record: "none", abandoned_code: null, webview: [], ...over });
    expect(statusLine(s({}))).toBeNull();
    expect(statusLine(s({ roll_forward: { status: "completed" }, record: "none" }))).toEqual({ key: "completed", dismiss: false });
    expect(statusLine(s({ roll_forward: { status: "abandoned", detail: { code: "changes_applied" } }, record: "abandoned" }))).toEqual({
      key: "abandoned_changes_applied",
      code: "changes_applied",
      dismiss: true,
    });
    expect(statusLine(s({ record: "abandoned", abandoned_code: "brand_new" }))).toEqual({ key: "abandoned_other", code: "brand_new", dismiss: true });
    expect(statusLine(s({ record: "unreadable" }))).toEqual({ key: "kept", dismiss: false });
  });

  it("every status line and every new string has words in both languages", () => {
    const en = JSON.parse(readFileSync(join("src", "i18n", "locales", "en", "settings.json"), "utf8")).yourData;
    const zh = JSON.parse(readFileSync(join("src", "i18n", "locales", "zh-CN", "settings.json"), "utf8")).yourData;
    for (const lang of [en, zh]) {
      for (const key of ["completed", "incomplete", "webview_pending", "kept", "deferred", "abandoned_needs_reconfirm", "abandoned_changes_applied", "abandoned_ledger_unreadable", "abandoned_ledger_set_aside", "abandoned_other"]) {
        expect(lang.status[key], `status.${key}`).toBeTruthy();
      }
      for (const g of new Set(Object.values(EVERYTHING_GROUPS).concat(["changeHistory", "reports"]))) expect(lang.store[g], `store.${g}`).toBeTruthy();
    }
    // The after-clear notice asks for a close and reopen; nothing says Compy restarts itself.
    expect(en.reopenNotice).toMatch(/Close Compy and open it again/);
    for (const v of Object.values(en)) if (typeof v === "string") expect(v).not.toMatch(/restarts? (itself|automatically)/i);
  });

  function memStorage(init: Record<string, string>) {
    const data = new Map(Object.entries(init));
    return {
      data,
      get length() {
        return data.size;
      },
      key: (i: number) => [...data.keys()][i] ?? null,
      getItem: (k: string) => data.get(k) ?? null,
      removeItem: (k: string) => void data.delete(k),
    };
  }

  it("at start, a finished clear's pending window notes are removed, the record acknowledged, then a reload", async () => {
    const local = memStorage({ compy_onboarded_v1: "1", compy_theme: "dark", other_app_key: "x" });
    const session = memStorage({});
    const calls: string[] = [];
    let reloads = 0;
    const status: ClearStatus = {
      roll_forward: { status: "webview_pending" },
      record: "webview_pending",
      abandoned_code: null,
      webview: [
        { key: "compy_onboarded_v1", prefix: false, session_storage: false },
        { key: "compy_theme", prefix: false, session_storage: false },
      ],
    };
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string) => {
      calls.push(cmd);
      return cmd === "get_clear_status" ? status : null;
    });
    expect(await finishPendingClearAtBoot(local, session, () => reloads++)).toBe("finished");
    expect(calls).toEqual(["get_clear_status", "acknowledge_clear"]);
    expect([...local.data.keys()]).toEqual(["other_app_key"]);
    expect(reloads).toBe(1);
  });

  it("at start, nothing happens without a pending record, and a failed acknowledge does not reload", async () => {
    const local = memStorage({ compy_theme: "dark" });
    let reloads = 0;
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "get_clear_status" ? { roll_forward: null, record: "none", abandoned_code: null, webview: [{ key: "compy_theme", prefix: false, session_storage: false }] } : null,
    );
    expect(await finishPendingClearAtBoot(local, memStorage({}), () => reloads++)).toBe("nothing");
    expect(local.data.get("compy_theme")).toBe("dark");
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "acknowledge_clear") throw new Error("clear_files_pending");
      return { roll_forward: null, record: "webview_pending", abandoned_code: null, webview: [] };
    });
    expect(await finishPendingClearAtBoot(local, memStorage({}), () => reloads++)).toBe("failed");
    invokeMock.mockImplementation(async () => {
      throw new Error("not allowed");
    });
    expect(await finishPendingClearAtBoot(local, memStorage({}), () => reloads++)).toBe("failed");
    expect(reloads).toBe(0);
  });
});
