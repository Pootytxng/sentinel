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
        { id: "old", rec_title: "Game mode", status: "applied", applied_at: "2026-11-01T00:00:00Z" },
        { id: "new", rec_title: "Core parking", status: "applied", applied_at: "2026-11-02T00:00:00Z" },
        { id: "done", rec_title: "Power plan", status: "rolled_back", applied_at: "2026-11-03T00:00:00Z" },
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
    expect(screen.getByTestId("your-data-applied").textContent).toContain("Core parking, Game mode");
    expect(screen.queryByRole("button", { name: "Delete everything" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo them first" }));
    await waitFor(() => expect(screen.getByTestId("your-data-undo-results").textContent).toContain("Press Check again"));
    expect(undone).toEqual(["new", "old"]);
    const results = screen.getByTestId("your-data-undo-results").textContent ?? "";
    expect(results).toContain("Undone: Core parking");
    expect(results).toContain("Couldn't undo: Game mode");
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
