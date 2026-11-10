// CR-care-silent: a failed save of a crash-notice choice used to vanish (`.catch(() => {})`), so
// "Not now" looked done while the record on disk still said otherwise. It now shows one line.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import "./i18n";
import { CARE_SAVE_RETRY_MS, CareStoreLine, useCareStore } from "./care-store-line";

const SAVE_LINE = "Compy couldn't save this; it'll try again";
const READ_LINE = "Compy couldn't check for crash notices; it'll try again";

function Harness({ invokeFn }: { invokeFn: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }) {
  const store = useCareStore(invokeFn);
  return (
    <>
      <button onClick={() => store.persist("dismiss_care_incident", "inc-1")}>Not now</button>
      <button onClick={store.readFailed}>read failed</button>
      <button onClick={store.readOk}>read ok</button>
      <CareStoreLine trouble={store.trouble} />
    </>
  );
}

afterEach(() => vi.useRealTimers());

describe("a crash-notice choice that can't be saved says so (CR-care-silent)", () => {
  it("shows the line when the save fails, and clears it when the retry lands", async () => {
    vi.useFakeTimers();
    const invokeFn = vi
      .fn()
      .mockRejectedValueOnce("care_save_failed")
      .mockResolvedValueOnce(undefined);
    render(<Harness invokeFn={invokeFn} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Not now"));
    });
    expect(screen.getByRole("status").textContent).toBe(SAVE_LINE);
    expect(invokeFn).toHaveBeenCalledWith("dismiss_care_incident", { incidentId: "inc-1" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CARE_SAVE_RETRY_MS);
    });
    expect(invokeFn).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps the line when the retry fails too", async () => {
    vi.useFakeTimers();
    const invokeFn = vi.fn().mockRejectedValue("care_save_failed");
    render(<Harness invokeFn={invokeFn} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Not now"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CARE_SAVE_RETRY_MS);
    });
    expect(invokeFn).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status").textContent).toBe(SAVE_LINE);
  });

  it("says nothing when the save works", async () => {
    const invokeFn = vi.fn().mockResolvedValue(undefined);
    render(<Harness invokeFn={invokeFn} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Not now"));
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("names a read failure separately, and a good read clears it", async () => {
    render(<Harness invokeFn={vi.fn()} />);
    fireEvent.click(screen.getByText("read failed"));
    expect(screen.getByRole("status").textContent).toBe(READ_LINE);
    fireEvent.click(screen.getByText("read ok"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is what App uses: no crash-notice call swallows its failure, and the line is rendered", () => {
    const app = readFileSync(join("src", "App.tsx"), "utf8");
    for (const cmd of ["dismiss_care_incident", "mark_care_incident_opened"]) {
      expect(app, `${cmd} is invoked directly again, outside the store that reports failures`)
        .not.toMatch(new RegExp(`invoke\\("${cmd}"`));
      expect(app).toContain(`careStore.persist("${cmd}", incidentId)`);
    }
    expect(app, "the line is no longer rendered").toContain("<CareStoreLine trouble={careStore.trouble} />");
    const read = app.match(/invoke<PendingCareIncident \| null>\("get_pending_care_incident"\)([\s\S]*?)\}, \[/)?.[1] ?? "";
    expect(read, "a failed read of the crash notice is silent again").toContain("careReadFailed()");
  });
});
