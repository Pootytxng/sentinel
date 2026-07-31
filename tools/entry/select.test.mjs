// GUARD: the first-run selection guard (bug->guard, owner addendum on Issue #18, 2026-07-30).
//
// The reproduced defect: after restarting VS Code, #18 was Active under our own claim and #13 was
// the only Ready task. The no-argument shortcut ignored #18, silently selected #13, refused on that
// unrelated worktree, and exited — and by the time Kuya typed "18", nothing was reading input.
//
// Four invariants come out of that, and this file is where they are mechanized:
//   1. a self-owned resumable Active task is offered BEFORE unrelated Ready tasks;
//   2. a generic shortcut never silently launches a different task while one exists;
//   3. a displayed choice accepts its menu position AND its issue number in the same run;
//   4. the resolved context policy is displayed, so 150k standard and 300k experimental cannot be
//      confused for one another again.
//
// Everything here is pure over injected facts — board items, a policy object, a scripted `ask`.
// The interactive loop is tested by feeding it answers, never by driving a real terminal.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
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
  trials: [{ window: 300000, issues: [15, 16, 19], note: "the context-window trial and its re-run" }],
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

describe("the recommendation: a self-owned resumable Active task comes first", () => {
  it("#18 Active under our own claim + #13 Ready → resume #18 is the recommendation", () => {
    const m = menu();
    expect(m.recommended).toBe(18);
    expect(m.options[0].number).toBe(18);
    expect(m.options[0].action).toBe("Resume");
    expect(m.options[0].recommended).toBe(true);
  });

  it("#13 is offered, but never selected on our behalf", () => {
    const m = menu();
    expect(m.options.map((o) => o.number)).toContain(13);
    expect(m.options.find((o) => o.number === 13).recommended).toBe(false);
    expect(m.options.find((o) => o.number === 13).action).toBe("Start");
  });

  it("selectTask with no explicit issue returns a CHOICE — it never picks a task itself", () => {
    // This is the line the old behaviour crossed: one Ready task, so it started #13.
    const picked = selectTask(BOARD, { self: SELF, now: NOW, policy: POLICY });
    expect(picked.kind).toBe("choice");
    expect(picked.task).toBeUndefined();
    expect(picked.recommended).toBe(18);
  });

  it("a lone Ready task with no resumable Active is still a confirmation, not a silent start", () => {
    const onlyReady = BOARD.filter((i) => i.number === 13);
    const picked = selectTask(onlyReady, { self: SELF, now: NOW, policy: POLICY });
    expect(picked.kind).toBe("choice");
    expect(picked.task).toBeUndefined();
    expect(picked.recommended).toBe(null);
  });

  it("nothing startable at all → says so, and never invents work", () => {
    const picked = selectTask([BOARD[1], BOARD[2]], { self: SELF, now: NOW, policy: POLICY });
    expect(picked.kind).toBe("none");
    expect(picked.reason).toMatch(/nothing .*start|no .*task/i);
  });

  it("two self-owned resumable Actives → no default; ambiguity is not a place to guess", () => {
    const two = [...BOARD, { number: 20, title: "[OPS] Another", status: "Active", lane: "Claude Code", gate: "None", claimExpires: "2026-07-31" }];
    const m = menu(two);
    expect(m.recommended).toBe(null);
    expect(m.options.filter((o) => o.recommended)).toHaveLength(0);
  });
});

describe("resumability is a property of the board, not of this machine", () => {
  it("an expired claim is not resumable — offered, never recommended", () => {
    const expired = BOARD.map((i) => (i.number === 18 ? { ...i, claimExpires: "2026-07-28" } : i));
    const m = menu(expired);
    expect(m.recommended).toBe(null);
    const eighteen = m.options.find((o) => o.number === 18);
    expect(eighteen.resumable).toBe(false);
    expect(eighteen.note).toMatch(/expired|takeover/i);
  });

  it("another lane's Active task is not ours to resume — it is not offered at all", () => {
    const theirs = BOARD.map((i) => (i.number === 18 ? { ...i, lane: "Codex" } : i));
    const m = menu(theirs);
    expect(m.options.map((o) => o.number)).not.toContain(18);
    expect(m.recommended).toBe(null);
  });

  it("an Active task with no claim expiry recorded is not treated as a live claim", () => {
    const noExpiry = BOARD.map((i) => (i.number === 18 ? { ...i, claimExpires: null } : i));
    expect(menu(noExpiry).recommended).toBe(null);
  });

  it("no editor, no session, no processes — the board still carries the resume across a restart", () => {
    // buildMenu takes items and a clock. If it could see the machine, a restart could erase a claim.
    const src = readFileSync(join(HERE, "select.mjs"), "utf8");
    expect(src).not.toMatch(/child_process|inspectProcesses|discoverCheckouts/);
    expect(menu().recommended).toBe(18);
  });
});

describe("the displayed context policy", () => {
  it("labels the window in the owner's words", () => {
    expect(contextLabel(150000, { trial: false })).toBe("150k — standard");
    expect(contextLabel(300000, { trial: true })).toBe("300k — experimental");
  });

  it("#18 shows 150k standard and #19 shows 300k experimental", () => {
    const m = menu();
    expect(m.options.find((o) => o.number === 18).contextLabel).toBe("150k — standard");
    expect(m.options.find((o) => o.number === 19).contextLabel).toBe("300k — experimental");
  });

  it("every option carries a label, and it is derived from the policy — never invented", () => {
    for (const o of menu().options) {
      expect(o.contextLabel).toMatch(/^\d+k — (standard|experimental)$/);
      expect(o.window).toBe(o.number === 19 ? 300000 : 150000);
    }
    expect(() => buildMenu(BOARD, { self: SELF, now: NOW, policy: null })).toThrow(/policy/i);
  });

  it("renders the menu Kuya asked for", () => {
    const text = renderMenu(menu());
    expect(text).toMatch(/What would you like to do\?/);
    expect(text).toMatch(/1\. Resume #18 .*\(Recommended\)/);
    expect(text).toMatch(/Context: 150k — standard/);
    expect(text).toMatch(/Context: 300k — experimental/);
    expect(text).toMatch(/Press Enter to resume #18\./);
    expect(menu().question).toMatch(/type 1, 2, 3, 18, 13, 19, or Q to cancel/i);
  });

  it("with no recommendation there is no Enter shortcut to press", () => {
    const m = menu(BOARD.filter((i) => i.number === 13 || i.number === 19));
    expect(renderMenu(m)).not.toMatch(/Press Enter/);
    expect(m.question).toMatch(/Q to cancel/i);
  });
});

describe("what the launcher accepts", () => {
  it("the ordinal and the issue number both select #18, in the same run", () => {
    const m = menu();
    expect(resolveChoice("1", m)).toMatchObject({ kind: "task", number: 18 });
    expect(resolveChoice("18", m)).toMatchObject({ kind: "task", number: 18 });
    expect(resolveChoice("#18", m)).toMatchObject({ kind: "task", number: 18 });
    expect(resolveChoice(" 2 ", m)).toMatchObject({ kind: "task", number: 13 });
    expect(resolveChoice("13", m)).toMatchObject({ kind: "task", number: 13 });
  });

  it("Enter takes the recommendation", () => {
    expect(resolveChoice("", menu())).toMatchObject({ kind: "task", number: 18 });
  });

  it("Enter with no recommendation is not a silent start", () => {
    const m = menu(BOARD.filter((i) => i.number === 13));
    expect(resolveChoice("", m).kind).toBe("invalid");
  });

  it("Q cancels", () => {
    expect(resolveChoice("q", menu()).kind).toBe("cancel");
    expect(resolveChoice("Q", menu()).kind).toBe("cancel");
  });

  it("an issue that is not on the menu explains the valid choices", () => {
    const r = resolveChoice("17", menu());
    expect(r.kind).toBe("invalid");
    expect(r.reason).toMatch(/1, 2, 3, 18, 13, 19/);
  });

  it("junk is invalid, not an accidental selection", () => {
    for (const junk of ["x", "-1", "0", "4", "1.5", "18 13"]) {
      expect(resolveChoice(junk, menu()).kind).toBe("invalid");
    }
  });
});

describe("the interactive loop", () => {
  it("re-prompts after invalid input instead of exiting", async () => {
    const ask = scriptedAsk(["zzz", "18"]);
    const said = [];
    const r = await chooseInteractively({ menu: menu(), ask, say: (s) => said.push(s) });
    expect(r).toMatchObject({ kind: "task", number: 18 });
    expect(ask.asked).toHaveLength(2);
    expect(said.join("\n")).toMatch(/1, 2, 3, 18, 13, 19/);
  });

  it("keeps reading until it gets an answer — the window that lost Kuya's '18' stayed open", async () => {
    const ask = scriptedAsk(["", ""]);
    const r = await chooseInteractively({ menu: menu(), ask, say: () => {} });
    expect(r).toMatchObject({ kind: "task", number: 18 });
  });

  it("Q leaves without a selection", async () => {
    const r = await chooseInteractively({ menu: menu(), ask: scriptedAsk(["q"]), say: () => {} });
    expect(r.kind).toBe("cancel");
  });

  it("a closed stdin cancels rather than hanging or guessing", async () => {
    const r = await chooseInteractively({ menu: menu(), ask: scriptedAsk([]), say: () => {} });
    expect(r.kind).toBe("cancel");
  });

  it("stops asking eventually instead of looping forever", async () => {
    const ask = scriptedAsk(Array(50).fill("nope"));
    const r = await chooseInteractively({ menu: menu(), ask, say: () => {} });
    expect(r.kind).toBe("cancel");
    expect(ask.asked.length).toBeLessThanOrEqual(10);
  });
});

describe("cmdChoose: the command the shortcut runs when it is given no issue", () => {
  const run = (answers, over = {}) => {
    const out = [];
    const said = [];
    return cmdChoose({
      board: { reachable: true, items: BOARD },
      self: SELF,
      now: NOW,
      policy: POLICY,
      ask: scriptedAsk(answers),
      say: (s) => said.push(s),
      out: (s) => out.push(s),
      ...over,
    }).then((code) => ({ code, out, said }));
  };

  it("Enter resumes #18: exit 0, and the issue is the only thing on stdout", async () => {
    const { code, out } = await run([""]);
    expect(code).toBe(0);
    expect(JSON.parse(out.join(""))).toMatchObject({ issue: 18, contextLabel: "150k — standard" });
  });

  it("typing 18 does the same thing as pressing Enter", async () => {
    const { out } = await run(["18"]);
    expect(JSON.parse(out.join("")).issue).toBe(18);
  });

  it("Q exits 2 with nothing on stdout — the launcher then writes nothing at all", async () => {
    const { code, out, said } = await run(["q"]);
    expect(code).toBe(2);
    expect(out).toEqual([]);
    expect(said.join("\n")).toMatch(/nothing was written|cancel/i);
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
