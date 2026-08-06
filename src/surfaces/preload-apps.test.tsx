// Phase-B preload-app removal — FE guards (feature is BUILT DARK; these pin the dark-safety
// contract and the FE↔Rust allowlist id parity so neither side can drift silently).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Fix, { PRELOAD_APPS } from "./Fix";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const baseProps = {
  recs: [],
  startup: [],
  changes: [],
  busyId: null,
  isAppliable: () => false,
  activeChangeFor: () => undefined,
  onToggleRec: vi.fn(),
  onToggleStartup: vi.fn(),
  onRollback: vi.fn(),
  onApplyBatch: vi.fn().mockResolvedValue({ applied: 0, skipped: [] }),
  onOpenLibrary: vi.fn(),
  vendor: "any" as const,
};

const preloadView = (armed: boolean, installed: string[]) => {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "get_preload_apps") return Promise.resolve({ armed, installed });
    return Promise.resolve(null);
  });
};

describe("PreloadApps (Phase-B, BUILT DARK)", () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset();
  });

  it("contract pin: FE ids literally match the Rust KnownPreloadApp allowlist", () => {
    // Mirrors the Rust side's own literal pin (preload_removal_tests) — a drift on either
    // side fails one of the two suites. Curated set, owner-reviewed before arming.
    expect(PRELOAD_APPS.map((a) => a.id)).toEqual([
      "solitaire-collection",
      "feedback-hub",
      "bing-news",
      "office-hub",
    ]);
  });

  it("dark-safe: renders NOTHING while the backend gate is off", async () => {
    preloadView(false, []);
    render(<Fix {...baseProps} />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("get_preload_apps"));
    expect(screen.queryByText("Preinstalled apps")).toBeNull();
  });

  it("dark-safe: renders NOTHING when the probe itself fails (no Tauri / error)", async () => {
    invokeMock.mockImplementation(() => Promise.reject(new Error("no backend")));
    render(<Fix {...baseProps} />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("get_preload_apps"));
    expect(screen.queryByText("Preinstalled apps")).toBeNull();
  });

  it("armed: lists ONLY the curated apps actually installed for this user", async () => {
    preloadView(true, ["solitaire-collection", "feedback-hub"]);
    render(<Fix {...baseProps} />);
    fireEvent.click(await screen.findByText("Preinstalled apps"));
    // findBy, not getBy: the row list is painted by a state update the click only schedules,
    // so a synchronous read here fails under full-suite load and passes in isolation.
    expect(await screen.findByText("Solitaire Collection")).toBeTruthy();
    expect(screen.getByText("Feedback Hub")).toBeTruthy();
    // Not installed → never offered (no "remove something that isn't there").
    expect(screen.queryByText("Microsoft News")).toBeNull();
    expect(screen.queryByText("Microsoft 365 (Office) hub")).toBeNull();
  });

  it("remove flow: calls the gated command and shows the honest done state", async () => {
    preloadView(true, ["solitaire-collection"]);
    render(<Fix {...baseProps} />);
    fireEvent.click(await screen.findByText("Preinstalled apps"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("remove_known_preload_app", {
        appId: "solitaire-collection",
      }),
    );
    expect(await screen.findByText("Removed · undo in History")).toBeTruthy();
  });

  it("refusal honesty: a failed removal says nothing changed", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_preload_apps")
        return Promise.resolve({ armed: true, installed: ["bing-news"] });
      if (cmd === "remove_known_preload_app")
        return Promise.reject(new Error("Preinstalled-app removal isn't enabled in this build."));
      return Promise.resolve(null);
    });
    render(<Fix {...baseProps} />);
    fireEvent.click(await screen.findByText("Preinstalled apps"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(
      await screen.findByText("Couldn't remove it — nothing changed; try again."),
    ).toBeTruthy();
    // The button is live again — the user can retry.
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
  });
});
