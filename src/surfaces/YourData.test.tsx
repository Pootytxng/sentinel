// C1 "Your data" screen. The contract that can only break here:
//   · nothing is read or deleted until asked; the plan is shown before anything is deleted;
//   · Delete is disabled until "I understand" is ticked; Cancel has focus; Esc cancels;
//   · the delete sends the fingerprint of the plan shown;
//   · refusals are shown in words from their codes; "deleted" only for a complete report;
//   · browser keys go only after a complete clear, and the reload offer only then.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import "../i18n";
import YourData from "./YourData";
import type { ClearPlan, ClearReport } from "./your-data";

const PLAN: ClearPlan = {
  scope: "play_history",
  delete: [
    { rel: "sessions.json", row_id: "sessions", store: "sessions", category: "play_history", size: 4096, modified_ms: 1 },
    { rel: "care/incident-observer.json", row_id: "incident-observer", store: "incident-observer", category: "play_history", size: 100, modified_ms: 1 },
  ],
  kept: [
    { rel: "history.json", code: "change_history", detail: "dev text" },
    { rel: "support/evidence.jsonl", code: "not_in_this_choice", detail: "dev text" },
  ],
  unknown: ["notes.txt"],
  refusals: [],
  applied_changes: [],
  applied_settings: [],
  offer_undo_all: false,
  legacy_folder_present: false,
  webview: [{ key: "compy_last_check_v1", prefix: false, session_storage: false }],
  fingerprint: "fp-1",
};

const REPORT: ClearReport = {
  scope: "play_history",
  deleted: ["sessions.json", "care/incident-observer.json"],
  already_gone: [],
  failed: [],
  not_attempted: [],
  stopped: [],
  kept: PLAN.kept,
  unknown: PLAN.unknown,
  complete: true,
  nothing_to_do: false,
  restart_required: true,
  restart_reasons: ["screen_memory"],
  webview: PLAN.webview,
};

function answer(plan: unknown, outcome: unknown) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "plan_clear_play_history") return Promise.resolve(plan);
    if (cmd === "clear_play_history") return Promise.resolve(outcome);
    return Promise.reject(new Error(`unexpected ${cmd}`));
  });
}

async function openPlan() {
  fireEvent.click(screen.getByRole("button", { name: "Show what would be deleted" }));
  await screen.findByTestId("your-data-confirm");
}

beforeEach(() => {
  invokeMock.mockReset();
  window.localStorage.clear();
});
afterEach(cleanup);

describe("Your data: clear play history", () => {
  it("reads nothing until asked, then shows the plan before deleting anything", async () => {
    answer(PLAN, { status: "done", detail: REPORT });
    render(<YourData />);
    // C2b: the screen reads the clear record's status on open (no data, no plan); nothing else until asked.
    const dataCalls = () => invokeMock.mock.calls.map((c) => c[0]).filter((c) => c !== "get_clear_status");
    expect(dataCalls()).toEqual([]);
    await openPlan();
    expect(dataCalls()).toEqual(["plan_clear_play_history"]);
    const list = screen.getByTestId("your-data-delete-list");
    expect(list.textContent).toContain("Play sessions Compy measured");
    expect(list.textContent).toContain("(1 file, 4 KB)");
    expect(list.textContent).toContain("Windows' own logs");
    const kept = screen.getByTestId("your-data-kept-list");
    expect(kept.textContent).toContain("every change Compy made can still be undone");
    expect(kept.textContent).toContain("notes.txt");
    expect(kept.textContent).not.toContain("dev text");
  });

  it("keeps Delete disabled until 'I understand' is ticked; Cancel has focus; Esc cancels and deletes nothing", async () => {
    answer(PLAN, { status: "done", detail: REPORT });
    render(<YourData />);
    await openPlan();
    const del = screen.getByRole("button", { name: "Delete play history" });
    expect(del).toBeDisabled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(screen.getByTestId("your-data-confirm"), { key: "Escape" });
    expect(screen.queryByTestId("your-data-confirm")).toBeNull();
    expect(invokeMock).not.toHaveBeenCalledWith("clear_play_history", expect.anything());
    expect(screen.queryByRole("button", { name: "OK" })).toBeNull();
  });

  it("sends the shown plan's fingerprint, then clears exactly the report's keys and offers a reload", async () => {
    window.localStorage.setItem("compy_last_check_v1", "x");
    window.localStorage.setItem("compy_theme", "dark");
    answer(PLAN, { status: "done", detail: REPORT });
    render(<YourData />);
    await openPlan();
    fireEvent.click(screen.getByLabelText("I understand"));
    fireEvent.click(screen.getByRole("button", { name: "Delete play history" }));
    await screen.findByTestId("your-data-result");
    expect(invokeMock).toHaveBeenCalledWith("clear_play_history", { fingerprint: "fp-1" });
    expect(screen.getByText("Deleted 2 files.")).toBeTruthy();
    expect(screen.getByTestId("your-data-files").textContent).toContain("Deleted: sessions.json");
    expect(window.localStorage.getItem("compy_last_check_v1")).toBeNull();
    expect(window.localStorage.getItem("compy_theme")).toBe("dark");
    expect(screen.getByTestId("your-data-reload")).toBeTruthy();
    expect(screen.getByText(/recent crashes may show up again/)).toBeTruthy();
  });

  it("an incomplete clear never says deleted, keeps the window's notes and offers no reload", async () => {
    window.localStorage.setItem("compy_last_check_v1", "x");
    const failed: ClearReport = { ...REPORT, deleted: ["sessions.json"], failed: [{ rel: "care/incident-observer.json", error: "in use" }], complete: false };
    answer(PLAN, { status: "done", detail: failed });
    render(<YourData />);
    await openPlan();
    fireEvent.click(screen.getByLabelText("I understand"));
    fireEvent.click(screen.getByRole("button", { name: "Delete play history" }));
    await screen.findByTestId("your-data-result");
    expect(screen.queryByText(/^Deleted \d+ files?\.$/)).toBeNull();
    expect(screen.getByText(/^Not finished\. Files deleted: 1\. Files that could not be deleted: 1\. Files not tried: 0\./)).toBeTruthy();
    expect(screen.getByTestId("your-data-files").textContent).toContain("Could not delete: care/incident-observer.json");
    expect(screen.getByTestId("your-data-files").textContent).not.toContain("(in use)");
    expect(window.localStorage.getItem("compy_last_check_v1")).toBe("x");
    expect(screen.queryByTestId("your-data-reload")).toBeNull();
  });

  it("counts only files this run deleted; files already gone are said apart (review B1)", async () => {
    const mixed: ClearReport = { ...REPORT, deleted: ["sessions.json"], already_gone: ["care/incident-observer.json"] };
    answer(PLAN, { status: "done", detail: mixed });
    render(<YourData />);
    await openPlan();
    fireEvent.click(screen.getByLabelText("I understand"));
    fireEvent.click(screen.getByRole("button", { name: "Delete play history" }));
    await screen.findByTestId("your-data-result");
    expect(screen.getByText("Deleted 1 file.")).toBeTruthy();
    expect(screen.getByText("Files that were already gone: 1.")).toBeTruthy();
    expect(screen.queryByText("Deleted 2 files.")).toBeNull();
  });

  // C4 (c4e). Break check: drop the trials_went_during_apply line in YourData.tsx -> the first half fails.
  it("says when the Trial results went while a change was applied around the same moment, and only then", async () => {
    const SENTENCE = "Trial results were deleted, and a change was applied around the same moment.";
    answer(PLAN, { status: "done", detail: { ...REPORT, deleted: ["experiments.json"], trials_went_during_apply: true } });
    const first = render(<YourData />);
    await openPlan();
    fireEvent.click(screen.getByLabelText("I understand"));
    fireEvent.click(screen.getByRole("button", { name: "Delete play history" }));
    const result = await screen.findByTestId("your-data-result");
    expect(result.textContent).toContain(SENTENCE);
    expect(result.textContent).toContain("can still be undone");
    first.unmount();
    answer(PLAN, { status: "done", detail: { ...REPORT, deleted: ["experiments.json"] } });
    render(<YourData />);
    await openPlan();
    fireEvent.click(screen.getByLabelText("I understand"));
    fireEvent.click(screen.getByRole("button", { name: "Delete play history" }));
    expect((await screen.findByTestId("your-data-result")).textContent).not.toContain(SENTENCE);
  });

  // C4 review r2 B1 (c4h): the two reports the backend can now give when an apply lands while the Trial-gate files
  // go (data_clear c4g / c4g2: the Trial store is the last file under its gate). Neither shows the "deleted" note
  // beside the "Trial results were kept" refusal. Screen-only: this feeds fixed reports, so it cannot catch a
  // regression in the backend's delete order; data_clear c4g / c4g2 pin that order.
  it("never shows 'Trial results were deleted' beside 'so the Trial results were kept' (review r2 B1)", async () => {
    const DELETED = "Trial results were deleted, and a change was applied around the same moment.";
    const KEPT = "so the Trial results were kept";
    const keptRun: ClearReport = {
      ...REPORT,
      deleted: ["experiments.json.tmp"],
      not_attempted: ["experiments.json", "sessions.json"],
      stopped: [{ code: "trials_tied_to_changes", detail: "dev text", files: [] }],
      complete: false,
      trials_went_during_apply: false,
    };
    const deletedRun: ClearReport = { ...REPORT, deleted: ["experiments.json.tmp", "experiments.json"], trials_went_during_apply: true };
    const seen: string[] = [];
    for (const detail of [keptRun, deletedRun]) {
      answer(PLAN, { status: "done", detail });
      const view = render(<YourData />);
      await openPlan();
      fireEvent.click(screen.getByLabelText("I understand"));
      fireEvent.click(screen.getByRole("button", { name: "Delete play history" }));
      const text = (await screen.findByTestId("your-data-result")).textContent ?? "";
      expect(text.includes(DELETED) && text.includes(KEPT)).toBe(false);
      seen.push(text);
      view.unmount();
    }
    expect(seen[0]).toContain(KEPT);
    expect(seen[0]).not.toContain(DELETED);
    expect(seen[1]).toContain(DELETED);
    expect(seen[1]).not.toContain(KEPT);
  });

  it("a stopped run says it stopped, never 'Deleted N files.', names why, and offers no reload (review r2)", async () => {
    window.localStorage.setItem("compy_last_check_v1", "x");
    const stopped: ClearReport = {
      ...REPORT,
      deleted: ["sessions.json"],
      not_attempted: ["care/incident-observer.json"],
      stopped: [{ code: "trial_running", detail: "dev text", files: [] }],
      complete: false,
    };
    answer(PLAN, { status: "done", detail: stopped });
    render(<YourData />);
    await openPlan();
    fireEvent.click(screen.getByLabelText("I understand"));
    fireEvent.click(screen.getByRole("button", { name: "Delete play history" }));
    const result = await screen.findByTestId("your-data-result");
    expect(screen.getByText(/^Stopped part way, because of what is listed below\. Files deleted: 1\. Files not tried: 1\./)).toBeTruthy();
    expect(screen.queryByText(/^Deleted \d+ files?\.$/)).toBeNull();
    expect(result.textContent).toContain("A Trial is starting");
    expect(result.textContent).not.toContain("dev text");
    expect(screen.getByTestId("your-data-files").textContent).toContain("Not tried: care/incident-observer.json");
    expect(screen.queryByTestId("your-data-reload")).toBeNull();
    expect(window.localStorage.getItem("compy_last_check_v1")).toBe("x");
  });

  it("a failed delete shows the screen's own words, never the backend's text", async () => {
    const failed: ClearReport = {
      ...REPORT,
      deleted: ["sessions.json"],
      failed: [{ rel: "care/incident-observer.json", error: "The process cannot access the file because it is being used by another process. (os error 32)" }],
      complete: false,
    };
    answer(PLAN, { status: "done", detail: failed });
    render(<YourData />);
    await openPlan();
    fireEvent.click(screen.getByLabelText("I understand"));
    fireEvent.click(screen.getByRole("button", { name: "Delete play history" }));
    const files = (await screen.findByTestId("your-data-files")).textContent ?? "";
    expect(files).toContain("Could not delete: care/incident-observer.json (another program has it open)");
    expect(files).not.toContain("The process cannot access");
  });

  it("a refused plan shows each reason in words, never the backend's text, and has no delete button", async () => {
    answer(
      { ...PLAN, delete: [], refusals: [{ code: "capture_running", detail: "dev text", files: [] }, { code: "brand_new", detail: "dev text", files: [] }] },
      null,
    );
    render(<YourData />);
    fireEvent.click(screen.getByRole("button", { name: "Show what would be deleted" }));
    const box = await screen.findByTestId("your-data-refused");
    expect(box.textContent).toContain("Compy didn't delete anything");
    expect(box.textContent).toContain("Compy is measuring a game right now.");
    expect(box.textContent).toContain("reason code brand_new");
    expect(box.textContent).not.toContain("dev text");
    expect(screen.queryByRole("button", { name: "Delete play history" })).toBeNull();
  });

  it("a refusal at delete time and a changed folder delete nothing on screen and say so", async () => {
    answer(PLAN, { status: "refused", detail: [{ code: "trial_running", detail: "", files: [] }] });
    render(<YourData />);
    await openPlan();
    fireEvent.click(screen.getByLabelText("I understand"));
    fireEvent.click(screen.getByRole("button", { name: "Delete play history" }));
    expect((await screen.findByTestId("your-data-refused")).textContent).toContain("A Trial is starting");
    cleanup();
    answer(PLAN, { status: "plan_changed" });
    render(<YourData />);
    await openPlan();
    fireEvent.click(screen.getByLabelText("I understand"));
    fireEvent.click(screen.getByRole("button", { name: "Delete play history" }));
    await waitFor(() => expect(screen.getByText(/changed since the last list, so nothing was deleted/)).toBeTruthy());
    // the box must be ticked again for the new list
    expect(screen.getByRole("button", { name: "Delete play history" })).toBeDisabled();
  });

  it("a command error after the delete started does not claim nothing was deleted", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "plan_clear_play_history" ? Promise.resolve(PLAN) : Promise.reject("Compy couldn't finish clearing your play history"),
    );
    render(<YourData />);
    await openPlan();
    fireEvent.click(screen.getByLabelText("I understand"));
    fireEvent.click(screen.getByRole("button", { name: "Delete play history" }));
    expect((await screen.findByTestId("your-data-error")).textContent).toContain("Some files may already be deleted");
  });
});

// C2b: "Clear everything Compy keeps".
describe("Your data: clear everything", () => {
  const EVERY_PLAN: ClearPlan = {
    ...PLAN,
    scope: "everything",
    delete: [
      { rel: "history.json.bak", row_id: "ledger-backup", store: "ledger-backup", category: "undo", size: 10, modified_ms: 1 },
      { rel: "history.json", row_id: "ledger-main", store: "ledger-main", category: "undo", size: 10, modified_ms: 1 },
      { rel: "sessions.json", row_id: "sessions", store: "sessions", category: "play_history", size: 4096, modified_ms: 1 },
      { rel: "support/evidence.jsonl", row_id: "support-evidence", store: "support-evidence", category: "support", size: 100, modified_ms: 1 },
    ],
    kept: [{ rel: "license.key", code: "licence_kept", detail: "dev text" }],
    webview: [
      { key: "compy_onboarded_v1", prefix: false, session_storage: false },
      { key: "compy_theme", prefix: false, session_storage: false },
    ],
    fingerprint: "fp-all",
  };
  const EVERY_REPORT: ClearReport = {
    ...REPORT,
    scope: "everything",
    deleted: EVERY_PLAN.delete.map((d) => d.rel),
    kept: EVERY_PLAN.kept,
    webview: EVERY_PLAN.webview,
  };
  const REFUSED: ClearPlan = {
    ...EVERY_PLAN,
    delete: [],
    refusals: [{ code: "changes_applied", detail: "dev text", files: [] }],
    applied_changes: ["Core parking", "Game mode"],
    applied_settings: [
      { rec_id: "core-parking", title: "Core parking", records: 1 },
      { rec_id: "game-mode", title: "Game mode", records: 1 },
    ],
    offer_undo_all: true,
  };

  function everything(handlers: Record<string, (args?: Record<string, unknown>) => unknown>) {
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      const h = handlers[cmd];
      if (!h) return Promise.reject(new Error(`unexpected ${cmd}`));
      try {
        return Promise.resolve(h(args));
      } catch (e) {
        return Promise.reject(e);
      }
    });
  }

  const openEverything = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Show what clearing everything would delete" }));
  };

  it("refuses while changes are applied, names them, and 'Undo them first' undoes newest first without clearing", async () => {
    const undone: unknown[] = [];
    everything({
      get_clear_status: () => ({ roll_forward: null, record: "none", abandoned_code: null, webview: [] }),
      plan_clear_everything: () => REFUSED,
      get_applied_changes: () => [
        { id: "old", rec_id: "game-mode", rec_title: "Game mode", status: "applied", applied_at: "2026-11-01T00:00:00Z" },
        { id: "new", rec_id: "core-parking", rec_title: "Core parking", status: "applied", applied_at: "2026-11-02T00:00:00Z" },
        { id: "done", rec_id: "power-plan", rec_title: "Power plan", status: "rolled_back", applied_at: "2026-11-03T00:00:00Z" },
      ],
      rollback_change: (args) => {
        undone.push(args?.changeId);
        if (args?.changeId === "old") throw new Error("declined at the admin prompt");
        return null;
      },
    });
    render(<YourData />);
    await openEverything();
    const box = await screen.findByTestId("your-data-refused");
    expect(box.textContent).toContain("Changes Compy made are still in place");
    // C5a: one line per setting.
    const applied = screen.getByTestId("your-data-applied");
    expect([...applied.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Core parking", "Game mode"]);
    expect(screen.queryByRole("button", { name: "Delete everything" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo them first" }));
    await waitFor(() => expect(screen.getByTestId("your-data-undo-results").textContent).toContain("Press Check again"));
    expect(undone).toEqual(["new", "old"]);
    const results = screen.getByTestId("your-data-undo-results").textContent ?? "";
    expect(results).toContain("Undone: Core parking");
    expect(results).toContain("Couldn't undo: Game mode");
    expect(invokeMock.mock.calls.map((c) => c[0])).not.toContain("clear_everything");
  });

  // C5a. Break checks: render one line per record (applied_changes) instead of per setting -> the list has 4 lines
  // and this fails; show progress per record (no grouping) -> "2 of 3 records undone" is missing, fails.
  it("lists each setting once with its record count, says the totals, and reports the undo per setting", async () => {
    const undone: unknown[] = [];
    const GROUPED: ClearPlan = {
      ...REFUSED,
      applied_changes: ["Enable Windows Game Mode", "Enable Windows Game Mode", "Enable Windows Game Mode", "Trim Windows visual effects"],
      applied_settings: [
        { rec_id: "game-mode", title: "Enable Windows Game Mode", records: 3 },
        { rec_id: "visual-effects", title: "Trim Windows visual effects", records: 1 },
      ],
    };
    const row = (id: string, rec: string, title: string, day: number) => ({
      id,
      rec_id: rec,
      rec_title: title,
      status: "applied",
      applied_at: `2026-11-0${day}T00:00:00Z`,
    });
    everything({
      get_clear_status: () => ({ roll_forward: null, record: "none", abandoned_code: null, webview: [] }),
      plan_clear_everything: () => GROUPED,
      get_applied_changes: () => [
        row("v1", "visual-effects", "Trim Windows visual effects", 1),
        row("g1", "game-mode", "Game mode", 2), // an older title: "Couldn't undo" names the setting's line instead
        row("g2", "game-mode", "Enable Windows Game Mode", 3),
        row("g3", "game-mode", "Enable Windows Game Mode", 4),
      ],
      rollback_change: (args) => {
        undone.push(args?.changeId);
        if (args?.changeId === "g1") throw new Error("declined at the admin prompt");
        return null;
      },
    });
    render(<YourData />);
    await openEverything();
    const applied = await screen.findByTestId("your-data-applied");
    expect([...applied.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "Enable Windows Game Mode (3 records)",
      "Trim Windows visual effects",
    ]);
    expect(applied.textContent).toContain("Settings: 2. Records: 4.");
    const explain = screen.getByTestId("your-data-undo").textContent ?? "";
    expect(explain).toContain("records: 4, across settings: 2");
    expect(applied.textContent).toContain("Not undone yet:");
    // C5 review B1: the explanation says what each undo does, never an outcome. Break check: restore "A setting
    // whose records are all undone is back at the value it had before Compy first changed it" -> fails.
    expect(explain).toContain("A setting that needs administrator rights asks Windows for permission once for each of its records.");
    expect(explain).toContain("fails or that you decline");
    expect(explain).toContain("Each record's undo puts back what Compy saved just before that record's change, newest first, so a setting's oldest record is undone last.");
    expect(explain).not.toContain("before Compy first changed it");
    fireEvent.click(screen.getByRole("button", { name: "Undo them first" }));
    await waitFor(() => expect(screen.getByTestId("your-data-undo-results").textContent).toContain("Press Check again"));
    // One rollback per record, newest first, stopping at the first failure.
    expect(undone).toEqual(["g3", "g2", "g1"]);
    const results = screen.getByTestId("your-data-undo-results").textContent ?? "";
    expect(results).toContain("Enable Windows Game Mode: 2 of 3 records undone");
    expect(results).toContain("Couldn't undo: Enable Windows Game Mode");
    expect(results).not.toContain("Trim Windows visual effects");
    expect(invokeMock.mock.calls.map((c) => c[0])).not.toContain("clear_everything");
  });

  it("the licence box re-plans; the delete sends the shown fingerprint and choice; afterwards it asks to close and reopen", async () => {
    window.localStorage.setItem("compy_onboarded_v1", "1");
    window.localStorage.setItem("compy_theme", "dark");
    window.localStorage.setItem("someone_elses_key", "x");
    const plans: unknown[] = [];
    everything({
      get_clear_status: () => ({ roll_forward: null, record: "none", abandoned_code: null, webview: [] }),
      plan_clear_everything: (args) => {
        plans.push(args?.removeLicence);
        return args?.removeLicence
          ? { ...EVERY_PLAN, kept: [], delete: [...EVERY_PLAN.delete, { rel: "license.key", row_id: "license", store: "license", category: "choices", size: 5, modified_ms: 1 }], fingerprint: "fp-lic" }
          : EVERY_PLAN;
      },
      clear_everything: () => ({ status: "done", detail: { ...EVERY_REPORT, deleted: [...EVERY_REPORT.deleted, "license.key"] } }),
      acknowledge_clear: () => null,
    });
    render(<YourData />);
    await openEverything();
    await screen.findByTestId("your-data-confirm");
    expect(screen.getByText("Delete everything Compy keeps?")).toBeTruthy();
    expect(screen.getByTestId("your-data-delete-list").textContent).toContain("Your change history and its backup copy");
    expect(screen.getByTestId("your-data-kept-list").textContent).not.toContain("can still be undone");
    fireEvent.click(screen.getByLabelText("Also remove my Compy Pro licence from this PC"));
    await waitFor(() => expect(screen.getByTestId("your-data-delete-list").textContent).toContain("Your Compy Pro licence"));
    expect(plans).toEqual([false, true]);
    fireEvent.click(screen.getByLabelText("I understand"));
    fireEvent.click(screen.getByRole("button", { name: "Delete everything" }));
    await screen.findByTestId("your-data-result");
    expect(invokeMock).toHaveBeenCalledWith("clear_everything", { fingerprint: "fp-lic", removeLicence: true });
    expect(invokeMock).toHaveBeenCalledWith("acknowledge_clear");
    expect(window.localStorage.getItem("compy_onboarded_v1")).toBeNull();
    expect(window.localStorage.getItem("compy_theme")).toBeNull();
    expect(window.localStorage.getItem("someone_elses_key")).toBe("x");
    expect(screen.getByTestId("your-data-reopen").textContent).toContain("Close Compy and open it again");
    expect(screen.queryByTestId("your-data-reload")).toBeNull();
  });

  it("an unfinished clear keeps the window's notes, does not acknowledge, and says it needs confirming again", async () => {
    window.localStorage.setItem("compy_theme", "dark");
    everything({
      get_clear_status: () => ({ roll_forward: null, record: "none", abandoned_code: null, webview: [] }),
      plan_clear_everything: () => EVERY_PLAN,
      clear_everything: () => ({
        status: "done",
        detail: { ...EVERY_REPORT, deleted: ["history.json.bak"], failed: [{ rel: "history.json", error: "Access is denied. (os error 5)" }], not_attempted: ["sessions.json"], complete: false },
      }),
    });
    render(<YourData />);
    await openEverything();
    await screen.findByTestId("your-data-confirm");
    fireEvent.click(screen.getByLabelText("I understand"));
    fireEvent.click(screen.getByRole("button", { name: "Delete everything" }));
    const result = await screen.findByTestId("your-data-result");
    expect(result.textContent).toContain("Nothing more will be deleted until you confirm it again");
    expect(result.textContent).toContain("Could not delete: history.json (Windows refused access)");
    expect(invokeMock.mock.calls.map((c) => c[0])).not.toContain("acknowledge_clear");
    expect(window.localStorage.getItem("compy_theme")).toBe("dark");
    expect(screen.queryByTestId("your-data-reopen")).toBeNull();
  });

  it("the licence box never carries over: tick, Cancel, reopen asks for a plan without it (review B2)", async () => {
    const plans: unknown[] = [];
    everything({
      get_clear_status: () => ({ roll_forward: null, record: "none", abandoned_code: null, webview: [] }),
      plan_clear_everything: (args) => {
        plans.push(args?.removeLicence);
        return EVERY_PLAN;
      },
    });
    render(<YourData />);
    await openEverything();
    await screen.findByTestId("your-data-confirm");
    fireEvent.click(screen.getByLabelText("Also remove my Compy Pro licence from this PC"));
    await waitFor(() => expect(plans).toEqual([false, true]));
    expect(screen.getByTestId("your-data-everything-warnings").textContent).toContain("you will need your licence key");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await openEverything();
    await screen.findByTestId("your-data-confirm");
    await waitFor(() => expect(plans).toEqual([false, true, false]));
    expect((screen.getByLabelText("Also remove my Compy Pro licence from this PC") as HTMLInputElement).checked).toBe(false);
    const warnings = screen.getByTestId("your-data-everything-warnings").textContent ?? "";
    expect(warnings).toContain("no record on this PC of anything Compy ever changed");
    expect(warnings).toContain("admin-rights step");
    expect(warnings).toContain("finishes it the next time it starts, without asking again");
    expect(warnings).not.toContain("licence key");
  });

  it("an unfinished clear whose record could not be updated says the next start may finish it (review B4)", async () => {
    everything({
      get_clear_status: () => ({ roll_forward: null, record: "none", abandoned_code: null, webview: [] }),
      plan_clear_everything: () => EVERY_PLAN,
      clear_everything: () => ({
        status: "done",
        detail: { ...EVERY_REPORT, deleted: ["history.json.bak"], failed: [{ rel: "sessions.json", error: "x" }], complete: false, record_not_updated: true },
      }),
    });
    render(<YourData />);
    await openEverything();
    await screen.findByTestId("your-data-confirm");
    fireEvent.click(screen.getByLabelText("I understand"));
    fireEvent.click(screen.getByRole("button", { name: "Delete everything" }));
    const result = await screen.findByTestId("your-data-result");
    expect(result.textContent).toContain("When it next starts, it may finish deleting the files you confirmed");
    expect(result.textContent).not.toContain("Nothing more will be deleted until you confirm it again");
  });

  // C2b review r2 follow-up. Break check: drop the record_not_advanced branch in YourData.tsx -> the generic
  // ackFailed line shows instead and this fails.
  it("a complete clear whose record could not be advanced says so instead of the generic note line", async () => {
    everything({
      get_clear_status: () => ({ roll_forward: null, record: "none", abandoned_code: null, webview: [] }),
      plan_clear_everything: () => EVERY_PLAN,
      clear_everything: () => ({ status: "done", detail: { ...EVERY_REPORT, complete: true, record_not_advanced: true } }),
      acknowledge_clear: () => {
        throw new Error("no_finished_clear");
      },
    });
    render(<YourData />);
    await openEverything();
    await screen.findByTestId("your-data-confirm");
    fireEvent.click(screen.getByLabelText("I understand"));
    fireEvent.click(screen.getByRole("button", { name: "Delete everything" }));
    const result = await screen.findByTestId("your-data-result");
    expect(result.textContent).toContain("deletes nothing saved after this clear began");
    expect(result.textContent).not.toContain("couldn't remove its note");
  });

  it("an abandoned clear from start-up is said in words and can be dismissed", async () => {
    let record = "abandoned";
    everything({
      get_clear_status: () => ({
        roll_forward: { status: "abandoned", detail: { code: "changes_applied", detail: "dev text" } },
        record,
        abandoned_code: "changes_applied",
        webview: [],
      }),
      acknowledge_clear: () => {
        record = "none";
        return null;
      },
    });
    render(<YourData />);
    const status = await screen.findByTestId("your-data-status");
    expect(status.textContent).toContain("a change Compy made is in place again. Your change history was kept.");
    expect(status.textContent).not.toContain("dev text");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("acknowledge_clear"));
  });
});
