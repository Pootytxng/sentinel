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
    expect(invokeMock).not.toHaveBeenCalled();
    await openPlan();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("plan_clear_play_history");
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
    expect(screen.getByText(/^Not finished: 1 files deleted, 1 could not be deleted, 0 not tried/)).toBeTruthy();
    expect(screen.getByTestId("your-data-files").textContent).toContain("Could not delete: care/incident-observer.json (in use)");
    expect(window.localStorage.getItem("compy_last_check_v1")).toBe("x");
    expect(screen.queryByTestId("your-data-reload")).toBeNull();
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
