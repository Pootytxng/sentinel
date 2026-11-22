// C1 "Your data": the pure half. What can break here is honesty: a headline that says "deleted" when the
// report is not complete, browser keys cleared beyond the inventory's list, or a code that silently
// vanishes from the screen.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  clearWebviewTargets,
  failureKind,
  failureLine,
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
    expect(failureKind("is not where it was planned (a folder was swapped for a link), so nothing was deleted")).toEqual({ kind: "moved" });
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

  it("the crash-notes lines do not promise they are gone for good", () => {
    for (const s of [en.store.crashNotes, en.crashNotesReturn]) expect(s).toMatch(/Windows' own logs/);
    for (const s of [zh.store.crashNotes, zh.crashNotesReturn]) expect(s).toMatch(/Windows 自己的日志/);
  });

  it("every refusal code the Rust planner can give for play history has its own sentence", () => {
    const rust = readFileSync(join("src-tauri", "src", "data_clear.rs"), "utf8").split("#[cfg(test)]\nmod tests")[0];
    // Codes a play-history plan or run can refuse with (the ledger/everything-only codes are C2's).
    const everythingOnly = new Set(["store_lock_unavailable", "changes_applied", "ledger_unreadable", "ledger_set_aside", "ledger_busy", "gaming_orphan", "trial_record_set_aside", "clear_intent_unreadable", "clear_intent_unwritable", "ledger_lock_required", "no_clear_in_progress", "clear_files_pending", "clear_intent_not_removed"]);
    const found = new Set<string>();
    for (const m of rust.matchAll(/(?:refuse\(\s*|Verdict::Refuse\(\s*|out\.push\(\(|code:\s*)"([a-z_]+)"/g)) found.add(m[1]);
    const missing = [...found].filter((c) => !everythingOnly.has(c) && !(REFUSAL_CODES as readonly string[]).includes(c) && !(KEPT_CODES as readonly string[]).includes(c));
    expect(found.size).toBeGreaterThan(10);
    expect(missing).toEqual([]);
  });
});
