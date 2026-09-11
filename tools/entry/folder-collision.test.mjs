// Guard: one folder, one writer — said on the MENU, not three steps later.
//
// `availability` decided from status, lane, gate and claim only. So a Ready task whose folder another
// Active task is already writing in was offered as startable; preflight caught it afterwards, which
// is exactly the "refused after a worktree has been offered" shape this selector's own header says it
// exists to prevent. The owner picks a task, waits, and is then told he could never have had it.
//
// Comparison goes through `samePath`, because the board's Worktree/branch field is typed by hand and
// `C:/Users/...` and `c:\users\...` are the same folder.

import { describe, expect, it } from "vitest";
import { availability, buildMenu } from "./select.mjs";

const ROOT = "C:\\Users\\Kuya\\code";
const POLICY = { default: 150000, marathon: [], issues: {} };

const item = (over) => ({ number: 1, title: "t", status: "Ready", lane: "Claude Code", gate: "None", worktreeBranch: "", ...over });
const at = (folder, branch = "b") => `${folder}${" @ "}${branch}`;

describe("a folder another Active task is writing in", () => {
  const occupied = item({ number: 41, status: "Active", lane: "Claude Code", worktreeBranch: at("sentinel-marathon", "tooling/x") });

  it("makes a Ready task in that same folder unavailable, with the reason on screen", () => {
    const ready = item({ number: 23, worktreeBranch: at("sentinel-marathon", "tooling/y") });
    const v = availability(ready, { items: [ready, occupied], codeRoot: ROOT });
    expect(v.available).toBe(false);
    expect(v.reason).toMatch(/#41 already has an active mutation lease in/);
    expect(v.reason).toMatch(/one folder, one writer/);
  });

  // Dynamic mutation leases (#369 / PR #375): a Lane label reserves nothing, but a folder held by a
  // live lease still does — whoever holds it. The occupant's Lane must not change the verdict.
  it("holds whichever executor's live lease occupies the folder — Lane labels do not soften it", () => {
    const ready = item({ number: 23, worktreeBranch: at("sentinel-marathon", "tooling/y") });
    for (const lane of ["Claude Code", "Codex", "ChatGPT HQ", null]) {
      const holder = item({ number: 41, status: "Active", lane, worktreeBranch: at("sentinel-marathon", "tooling/x") });
      const v = availability(ready, { self: { lane: "Claude Code" }, items: [ready, holder], codeRoot: ROOT });
      expect(v.available, `occupant lane ${lane}`).toBe(false);
      expect(v.reason).toMatch(/one folder, one writer/);
    }
  });

  it("leaves a Ready task in a different folder alone", () => {
    const ready = item({ number: 23, worktreeBranch: at("sentinel-feedback", "feat/z") });
    expect(availability(ready, { items: [ready, occupied], codeRoot: ROOT }).available).toBe(true);
  });

  // The board is typed by hand; separators and case are not identity.
  it("matches the folder however it was spelled on the board", () => {
    const ready = item({ number: 23, worktreeBranch: at("SENTINEL-MARATHON", "tooling/y") });
    expect(availability(ready, { items: [ready, occupied], codeRoot: ROOT }).available).toBe(false);
  });

  it("does not consider a task to be occupying its own folder", () => {
    const alone = item({ number: 23, worktreeBranch: at("sentinel-marathon", "tooling/y") });
    expect(availability(alone, { items: [alone], codeRoot: ROOT }).available).toBe(true);
  });

  // Only an ACTIVE item occupies. A second Ready task in the same folder is a queue, not a conflict.
  it("is not blocked by another READY task naming the same folder", () => {
    const other = item({ number: 41, status: "Ready", worktreeBranch: at("sentinel-marathon", "tooling/x") });
    const ready = item({ number: 23, worktreeBranch: at("sentinel-marathon", "tooling/y") });
    expect(availability(ready, { items: [ready, other], codeRoot: ROOT }).available).toBe(true);
  });

  it("says nothing about folders when the field does not name one", () => {
    const ready = item({ number: 23, worktreeBranch: "" });
    expect(availability(ready, { items: [ready, occupied], codeRoot: ROOT }).available).toBe(true);
  });
});

describe("the menu the owner actually sees", () => {
  it("lists the conflicting task as unavailable rather than offering it", () => {
    const occupied = item({ number: 41, status: "Active", lane: "Codex", worktreeBranch: at("sentinel-marathon", "tooling/x") });
    const ready = item({ number: 23, worktreeBranch: at("sentinel-marathon", "tooling/y") });
    const menu = buildMenu([ready, occupied], { policy: POLICY, codeRoot: ROOT });

    expect(menu.options.map((o) => o.number)).not.toContain(23);
    expect(menu.unavailable.find((u) => u.number === 23).reason).toMatch(/#41 already has an active mutation lease in/);
  });
});
