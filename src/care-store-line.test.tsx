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
const STOPPED_LINE = "Compy couldn't save this; the crash notice may show again";

function Harness({ invokeFn }: { invokeFn: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }) {
  const store = useCareStore();
  return (
    <>
      <button
        onClick={() =>
          store.persist("dismissed:inc-1", () => invokeFn("dismiss_care_incident", { incidentId: "inc-1" }))
        }
      >
        Not now
      </button>
      <button
        onClick={() =>
          store.persist("opened:inc-2", () => invokeFn("mark_care_incident_opened", { incidentId: "inc-2" }))
        }
      >
        Find out why (inc-2)
      </button>
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
      await vi.advanceTimersByTimeAsync(CARE_SAVE_RETRY_MS[0]);
    });
    expect(invokeFn).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps trying with backoff, and keeps the line while every try fails", async () => {
    vi.useFakeTimers();
    const invokeFn = vi.fn().mockRejectedValue("care_save_failed");
    render(<Harness invokeFn={invokeFn} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Not now"));
    });
    for (const wait of CARE_SAVE_RETRY_MS) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(wait);
      });
    }
    expect(invokeFn).toHaveBeenCalledTimes(1 + CARE_SAVE_RETRY_MS.length);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(invokeFn, "retries stop after the last backoff step").toHaveBeenCalledTimes(1 + CARE_SAVE_RETRY_MS.length);
    // CR-care-line-truth: no more tries are coming, so the line no longer promises one.
    expect(screen.getByRole("status").textContent).toBe(STOPPED_LINE);
  });

  it("says it'll try again only while a try is still coming (CR-care-line-truth)", async () => {
    vi.useFakeTimers();
    const invokeFn = vi.fn().mockRejectedValue("care_save_failed");
    render(<Harness invokeFn={invokeFn} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Not now"));
    });
    // Every step before the last one still has a try coming.
    for (const wait of CARE_SAVE_RETRY_MS.slice(0, -1)) {
      expect(screen.getByRole("status").textContent).toBe(SAVE_LINE);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(wait);
      });
    }
    expect(screen.getByRole("status").textContent).toBe(SAVE_LINE);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CARE_SAVE_RETRY_MS[CARE_SAVE_RETRY_MS.length - 1]);
    });
    expect(screen.getByRole("status").textContent).toBe(STOPPED_LINE);
    // The user making the same choice again is a fresh try: it lands, and the line goes.
    invokeFn.mockResolvedValue(undefined);
    await act(async () => {
      fireEvent.click(screen.getByText("Not now"));
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a different choice saving does not clear one still unsaved (CR-care-line-truth)", async () => {
    vi.useFakeTimers();
    // inc-1's dismiss keeps failing; inc-2's open saves first time.
    const invokeFn = vi.fn((cmd: string) =>
      cmd === "dismiss_care_incident" ? Promise.reject("care_save_failed") : Promise.resolve(undefined),
    );
    render(<Harness invokeFn={invokeFn} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Not now"));
    });
    expect(screen.getByRole("status").textContent).toBe(SAVE_LINE);
    await act(async () => {
      fireEvent.click(screen.getByText("Find out why (inc-2)"));
    });
    expect(invokeFn).toHaveBeenCalledWith("mark_care_incident_opened", { incidentId: "inc-2" });
    expect(screen.getByRole("status").textContent, "inc-1's dismiss is still unsaved").toBe(SAVE_LINE);
    // When inc-1's dismiss finally lands, nothing is unsaved and the line goes.
    invokeFn.mockImplementation(() => Promise.resolve(undefined));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CARE_SAVE_RETRY_MS[0]);
    });
    expect(screen.queryByRole("status")).toBeNull();
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
    const keyed = { dismiss_care_incident: "dismissed", mark_care_incident_opened: "opened" } as const;
    for (const [cmd, key] of Object.entries(keyed)) {
      const calls = app.match(new RegExp(`invoke\\("${cmd}"`, "g")) ?? [];
      expect(calls.length, `${cmd} is invoked more than once, outside the store that reports failures`).toBe(1);
      // Keyed per choice and incident (CR-care-line-truth), so one save never clears another's line.
      expect(app, `${cmd} no longer saves through the store, keyed by its own choice and incident`)
        .toContain(`careStore.persist(\`${key}:\${incidentId}\`, () => invoke("${cmd}", { incidentId }))`);
    }
    expect(app, "the line is no longer rendered").toContain("<CareStoreLine trouble={careStore.trouble} />");
    const read = app.match(/invoke<PendingCareIncident \| null>\("get_pending_care_incident"\)([\s\S]*?)\}, \[/)?.[1] ?? "";
    expect(read, "a failed read of the crash notice is silent again").toContain("careReadFailed()");
  });
});
