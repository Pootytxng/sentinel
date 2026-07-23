// Live-updater guards (train 2026-07-22): no chrome without a real update (no fake
// affordances), consent-first (nothing downloads until "Update now"), Later hides for
// this run only, and a failed install surfaces a retry — never a silent stall.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";

const relaunch = vi.fn(async () => {});
let nextUpdate: Record<string, unknown> | null = null;
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(async () => nextUpdate),
}));
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: () => relaunch(),
}));

import { UpdatePill } from "./UpdatePill";

afterEach(() => {
  cleanup();
  nextUpdate = null;
  relaunch.mockClear();
});

const okInstall = vi.fn(async (cb?: (ev: unknown) => void) => {
  cb?.({ event: "Started", data: { contentLength: 100 } });
  cb?.({ event: "Progress", data: { chunkLength: 50 } });
  cb?.({ event: "Finished" });
});

describe("UpdatePill", () => {
  it("renders nothing when no update is available — no fake chrome", async () => {
    const { container } = render(<UpdatePill />);
    await act(async () => {});
    expect(container.firstChild).toBeNull();
  });

  it("offers → consent → downloads → installs → relaunches; never downloads before consent", async () => {
    nextUpdate = { version: "9.9.9", body: "notes", downloadAndInstall: okInstall };
    render(<UpdatePill />);
    await waitFor(() => screen.getByText(/update ready · v9\.9\.9/));
    expect(okInstall).not.toHaveBeenCalled(); // consent-first: offer alone downloads nothing
    fireEvent.click(screen.getByText(/update ready/));
    fireEvent.click(screen.getByText("Update now"));
    await waitFor(() => expect(okInstall).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(relaunch).toHaveBeenCalled());
  });

  it("Later hides the offer for this run", async () => {
    nextUpdate = { version: "9.9.9", body: null, downloadAndInstall: okInstall };
    const { container } = render(<UpdatePill />);
    await waitFor(() => screen.getByText(/update ready/));
    fireEvent.click(screen.getByText(/update ready/));
    fireEvent.click(screen.getByText("Later"));
    expect(container.querySelector(".v2-update")).toBeNull();
  });

  it("failed install surfaces retry — never a silent stall", async () => {
    nextUpdate = {
      version: "9.9.9",
      body: null,
      downloadAndInstall: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    render(<UpdatePill />);
    await waitFor(() => screen.getByText(/update ready/));
    fireEvent.click(screen.getByText(/update ready/));
    fireEvent.click(screen.getByText("Update now"));
    await waitFor(() => screen.getByText(/update failed · retry/));
    expect(relaunch).not.toHaveBeenCalled();
  });
});
