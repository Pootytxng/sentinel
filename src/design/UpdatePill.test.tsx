// Live-updater guards: consent-first, honest offer state, serialized checks, native-resource
// cleanup, and restart-only recovery after a package has already installed.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const updaterMocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: updaterMocks.check,
}));
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: updaterMocks.relaunch,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: updaterMocks.invoke,
}));

import { UpdatePill, changelogItems } from "./UpdatePill";
import updaterCapability from "../../src-tauri/capabilities/updater.json";

const RECHECK_MS = 4 * 60 * 60 * 1000;

type MockUpdate = {
  version: string;
  body: string | null;
  downloadAndInstall: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function makeUpdate(
  version = "9.9.9",
  downloadAndInstall = vi.fn(async (cb?: (ev: unknown) => void) => {
    cb?.({ event: "Started", data: { contentLength: 100 } });
    cb?.({ event: "Progress", data: { chunkLength: 50 } });
    cb?.({ event: "Finished" });
  }),
): MockUpdate {
  return {
    version,
    body: "notes",
    downloadAndInstall,
    close: vi.fn(async () => {}),
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  updaterMocks.check.mockReset();
  updaterMocks.relaunch.mockReset();
  updaterMocks.invoke.mockReset();
  updaterMocks.invoke.mockResolvedValue(undefined);
});

describe("UpdatePill", () => {
  it("grants only the updater operations the hook actually calls", () => {
    expect(updaterCapability.permissions).toEqual([
      "updater:allow-check",
      "updater:allow-download-and-install",
      "process:allow-restart",
    ]);
  });

  it("renders nothing when no update is available — no fake chrome", async () => {
    updaterMocks.check.mockResolvedValue(null);
    const { container } = render(<UpdatePill />);
    await act(async () => {});
    expect(container.firstChild).toBeNull();
  });

  it("an available update wears the attention state, not the quiet outline", async () => {
    // Owner ask 2026-08-13: a tester's pending update sat unnoticed because the offer read as
    // topbar chrome. Available must carry v2-update-avail (filled pill + pulsing LED in CSS);
    // busy/error phases must NOT — attention is for the state that needs a decision.
    const update = makeUpdate();
    updaterMocks.check.mockResolvedValue(update);
    render(<UpdatePill />);
    const pill = await screen.findByText(/update ready · v9\.9\.9/);
    expect(pill.closest("button")?.className).toContain("v2-update-avail");
  });

  it("renders release notes as a plain what's-new list, version prefix stripped", async () => {
    const update = makeUpdate();
    update.body =
      "v9.9.9: the intake band goes back to default OFF; the popout modal contract gains its guard";
    updaterMocks.check.mockResolvedValue(update);
    render(<UpdatePill />);
    fireEvent.click(await screen.findByText(/update ready/));
    expect(screen.getByText("What's new")).toBeTruthy();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      "the intake band goes back to default OFF",
      "the popout modal contract gains its guard",
    ]);
  });

  it("changelogItems never returns empty for non-empty notes", () => {
    expect(changelogItems("- a\n- b")).toEqual(["a", "b"]);
    expect(changelogItems("1. first\n2) second")).toEqual(["first", "second"]);
    expect(changelogItems(";;;")).toEqual([";;;"]);
    expect(changelogItems("just one plain sentence")).toEqual(["just one plain sentence"]);
  });

  it("offers → consent → downloads → installs → relaunches; never downloads before consent", async () => {
    const update = makeUpdate();
    updaterMocks.check.mockResolvedValue(update);
    updaterMocks.relaunch.mockResolvedValue(undefined);
    render(<UpdatePill />);
    await waitFor(() => screen.getByText(/update ready · v9\.9\.9/));
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/update ready/));
    fireEvent.click(screen.getByText("Update now"));
    await waitFor(() => expect(update.downloadAndInstall).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(updaterMocks.relaunch).toHaveBeenCalledTimes(1));
    expect(updaterMocks.invoke).toHaveBeenCalledWith("begin_update_restart");
  });

  it.each(["active", "restore-pending", "unreadable"])(
    "blocks download and relaunch when Gaming Mode state is %s",
    async (state) => {
      const update = makeUpdate();
      updaterMocks.check.mockResolvedValue(update);
      updaterMocks.invoke.mockRejectedValueOnce(
        new Error(`Gaming Mode contract is ${state}; restore it first`),
      );

      render(<UpdatePill />);
      await waitFor(() => screen.getByText(/update ready/));
      fireEvent.click(screen.getByText(/update ready/));
      fireEvent.click(screen.getByText("Update now"));

      await screen.findByRole("button", { name: /finish Gaming Mode before updating/i });
      expect(update.downloadAndInstall).not.toHaveBeenCalled();
      expect(updaterMocks.relaunch).not.toHaveBeenCalled();
    },
  );

  it("Later hides the current version but a newly offered version becomes visible", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const first = makeUpdate("9.9.9");
    const second = makeUpdate("10.0.0");
    updaterMocks.check.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    const { container } = render(<UpdatePill />);
    await waitFor(() => screen.getByText(/update ready · v9\.9\.9/));
    fireEvent.click(screen.getByText(/update ready/));
    fireEvent.click(screen.getByText("Later"));
    expect(container.querySelector(".v2-update")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECHECK_MS);
    });

    await waitFor(() => screen.getByText(/update ready · v10\.0\.0/));
    expect(first.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no update", null],
    ["failed recheck", new Error("offline")],
  ])("clears a stale offer after %s", async (_label, result) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const update = makeUpdate();
    if (result instanceof Error) {
      updaterMocks.check.mockResolvedValueOnce(update).mockRejectedValueOnce(result);
    } else {
      updaterMocks.check.mockResolvedValueOnce(update).mockResolvedValueOnce(result);
    }

    const { container } = render(<UpdatePill />);
    await waitFor(() => screen.getByText(/update ready/));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECHECK_MS);
    });

    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(update.close).toHaveBeenCalledTimes(1);
  });

  it("serializes update checks so interval ticks cannot overlap", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let resolveCheck!: (value: null) => void;
    updaterMocks.check.mockImplementation(
      () => new Promise<null>((resolve) => (resolveCheck = resolve)),
    );

    render(<UpdatePill />);
    expect(updaterMocks.check).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECHECK_MS * 2);
    });
    expect(updaterMocks.check).toHaveBeenCalledTimes(1);

    await act(async () => resolveCheck(null));
  });

  it("closes an owned updater handle when the component unmounts", async () => {
    const update = makeUpdate();
    updaterMocks.check.mockResolvedValue(update);
    const view = render(<UpdatePill />);
    await waitFor(() => screen.getByText(/update ready/));

    view.unmount();

    await waitFor(() => expect(update.close).toHaveBeenCalledTimes(1));
  });

  it("closes a check result that resolves after unmount", async () => {
    let resolveCheck!: (value: MockUpdate) => void;
    updaterMocks.check.mockImplementation(
      () => new Promise<MockUpdate>((resolve) => (resolveCheck = resolve)),
    );
    const update = makeUpdate();
    const view = render(<UpdatePill />);

    view.unmount();
    await act(async () => resolveCheck(update));

    expect(update.close).toHaveBeenCalledTimes(1);
  });

  it("failed download/install surfaces retry — never a silent stall", async () => {
    const downloadAndInstall = vi.fn(async () => {
      throw new Error("boom");
    });
    const update = makeUpdate("9.9.9", downloadAndInstall);
    updaterMocks.check.mockResolvedValue(update);
    render(<UpdatePill />);
    await waitFor(() => screen.getByText(/update ready/));
    fireEvent.click(screen.getByText(/update ready/));
    fireEvent.click(screen.getByText("Update now"));
    await waitFor(() => screen.getByText(/update failed · retry/));
    expect(updaterMocks.relaunch).not.toHaveBeenCalled();
    expect(updaterMocks.invoke).toHaveBeenCalledWith("cancel_update_restart");
  });

  it("relaunch failure becomes restart-required; retry restarts without downloading again", async () => {
    const update = makeUpdate();
    updaterMocks.check.mockResolvedValue(update);
    updaterMocks.relaunch
      .mockRejectedValueOnce(new Error("restart blocked"))
      .mockResolvedValueOnce(undefined);

    render(<UpdatePill />);
    await waitFor(() => screen.getByText(/update ready/));
    fireEvent.click(screen.getByText(/update ready/));
    fireEvent.click(screen.getByText("Update now"));

    const restart = await screen.findByRole("button", {
      name: /update installed · restart Compy/i,
    });
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(updaterMocks.relaunch).toHaveBeenCalledTimes(1);

    fireEvent.click(restart);
    await waitFor(() => expect(updaterMocks.relaunch).toHaveBeenCalledTimes(2));
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
  });
});
