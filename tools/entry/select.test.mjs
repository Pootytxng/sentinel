// GUARD: what the shortcut does when it is given no issue number.
//
// Two owner defects are mechanized here, and they pull in opposite directions, which is the whole
// reason this file is long.
//
// 1. (bug->guard, addendum on #18, 2026-07-30) After restarting VS Code, #18 was Active under our own
//    claim and #13 was the only Ready task. The shortcut ignored #18, silently selected #13, refused
//    on that unrelated worktree, and exited — and by the time Kuya typed "18", nothing was reading
//    input. => an unrelated Ready task is NEVER started on our behalf.
//
// 2. (bug->guard, #23, 2026-07-31) The fix for (1) was "never pick", so every launch — including the
//    one where a single task was already ours, Active and claimed — cost a keypress for a decision
//    that had already been made and posted to the board. => ONE valid owned Active task resumes with
//    no question asked.
//
// Both hold at once because the line between them is OWNERSHIP, not count. Since the owner-ratified
// dynamic mutation leases (#369 / PR #375, 2026-09-04) ownership means a LIVE LEASE: a row's Lane
// label is informational and never reserves Ready work; only an unexpired Active lease held by
// another executor blocks, a live lease held by this executor auto-resumes, and an unidentified
// caller inherits nothing. On top of that:
//   - work that cannot be started is still shown, each line saying plainly why, and typing its number
//     returns that reason;
//   - menu position and issue number both select, and the prompt says so;
//   - the context tier is on every line, so 150k standard and 300k marathon cannot be confused.
//
// Everything here is pure over injected facts — board items, a policy object, a scripted `ask`. The
// interactive loop is tested by feeding it answers, never by driving a real terminal.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  availability,
  buildMenu,
  chooseInteractively,
  contextLabel,
  renderMenu,
  resolveChoice,
} from "./select.mjs";
import { selectTask } from "./preflight.mjs";
import { cmdChoose } from "./cli.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const POLICY = {
  default: 150000,
  tiers: [{ window: 300000, issues: [15, 16, 19, 23], note: "the accepted marathon tier and the issues scoped to it" }],
};
const NOW = new Date("2026-07-30T23:30:00Z");
const SELF = { lane: "Claude Code" };

/** The board as Kuya's machine actually reported it during the failure. */
const BOARD = [
  { number: 13, title: "[SIDE] Rebase-audit the July 26 tool-shed hygiene branch", status: "Ready", lane: "Codex", gate: "None", claimExpires: null },
  { number: 14, title: "[REVIEW] Decide the fate of the feedback branch", status: "Needs Kuya", lane: "Kuya", gate: "Kuya" },
  { number: 17, title: "[PLAN] Integrate the product-quality blueprint", status: "Review", lane: "Codex", gate: "None" },
  { number: 18, title: "[WORKFLOW] One owner-facing Compy entrypoint — single-entry session routing", status: "Active", lane: "Claude Code", gate: "None", claimExpires: "2026-07-31" },
  { number: 19, title: "[OPS] Re-run and decide the invalidated 300k context-window trial", status: "Ready", lane: "Claude Code", gate: "None" },
];

const menu = (items = BOARD, over = {}) => buildMenu(items, { self: SELF, now: NOW, policy: POLICY, ...over });

/** The same board minus our own Active task — what Kuya sees on a genuinely fresh start. */
const NO_CLAIM_OF_OURS = BOARD.filter((i) => i.number !== 18);

/** A scripted terminal: hands back queued answers, records what it was asked. */
function scriptedAsk(answers) {
  const asked = [];
  const queue = [...answers];
  const ask = async (question) => {
    asked.push(question);
    return queue.length ? queue.shift() : null;
  };
  ask.asked = asked;
  return ask;
}

describe("GUARD 3: one task already ours resumes without asking", () => {
  it("#18 Active under our own live claim → auto-resume, no question", () => {
    const m = menu();
    expect(m.autoResume).toBe(18);
    expect(m.options[0].number).toBe(18);
    expect(m.options[0].action).toBe("Resume");
  });

  it("selectTask returns the TASK, marked auto — the caller never prompts", () => {
    const picked = selectTask(BOARD, { self: SELF, now: NOW, policy: POLICY });
    expect(picked.kind).toBe("task");
    expect(picked.task.number).toBe(18);
    expect(picked.auto).toBe(true);
    expect(picked.reason).toMatch(/already leased to this executor/i);
  });

  it("an unidentified caller never inherits a live lease — no auto-resume without an executor identity", () => {
    const m = menu(BOARD, { self: { lane: null } });
    expect(m.autoResume).toBe(null);
    expect(m.options.map((o) => o.number)).not.toContain(18);
    expect(selectTask(BOARD, { self: { lane: null }, now: NOW, policy: POLICY }).kind).not.toBe("task");
  });

  it("a restarted editor changes nothing: the claim lives on the board, not in a window", () => {
    // If this module could see the machine, closing VS Code could erase a claim. It cannot see it.
    const src = readFileSync(join(HERE, "select.mjs"), "utf8");
    expect(src).not.toMatch(/child_process|inspectProcesses|discoverCheckouts|\.claude\/ide/);
    expect(menu().autoResume).toBe(18);
  });

  it("auto-resume survives other work being on offer — #19 Ready does not make it a question", () => {
    expect(menu().options.map((o) => o.number)).toContain(19);
    expect(menu().autoResume).toBe(18);
  });

  it("cmdChoose auto-resumes with an empty answer queue — nothing was asked at all", async () => {
    const out = [];
    const said = [];
    const ask = scriptedAsk([]);
    const code = await cmdChoose({
      board: { reachable: true, items: BOARD },
      self: SELF, now: NOW, policy: POLICY,
      ask, say: (s) => said.push(s), out: (s) => out.push(s),
    });
    expect(code).toBe(0);
    expect(ask.asked).toHaveLength(0);
    expect(JSON.parse(out.join(""))).toMatchObject({ issue: 18, auto: true, contextLabel: "150k — standard" });
    expect(said.join("\n")).toMatch(/Resuming #18/);
  });
});

describe("GUARD 4: nothing else is ever selected for us", () => {
  it("several Ready tasks and no live lease of ours → a choice, never a start (a Codex Lane label hides nothing)", () => {
    const many = [
      ...NO_CLAIM_OF_OURS,
      { number: 20, title: "[OPS] Another ready one", status: "Ready", lane: "Claude Code", gate: "None" },
    ];
    const picked = selectTask(many, { self: SELF, now: NOW, policy: POLICY });
    expect(picked.kind).toBe("choice");
    expect(picked.task).toBeUndefined();
    // #13 carries Lane: Codex. Under dynamic mutation leases that label is informational, so the
    // row is offered alongside the Claude-labelled ones — offered, still never started.
    expect(picked.options.map((o) => o.number)).toEqual([13, 19, 20]);
  });

  it("ONE Ready task and nothing of ours is still a choice — this is defect (1) exactly", () => {
    const onlyReady = [BOARD[0]]; // #13, the unrelated Codex task the old code started
    const picked = selectTask(onlyReady, { self: SELF, now: NOW, policy: POLICY });
    expect(picked.kind).not.toBe("task");
  });

  it("even a Ready task in OUR lane is only ever offered", () => {
    const picked = selectTask([BOARD[4]], { self: SELF, now: NOW, policy: POLICY });
    expect(picked.kind).toBe("choice");
    expect(picked.options).toHaveLength(1);
  });

  it("two Actives of ours → no auto-resume; two claims is the ambiguity a person settles", () => {
    const two = [...BOARD, { number: 20, title: "[OPS] Another", status: "Active", lane: "Claude Code", gate: "None", claimExpires: "2026-07-31" }];
    expect(menu(two).autoResume).toBe(null);
    expect(selectTask(two, { self: SELF, now: NOW, policy: POLICY }).kind).toBe("choice");
  });

  it("Enter selects nothing on the picker — there is no default to press", () => {
    const m = menu(NO_CLAIM_OF_OURS);
    expect(m.autoResume).toBe(null);
    expect(resolveChoice("", m).kind).toBe("invalid");
  });

  it("nothing available at all → says so, and never invents work", () => {
    const picked = selectTask([BOARD[1], BOARD[2]], { self: SELF, now: NOW, policy: POLICY });
    expect(picked.kind).toBe("none");
    expect(picked.reason).toMatch(/nothing .*(available|start)|no .*task/i);
  });
});

describe("what is ours, what is not, and why", () => {
  it("another executor's live Active lease is unavailable and says whose it is", () => {
    const theirs = BOARD.map((i) => (i.number === 18 ? { ...i, lane: "Codex" } : i));
    const m = menu(theirs);
    expect(m.autoResume).toBe(null);
    expect(m.options.map((o) => o.number)).not.toContain(18);
    expect(m.unavailable.find((u) => u.number === 18).reason).toMatch(/the Codex executor currently holds its mutation lease/);
  });

  it("an expired claim is unavailable, not silently resumed — a takeover is verified first", () => {
    const expired = BOARD.map((i) => (i.number === 18 ? { ...i, claimExpires: "2026-07-28" } : i));
    const m = menu(expired);
    expect(m.autoResume).toBe(null);
    expect(m.options.map((o) => o.number)).not.toContain(18);
    expect(m.unavailable.find((u) => u.number === 18).reason).toMatch(/expired.*2026-07-28.*takeover/i);
  });

  it("an Active row with no claim expiry recorded is not treated as a live claim", () => {
    const noExpiry = BOARD.map((i) => (i.number === 18 ? { ...i, claimExpires: null } : i));
    expect(menu(noExpiry).autoResume).toBe(null);
  });

  it("another model's Lane label alone does not reserve a Ready task; a live lease by another executor does", () => {
    // Half one: #13 is Ready with Lane: Codex. Lane is informational under dynamic mutation
    // leases, so the row is offered to this executor as a Start — never hidden, never auto-started.
    const m = menu();
    const offered = m.options.find((o) => o.number === 13);
    expect(offered).toBeDefined();
    expect(offered.action).toBe("Start");
    expect(m.unavailable.map((u) => u.number)).not.toContain(13);
    expect(m.autoResume).toBe(18);

    // Half two: the same row under a live, unexpired Active lease held by Codex is reserved, and
    // the reason names the holder.
    const leased = BOARD.map((i) => (i.number === 13 ? { ...i, status: "Active", claimExpires: "2026-07-31" } : i));
    const held = menu(leased);
    expect(held.options.map((o) => o.number)).not.toContain(13);
    expect(held.unavailable.find((u) => u.number === 13).reason).toMatch(/the Codex executor currently holds its mutation lease/);
  });

  it("an unassigned Ready task is open to whoever asks for it", () => {
    const orphan = [{ number: 21, title: "[OPS] Nobody's yet", status: "Ready", lane: null, gate: "None" }];
    expect(menu(orphan).options.map((o) => o.number)).toEqual([21]);
  });

  it("owner-gated work is unavailable and names the gate", () => {
    const m = menu();
    expect(m.unavailable.find((u) => u.number === 14).reason).toMatch(/gated on Kuya/);
    for (const gate of ["Security / System", "Release / Distribution", "External / Account"]) {
      const item = { number: 30, title: "x", status: "Ready", lane: "Claude Code", gate };
      expect(availability(item, { self: SELF, now: NOW }).available).toBe(false);
      expect(availability(item, { self: SELF, now: NOW }).reason).toContain(gate);
    }
  });

  it("a gate blocks even our own live claim — the next step is not ours to take", () => {
    const gated = BOARD.map((i) => (i.number === 18 ? { ...i, gate: "Security / System" } : i));
    expect(menu(gated).autoResume).toBe(null);
    expect(menu(gated).unavailable.find((u) => u.number === 18).reason).toMatch(/Security \/ System/);
  });

  it("Done and Review work is not listed at all — it is not noise the owner has to read past", () => {
    const m = menu([...BOARD, { number: 22, title: "[X] finished", status: "Done", lane: "Claude Code", gate: "None" }]);
    const listed = [...m.options, ...m.unavailable].map((r) => r.number);
    expect(listed).not.toContain(17);
    expect(listed).not.toContain(22);
  });
});

describe("the displayed context policy", () => {
  it("labels the window in the owner's words", () => {
    expect(contextLabel(150000, { marathon: false })).toBe("150k — standard");
    expect(contextLabel(300000, { marathon: true })).toBe("300k — marathon");
  });

  it("#18 shows 150k standard and #19 shows 300k marathon", () => {
    const m = menu();
    expect(m.options.find((o) => o.number === 18).contextLabel).toBe("150k — standard");
    expect(m.options.find((o) => o.number === 19).contextLabel).toBe("300k — marathon");
    expect(m.options.find((o) => o.number === 19).marathon).toBe(true);
    expect(m.options.find((o) => o.number === 18).marathon).toBe(false);
  });

  it("every row carries a label derived from the policy — never invented", () => {
    for (const o of menu().options) {
      expect(o.contextLabel).toMatch(/^\d+k — (standard|marathon)$/);
      expect(o.window).toBe(o.number === 19 ? 300000 : 150000);
    }
    expect(() => buildMenu(BOARD, { self: SELF, now: NOW, policy: null })).toThrow(/policy/i);
  });
});

describe("the menu Kuya reads", () => {
  // No live lease of ours: #13 (Lane: Codex, Ready) and #19 (Ready) are both on offer, in board
  // order, because a Lane label does not reserve Ready work. 1 => #13, 2 => #19.
  const picker = () => menu(NO_CLAIM_OF_OURS);
  /** The same picker with #13 under a live Codex lease — the one thing that does reserve it. */
  const pickerWithCodexLease = () =>
    menu(NO_CLAIM_OF_OURS.map((i) => (i.number === 13 ? { ...i, status: "Active", claimExpires: "2026-07-31" } : i)));

  it("states what to type, both ways, in plain words", () => {
    const text = renderMenu(picker());
    expect(text).toMatch(/Which task would you like to work on\?/);
    expect(text).toMatch(/1\.  Start #13/);
    expect(text).toMatch(/2\.  Start #19/);
    expect(text).toMatch(/Type the number on the left \(1 or 2\)/);
    expect(text).toMatch(/issue\s*\n?\s*number \(#13 or #19\)/);
    expect(picker().question).toMatch(/Type a number from the list \(1 or 2\) or an issue number \(#13 or #19\), or Q to cancel/);
  });

  it("shows what cannot be started, with the reason on the line", () => {
    const text = renderMenu(picker());
    expect(text).toMatch(/Not available right now:/);
    // A Lane label is not a reason: #13 is offered above the line, never listed below it.
    expect(text).not.toMatch(/#13 —.*\n\s+it is assigned/);
    expect(text).toMatch(/#14 —.*\n\s+it is gated on Kuya/);
    // A live lease held by another executor is a reason, and the line names the holder.
    const held = renderMenu(pickerWithCodexLease());
    expect(held).not.toMatch(/Start #13/);
    expect(held).toMatch(/#13 —.*\n\s+the Codex executor currently holds its mutation lease\./);
  });

  it("never advertises an Enter shortcut, because there is no longer one", () => {
    expect(renderMenu(picker())).not.toMatch(/Press Enter|Recommended/i);
    expect(picker().question).not.toMatch(/Enter/);
  });

  it("reads as a sentence with three options, not as an array", () => {
    const m = menu([
      { number: 19, title: "a", status: "Ready", lane: "Claude Code", gate: "None" },
      { number: 20, title: "b", status: "Ready", lane: "Claude Code", gate: "None" },
      { number: 21, title: "c", status: "Ready", lane: "Claude Code", gate: "None" },
    ]);
    expect(m.question).toMatch(/list \(1, 2 or 3\)/);
    expect(m.question).toMatch(/issue number \(#19, #20 or #21\)/);
  });
});

describe("what the picker accepts", () => {
  const m = () => menu(NO_CLAIM_OF_OURS); // 1 => #13 (Lane: Codex, not reserved), 2 => #19
  /** #13 under a live Codex lease: the only thing that takes it off the menu. */
  const held = () =>
    menu(NO_CLAIM_OF_OURS.map((i) => (i.number === 13 ? { ...i, status: "Active", claimExpires: "2026-07-31" } : i)));

  it("the ordinal and the issue number both select, in the same run", () => {
    expect(resolveChoice("1", m())).toMatchObject({ kind: "task", number: 13 });
    expect(resolveChoice("2", m())).toMatchObject({ kind: "task", number: 19 });
    expect(resolveChoice("19", m())).toMatchObject({ kind: "task", number: 19 });
    expect(resolveChoice("#19", m())).toMatchObject({ kind: "task", number: 19 });
    expect(resolveChoice(" 19 ", m())).toMatchObject({ kind: "task", number: 19 });
    expect(resolveChoice("13", m())).toMatchObject({ kind: "task", number: 13 });
  });

  it("typing an UNAVAILABLE issue returns that row's reason, not a shrug", () => {
    const r = resolveChoice("13", held());
    expect(r.kind).toBe("invalid");
    expect(r.reason).toMatch(/#13 cannot be started: the Codex executor currently holds its mutation lease/);
    expect(resolveChoice("14", m()).reason).toMatch(/gated on Kuya/);
  });

  it("Q cancels", () => {
    expect(resolveChoice("q", m()).kind).toBe("cancel");
    expect(resolveChoice("Q", m()).kind).toBe("cancel");
  });

  it("an issue that is nowhere on the menu explains the valid choices", () => {
    const r = resolveChoice("99", m());
    expect(r.kind).toBe("invalid");
    expect(r.reason).toMatch(/not on this menu/);
    expect(r.reason).toMatch(/#19/);
  });

  it("junk is invalid, not an accidental selection", () => {
    for (const junk of ["x", "-1", "0", "4", "1.5", "19 13", ""]) {
      expect(resolveChoice(junk, m()).kind).toBe("invalid");
    }
  });
});

describe("the interactive loop", () => {
  const m = () => menu(NO_CLAIM_OF_OURS);

  it("re-prompts after invalid input instead of exiting", async () => {
    const ask = scriptedAsk(["zzz", "19"]);
    const said = [];
    const r = await chooseInteractively({ menu: m(), ask, say: (s) => said.push(s) });
    expect(r).toMatchObject({ kind: "task", number: 19 });
    expect(ask.asked).toHaveLength(2);
    expect(said.join("\n")).toMatch(/not one of the choices/);
  });

  it("keeps the prompt alive across empty input — the window that lost Kuya's '18' had closed", async () => {
    const ask = scriptedAsk(["", "", "19"]);
    const r = await chooseInteractively({ menu: m(), ask, say: () => {} });
    expect(r).toMatchObject({ kind: "task", number: 19 });
  });

  it("Q leaves without a selection", async () => {
    const r = await chooseInteractively({ menu: m(), ask: scriptedAsk(["q"]), say: () => {} });
    expect(r.kind).toBe("cancel");
  });

  it("a closed stdin cancels rather than hanging or guessing", async () => {
    const r = await chooseInteractively({ menu: m(), ask: scriptedAsk([]), say: () => {} });
    expect(r.kind).toBe("cancel");
  });

  it("stops asking eventually instead of looping forever", async () => {
    const ask = scriptedAsk(Array(50).fill("nope"));
    const r = await chooseInteractively({ menu: m(), ask, say: () => {} });
    expect(r.kind).toBe("cancel");
    expect(ask.asked.length).toBeLessThanOrEqual(10);
  });
});

describe("cmdChoose: the command the shortcut runs when it is given no issue", () => {
  const run = (answers, over = {}) => {
    const out = [];
    const said = [];
    return cmdChoose({
      board: { reachable: true, items: NO_CLAIM_OF_OURS },
      self: SELF,
      now: NOW,
      policy: POLICY,
      ask: scriptedAsk(answers),
      say: (s) => said.push(s),
      out: (s) => out.push(s),
      ...over,
    }).then((code) => ({ code, out, said }));
  };

  it("a choice: exit 0, and the issue is the only thing on stdout", async () => {
    const { code, out } = await run(["19"]);
    expect(code).toBe(0);
    expect(JSON.parse(out.join(""))).toMatchObject({ issue: 19, auto: false, contextLabel: "300k — marathon" });
  });

  it("the ordinal does the same thing as the issue number", async () => {
    // 1 => #13 (Ready, Lane: Codex — a label, not a reservation), 2 => #19.
    const second = await run(["2"]);
    expect(JSON.parse(second.out.join("")).issue).toBe(19);
    const first = await run(["1"]);
    expect(JSON.parse(first.out.join("")).issue).toBe(13);
  });

  it("Q exits 2 with nothing on stdout — the launcher then writes nothing at all", async () => {
    const { code, out, said } = await run(["q"]);
    expect(code).toBe(2);
    expect(out).toEqual([]);
    expect(said.join("\n")).toMatch(/nothing was written|cancel/i);
  });

  it("nothing available exits 2 and prints the reasons, not an empty screen", async () => {
    // #13 under a live Codex lease and #14 gated on Kuya: nothing to offer, two reasons to print.
    // (#13 merely labelled Codex would be offered — a Lane label is not a reason.)
    const codexHolds13 = { ...BOARD[0], status: "Active", claimExpires: "2026-07-31" };
    const { code, out, said } = await run([""], { board: { reachable: true, items: [codexHolds13, BOARD[1]] } });
    expect(code).toBe(2);
    expect(out).toEqual([]);
    expect(said.join("\n")).toMatch(/the Codex executor currently holds its mutation lease/);
    expect(said.join("\n")).toMatch(/gated on Kuya/);
  });

  it("an unreachable board refuses instead of offering a menu it cannot vouch for", async () => {
    const { code, said } = await run([""], { board: { reachable: false, items: [], error: "gh exploded" } });
    expect(code).toBe(2);
    expect(said.join("\n")).toMatch(/unreachable/i);
  });

  it("selection alone writes nothing: no filesystem, no network, no board mutation", () => {
    const src = readFileSync(join(HERE, "select.mjs"), "utf8");
    expect(src).not.toMatch(/writeFileSync|mkdirSync|rmSync|execFileSync|postClaim/);
  });
});

describe("automation is unaffected", () => {
  it("--issue 18 still resolves straight to the task, no menu", () => {
    const picked = selectTask(BOARD, { issue: 18, self: SELF, now: NOW, policy: POLICY });
    expect(picked.kind).toBe("task");
    expect(picked.task.number).toBe(18);
    expect(picked.auto).toBeUndefined();
  });

  it("--issue is honoured even when the task is unstartable, so the CHECKS explain the refusal", () => {
    const picked = selectTask(BOARD, { issue: 14, self: SELF, now: NOW, policy: POLICY });
    expect(picked.kind).toBe("task");
    expect(picked.task.number).toBe(14);
  });

  it("--issue for something not on the board refuses", () => {
    expect(selectTask(BOARD, { issue: 99, self: SELF, now: NOW, policy: POLICY }).kind).toBe("none");
  });

  it("selectTask needs no policy when it is given an explicit issue", () => {
    expect(selectTask(BOARD, { issue: 18 }).kind).toBe("task");
  });
});
