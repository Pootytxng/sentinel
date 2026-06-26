import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// use-scan pulls @tauri-apps/api/core at import — stub invoke so jsdom doesn't choke loading the module.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { deriveReverted, rowVerdict, useScan, type AppliedChangeLite } from "./use-scan";
import { invoke } from "@tauri-apps/api/core";
import { invalidateProbe } from "../data/probe-cache";
import type { ReadinessCheck } from "../types";

const invokeMock = vi.mocked(invoke);

const mk = (rec_id: string, opts: Partial<AppliedChangeLite> = {}): AppliedChangeLite => ({
  rec_id,
  rec_title: `${rec_id} title`,
  status: "applied",
  is_still_active: false,
  ...opts,
});

describe("deriveReverted (the flag-class drift core)", () => {
  it("empty in -> empty out", () => {
    expect(deriveReverted([])).toEqual([]);
  });

  it("names an applied-but-inactive change (drifted off)", () => {
    expect(deriveReverted([mk("game-mode")])).toEqual([{ rec_id: "game-mode", title: "game-mode title" }]);
  });

  it("excludes a change that is still active", () => {
    expect(deriveReverted([mk("x", { is_still_active: true })])).toEqual([]);
  });

  it("excludes a non-applied (e.g. rolled-back) change", () => {
    expect(deriveReverted([mk("x", { status: "rolled_back" })])).toEqual([]);
  });

  it("collapses to the NEWEST entry per rec — a re-applied setting that's still on does NOT count", () => {
    // older drifted entry would count alone; the newer still-active entry wins → excluded.
    const out = deriveReverted([mk("gm", { is_still_active: false }), mk("gm", { is_still_active: true })]);
    expect(out).toEqual([]);
  });

  it("the NEWEST entry decides inclusion (old rolled-back, newest drifted -> included)", () => {
    const out = deriveReverted([
      mk("gm", { status: "rolled_back" }),
      mk("gm", { status: "applied", is_still_active: false }),
    ]);
    expect(out).toEqual([{ rec_id: "gm", title: "gm title" }]);
  });

  it("one entry per drifted rec, titled from rec_title", () => {
    const out = deriveReverted([mk("a", { rec_title: "Alpha" }), mk("b", { rec_title: "Beta" })]);
    expect(out).toEqual([
      { rec_id: "a", title: "Alpha" },
      { rec_id: "b", title: "Beta" },
    ]);
  });
});

describe("rowVerdict", () => {
  it("attention -> fix", () => expect(rowVerdict("attention")).toBe("fix"));
  it("ready -> ok", () => expect(rowVerdict("ready")).toBe("ok"));
  it("advisory -> ok", () => expect(rowVerdict("advisory")).toBe("ok"));
  it("any other status -> unknown", () =>
    expect(rowVerdict("skip" as unknown as ReadinessCheck["status"])).toBe("unknown"));
});

// The Optimize/Fixes "gets stuck" fix: a cache:true caller must NOT replay the scan on re-mount.
describe("useScan caching (Optimize/Fixes re-open is instant, not a re-scan)", () => {
  afterEach(() => invalidateProbe()); // isolate the module-level scan cache between these tests

  it("cache:true serves the cached verdict on re-mount — no second backend scan", async () => {
    invokeMock.mockClear();
    const first = renderHook(() => useScan({ cache: true }));
    await waitFor(() => expect(first.result.current.running).toBe(false));
    expect(invokeMock.mock.calls.length).toBeGreaterThan(0); // first visit scans
    first.unmount();

    invokeMock.mockClear();
    const second = renderHook(() => useScan({ cache: true }));
    // Instant: seeded straight to the verdict, no scanning phase, and crucially NO new IPC.
    expect(second.result.current.running).toBe(false);
    expect(second.result.current.phase).toBe("verdict");
    expect(invokeMock.mock.calls.length).toBe(0);
  });

  it("no-cache callers (FirstCheck / Tour) re-scan on every mount", async () => {
    invokeMock.mockClear();
    const first = renderHook(() => useScan());
    await waitFor(() => expect(first.result.current.running).toBe(false));
    first.unmount();

    invokeMock.mockClear();
    const second = renderHook(() => useScan());
    await waitFor(() => expect(second.result.current.running).toBe(false));
    expect(invokeMock.mock.calls.length).toBeGreaterThan(0); // scanned again (animation preserved)
  });

  it("invalidating the cache (post-mutation) makes the next mount re-scan", async () => {
    const first = renderHook(() => useScan({ cache: true }));
    await waitFor(() => expect(first.result.current.running).toBe(false));
    first.unmount();
    invalidateProbe(); // App.refresh() does this after every apply/rollback

    invokeMock.mockClear();
    const second = renderHook(() => useScan({ cache: true }));
    await waitFor(() => expect(second.result.current.running).toBe(false));
    expect(invokeMock.mock.calls.length).toBeGreaterThan(0); // fresh scan after a change
  });
});
