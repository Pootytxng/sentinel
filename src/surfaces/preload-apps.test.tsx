// Phase-B preload-app removal — FE guards (feature is BUILT DARK; these pin the dark-safety
// contract and the FE↔Rust allowlist id parity so neither side can drift silently).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Fix, { PRELOAD_APPS } from "./Fix";
import { LEDGER_CHANGED_EVENT } from "../types";

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
    //
    // The default 1000 ms budget was still too tight, and failed the pre-push gate twice in a row
    // on 2026-08-11 while passing standing alone — several lanes run their own gates on this one
    // machine, so "how long a scheduled paint takes" is a function of the whole box, not of this
    // component. The budget below is not a guess at how slow the render is; it is a margin wide
    // enough that a loaded machine cannot masquerade as a broken component.
    expect(await screen.findByText("Solitaire Collection", {}, { timeout: 8000 })).toBeTruthy();
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

  // #619: a removal writes the Trust Ledger, so one that lands announces it and runs App's refresh
  // (onChanged); the refusal above does neither.
  it("a removal that lands announces it once, then App's refresh runs", async () => {
    const seen: string[] = [];
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_preload_apps") return Promise.resolve({ armed: true, installed: ["solitaire-collection"] });
      if (cmd === "remove_known_preload_app") {
        seen.push("remove");
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });
    const on = () => seen.push("event");
    window.addEventListener(LEDGER_CHANGED_EVENT, on);
    const onChanged = vi.fn(() => {
      seen.push("app-refresh");
    });
    render(<Fix {...baseProps} onChanged={onChanged} />);
    fireEvent.click(await screen.findByText("Preinstalled apps"));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await screen.findByText("Removed · undo in History");
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    window.removeEventListener(LEDGER_CHANGED_EVENT, on);
    expect(seen).toEqual(["remove", "event", "app-refresh"]);
  });

  it("a refused removal announces nothing and skips App's refresh", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_preload_apps") return Promise.resolve({ armed: true, installed: ["bing-news"] });
      if (cmd === "remove_known_preload_app") return Promise.reject(new Error("refused"));
      return Promise.resolve(null);
    });
    const seen: string[] = [];
    const on = () => seen.push("event");
    window.addEventListener(LEDGER_CHANGED_EVENT, on);
    const onChanged = vi.fn();
    render(<Fix {...baseProps} onChanged={onChanged} />);
    fireEvent.click(await screen.findByText("Preinstalled apps"));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await screen.findByText("Couldn't remove it — nothing changed; try again.");
    window.removeEventListener(LEDGER_CHANGED_EVENT, on);
    expect(seen).toEqual([]);
    expect(onChanged).not.toHaveBeenCalled();
  });
});
