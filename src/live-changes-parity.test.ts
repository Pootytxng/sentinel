import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { readFileSync } from "fs";
import { join } from "path";
import { render, renderHook } from "@testing-library/react";
import i18n from "./i18n";
import Fix from "./surfaces/Fix";
import { buildLogbook } from "./surfaces/blackbook/logbook";
import { manageJumpLabel, useLogbookView } from "./surfaces/blackbook/logbook-view";
import { liveChangeGroups } from "./data/live-changes";
import type { AppliedChange } from "./types";
import fixture from "./test/fixtures/live-changes-parity.json";

// ACTIVE-CHANGE PARITY (#453 Phase 2 four-screen check).
//
// On the owner's PC Health said "13 active now" while Optimize ("Active on this PC") and History
// ("Undo any of the 14 changes") said 14, for one ledger. Health counted ledger ROWS (Game Mode,
// applied 8 times, counted 8 times) and dropped every live-On change whose row predates rig
// stamping; History folded the can't-confirm changes into its number.
//
// One fixture shaped like that ledger (repeated Game Mode rows, pre-stamp rows that read On, one
// other-rig row that reads On, one change Compy can't read, one read as off, rolled-back rows) is
// fed to all three. Optimize and History are checked here; Health's number is the Rust Machine
// Model's `active_now`, checked against the SAME file by the Rust test this file names below.

type Row = (typeof fixture.rows)[number];
const toChange = (r: Row): AppliedChange => ({
  id: r.id,
  rec_id: r.rec_id,
  rec_title: r.rec_title,
  applied_at: r.applied_at,
  snapshot: null,
  status: r.status as AppliedChange["status"],
  // What history.rs `legacy_active()` gives each check: true unless the read came back off.
  is_still_active:
    r.status === "applied" && ["on", "unreadable", "unrecognised"].includes(String(r.active_check)),
  active_check: r.active_check as AppliedChange["active_check"],
});
const changes = fixture.rows.map(toChange);
const { active: ACTIVE, cantConfirm: CANT_CONFIRM } = fixture.expected;

const fixProps = {
  recs: [],
  startup: [],
  busyId: null,
  isAppliable: () => true,
  activeChangeFor: () => undefined,
  onToggleRec: vi.fn(),
  onToggleStartup: vi.fn(),
  onRollback: vi.fn(),
  onApplyBatch: vi.fn().mockResolvedValue({ applied: 0, skipped: [] }),
  onOpenLibrary: vi.fn(),
  vendor: "any" as const,
};

describe("Health, Optimize and History count the same active changes (#453)", () => {
  it("the fixture is shaped like the owner's ledger", () => {
    const gameModeApplied = changes.filter((c) => c.rec_id === "game-mode" && c.status === "applied");
    expect(gameModeApplied.length).toBeGreaterThan(1);
    expect(fixture.rows.some((r) => r.active_check === "on" && r.on_this_rig === null)).toBe(true);
    expect(fixture.rows.some((r) => r.active_check === "unreadable")).toBe(true);
    // #453 review: a same-millisecond tie with mixed checks, a newer rollback over an older apply
    // that still reads on, and an undated row.
    expect(fixture.rows.filter((r) => r.rec_id === "tie-rec").map((r) => r.active_check)).toEqual([
      "unreadable",
      "on",
    ]);
    expect(fixture.rows.filter((r) => r.rec_id === "rb-rec").map((r) => r.status)).toEqual([
      "applied",
      "rolled_back",
    ]);
    expect(fixture.rows.some((r) => r.applied_at === "")).toBe(true);
    // 453-f1: the row last in the file is not the newest apply, and it reads off.
    expect(fixture.rows.filter((r) => r.rec_id === "late-rec").map((r) => r.active_check)).toEqual(["on", "off"]);
    expect(fixture.rows.some((r) => r.active_check === "unrecognised")).toBe(true);
    expect(ACTIVE).toBe(10);
    expect(CANT_CONFIRM).toBe(3);
  });

  it("the shared helper: one per change, live On whatever the rig stamp, can't-confirm apart", () => {
    const g = liveChangeGroups(changes);
    expect(g.active.map((c) => c.rec_id).sort()).toEqual(
      [
        "fast-startup-off",
        "game-mode",
        "hags-enable",
        "late-rec",
        "nagle-disable",
        "rb-rec",
        "undated-rec",
        "pcie-aspm-off",
        "sysmain-disable",
        "usb-selective-suspend-off",
      ].sort(),
    );
    expect(g.cantConfirm.map((c) => c.rec_id).sort()).toEqual(["bloat-task:ceip-usb", "leftover:no-probe", "tie-rec"]);
    // A same-millisecond tie keeps the first row seen, whatever the sub-millisecond digits say.
    expect(g.cantConfirm.find((c) => c.rec_id === "tie-rec")?.id).toBe("tie-1");
    // The newest live apply represents a repeated change: it is what an undo targets.
    expect(g.active.find((c) => c.rec_id === "game-mode")?.id).toBe("gm-5");
  });

  it("Optimize: the 'Active on this PC' list and the can't-confirm list", () => {
    const { container } = render(createElement(Fix, { ...fixProps, view: "applied", changes }));
    const labels = [...container.querySelectorAll(".fix-section-label")].map((n) => n.textContent);
    const lists = [...container.querySelectorAll(".fix-section-label + .fix-list")];
    const rowsUnder = (label: string) => lists[labels.indexOf(label)]?.querySelectorAll(":scope > li").length ?? 0;
    expect(rowsUnder(i18n.t("optimize.fix.activeOnThisPc"))).toBe(ACTIVE);
    expect(rowsUnder(i18n.t("optimize.fix.activeCantConfirm"))).toBe(CANT_CONFIRM);
  });

  it("History: the undo route counts the same active changes and names the can't-confirm one apart", () => {
    const records = buildLogbook({ changes });
    const { result } = renderHook(() => useLogbookView(records, null, changes));
    expect(result.current.undoableChanges).toEqual({ active: ACTIVE, cantConfirm: CANT_CONFIRM });
    const en = i18n.getFixedT("en");
    expect(manageJumpLabel(en, result.current.undoableChanges)).toBe(
      `Undo in Test: ${ACTIVE} still on · ${CANT_CONFIRM} can't confirm`,
    );
    expect(manageJumpLabel(i18n.getFixedT("zh-CN"), result.current.undoableChanges)).toBe(
      `前往「测试」撤销：${ACTIVE} 项生效中 · ${CANT_CONFIRM} 项无法确认`,
    );
    // With nothing unconfirmed the sentence reads as it always did, with the active count.
    expect(manageJumpLabel(en, { active: ACTIVE, cantConfirm: 0 })).toBe(
      `Undo any of the ${ACTIVE} changes in Test`,
    );
  });

  it("Health: the Rust Machine Model test reads this same fixture and asserts the same numbers", () => {
    const rs = readFileSync(join("src-tauri", "src", "machine_model.rs"), "utf8");
    expect(rs).toContain('include_str!("../../src/test/fixtures/live-changes-parity.json")');
    expect(rs).toMatch(/fn active_and_unknown_counts_match_the_shared_ts_fixture\(\)/);
  });

  it("Sessions: the Rust session count reads this same fixture through the shared rule (453-f1)", () => {
    const rs = readFileSync(join("src-tauri", "src", "history.rs"), "utf8");
    expect(rs).toContain('include_str!("../../src/test/fixtures/live-changes-parity.json")');
    expect(rs).toMatch(/fn the_session_count_is_the_shared_per_change_count\(\)/);
    // The session count and Health's count go through one Rust helper.
    const mm = readFileSync(join("src-tauri", "src", "machine_model.rs"), "utf8");
    expect(mm).toMatch(/crate::history::live_change_groups\(/);
  });

  it("Optimize reads the shared helper and History the shared per-row rule, so they cannot drift", () => {
    expect(readFileSync(join("src", "surfaces", "Fix.tsx"), "utf8")).toMatch(/\bliveChangeGroups\(/);
    expect(readFileSync(join("src", "surfaces", "blackbook", "logbook.ts"), "utf8")).toMatch(
      /import \{ changeLiveState \} from "\.\.\/\.\.\/data\/live-changes"/,
    );
  });
});
