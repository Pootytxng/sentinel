import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// use-scan pulls @tauri-apps/api/core at import — stub invoke so jsdom doesn't choke loading the module.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
  buildSetupSummary as buildSetupSummaryRaw,
  deriveReverted,
  rowVerdict,
  useScan,
  type AppliedChangeLite,
} from "./use-scan";
import { invoke } from "@tauri-apps/api/core";
import { invalidateProbe } from "../data/probe-cache";
import type { GameReadiness, PriorityItem, Priorities, ReadinessCheck } from "../types";
// i18n update (2026-07-23): buildSetupSummary's strings now come from t(...) (Simplified Chinese
// translation pass) instead of literal English, so it takes a TFunction as its last param. This
// test-local wrapper resolves it through the real i18next instance (English is the default
// language, matching what every assertion below already expects) so every call site below stays
// exactly as written — same text, just sourced from locale JSON instead of a .ts literal.
import i18n from "../i18n";

const buildSetupSummary = (readiness: GameReadiness | null, priorities: Priorities | null) =>
  buildSetupSummaryRaw(readiness, priorities, i18n.t);

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

describe("buildSetupSummary (A5 — exportable, read-only, plain-English)", () => {
  const readiness = (over: Partial<GameReadiness> = {}): GameReadiness => ({
    checks: [{ id: "a", label: "SSD check", status: "ready", detail: "", value: null }],
    ready_count: 5,
    attention_count: 0,
    unknown_count: 0,
    advisory_count: 0,
    advisory: "",
    dismissed_ids: [],
    drifts: [],
    ...over,
  });
  const lim = (id: string, title: string): PriorityItem => ({
    id,
    title,
    reason: `${title} reason`,
    linked: null,
    confidence: "high",
    status: "attention",
  });
  const priorities = (over: Partial<Priorities> = {}): Priorities => ({
    limiters: [],
    already_fine: [],
    not_worth_touching: [],
    session_hint: null,
    upgrade_path: null,
    ...over,
  });

  it("no scan data -> empty string (nothing to export yet)", () => {
    expect(buildSetupSummary(null, null)).toBe("");
    expect(buildSetupSummary(null, priorities())).toBe("");
  });

  it("leads with a Compy title and a dated line (advisory, not a promise)", () => {
    const out = buildSetupSummary(readiness(), priorities());
    expect(out).toMatch(/^Compy setup summary/);
    // Honest framing: measured on this rig, advisory only — never a performance claim.
    expect(out).toMatch(/measured on this rig/i);
  });

  it("summarizes the readiness breakdown, mentioning only the non-zero buckets", () => {
    const out = buildSetupSummary(
      readiness({ ready_count: 5, attention_count: 2, advisory_count: 1, unknown_count: 0 }),
      priorities(),
    );
    // "look good" not "ready" (V2-9 punch f: "ready" belongs to appliable fixes, these are checks).
    expect(out).toMatch(/5 look good/);
    expect(out).toMatch(/2 need attention/);
    expect(out).toMatch(/1 advisory/);
    // A zero bucket is never listed (no "0 unknown" noise).
    expect(out).not.toMatch(/0 (look good|advisory|unknown|need attention)/);
    expect(out).not.toMatch(/unknown/);
  });

  it("branches singular counts properly — never '1 need attention' (V2-9 punch e)", () => {
    const out = buildSetupSummary(
      readiness({ ready_count: 1, attention_count: 1, advisory_count: 0, unknown_count: 0 }),
      priorities(),
    );
    expect(out).toMatch(/1 looks good/);
    expect(out).toMatch(/1 needs attention/);
    expect(out).not.toMatch(/1 need attention/);
    expect(out).not.toMatch(/1 look good\b/);
  });

  it("names each limiter Compy found, in order", () => {
    const out = buildSetupSummary(
      readiness({ attention_count: 2 }),
      priorities({ limiters: [lim("startup-load", "Too many startup apps"), lim("hags", "HAGS is off")] }),
    );
    const iA = out.indexOf("Too many startup apps");
    const iB = out.indexOf("HAGS is off");
    expect(iA).toBeGreaterThan(-1);
    expect(iB).toBeGreaterThan(-1);
    expect(iA).toBeLessThan(iB); // preserves ranked order
  });

  it("a clean rig says nothing worth changing — never fabricates a limiter", () => {
    const out = buildSetupSummary(readiness({ ready_count: 5 }), priorities({ limiters: [] }));
    expect(out).toMatch(/[Nn]othing worth changing/);
  });

  it("reports how many checks measured fine when any did", () => {
    const out = buildSetupSummary(
      readiness(),
      priorities({ already_fine: [lim("x", "X"), lim("y", "Y")] }),
    );
    expect(out).toMatch(/2 (checks|settings) measured fine/i);
  });

  it("is plain text with real line breaks (paste-ready), no HTML", () => {
    const out = buildSetupSummary(
      readiness({ attention_count: 1 }),
      priorities({ limiters: [lim("hags", "HAGS is off")] }),
    );
    expect(out).toContain("\n");
    expect(out).not.toMatch(/<[a-z]/i);
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
