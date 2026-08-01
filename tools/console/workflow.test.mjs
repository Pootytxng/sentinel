// Guard: the console must never go quiet, send him to GitHub, or call separate folders a complete
// collision guarantee when the ownership/claim train has not run.
//
// The owner, after using it properly for the first time:
//
//   "i tried to send it but it was greyed out at first now its lit again but had no idea why it
//    was greyed out ... i need live visuals and indicators shit is working or in process, when and
//    why i cant begin another task, what task allow for me to bundle together into one big bulk run
//    or mutiple parallel runs that are guaranteed not to conflict or collide ... anything gated or
//    needing review should not take me to github because idk wtf github even does or how it works
//    and i dont want to i jsut know i need it ... maybe make a little alert or notification bell on
//    a hotbar with color coded indicators ... with ready to go clickable buttons that will take me
//    where i need to and or paste ready prompt i just send or auto sends upon clicking."
//
// Four separate laws come out of that, and each one has teeth below.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(here, "index.html"), "utf8");
const SCRIPT = /<script>([\s\S]*)<\/script>/.exec(PAGE)?.[1] ?? "";
const fn = (name) => new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}`).exec(PAGE)?.[0] ?? "";

describe("law 1 — a disabled control says why, where it is", () => {
  it("the chat has a working bar next to the button that disables", () => {
    expect(PAGE).toMatch(/id="chatWorking"/);
    expect(PAGE).toMatch(/id="chatElapsed"/);
    expect(PAGE).toMatch(/class="spin"/);
  });

  it("the reason names the agent and says another cannot be sent yet", () => {
    const s = fn("send");
    expect(s).toMatch(/chatWorkingText.*is working — you can't send another until it finishes/s);
  });

  it("the button itself stops reading 'Send' while it cannot send", () => {
    const s = fn("send");
    expect(s).toMatch(/\$\("chatSend"\)\.textContent = "Working…"/);
    expect(s).toMatch(/\$\("chatSend"\)\.textContent = "Send"/);
  });

  it("a turn in flight can be STOPPED — a wait with no exit is a hang", () => {
    expect(PAGE).toMatch(/id="chatStop"/);
    expect(fn("send")).toMatch(/signal: chatAbort\.signal/);
  });

  it("the hotbar reports the same state on every tab, not just the chat", () => {
    expect(PAGE).toMatch(/class="hotbar"/);
    expect(PAGE).toMatch(/id="liveDot"/);
    expect(SCRIPT).toMatch(/setInterval\(paintLive, 1000\)/);
  });

  it("a finished turn re-reads the world — the page cannot keep showing the old one", () => {
    expect(fn("send")).toMatch(/load\(\);/);
  });
});

describe("law 2 — the bell is colour-coded and every alert is actionable", () => {
  it("exists, with the three colours", () => {
    expect(PAGE).toMatch(/id="bell"/);
    for (const c of [".dot.g{", ".dot.a{", ".dot.r{"]) expect(PAGE).toContain(c);
  });

  it("severity is the WORST present, not an average — one red must not hide behind two greens", () => {
    const p = fn("paintBell");
    expect(p).toMatch(/some\(\(a\) => a\.sev === "r"\) \? "r"/);
  });

  it("every alert carries buttons that act, not just text", () => {
    const b = fn("buildAlerts");
    expect(b).toMatch(/acts: \[/);
    // Each action either moves you somewhere in the console, or asks — never a link out.
    expect(b).not.toMatch(/https?:\/\//);
  });

  it("clicking an alert action SENDS the prompt — no second step", () => {
    expect(fn("askNow")).toMatch(/send\(prompt\)/);
    expect(fn("paintBell")).toMatch(/askNow\(/);
  });

  it("says so plainly when nothing needs him", () => {
    expect(fn("buildAlerts")).toMatch(/Nothing needs you/);
  });

  it("only owner-gated work counts as needing him", () => {
    const b = fn("buildAlerts");
    expect(b).toMatch(/status === "Needs Kuya" \|\| i\.gate === "Kuya"/);
    expect(b).not.toMatch(/for \(const p of pulls\)/);
    expect(b).not.toMatch(/const stuck = .*availability\.available/);
  });

  it("does not call a branch lost when an open work item names that exact branch", () => {
    const b = fn("buildAlerts");
    expect(b).toMatch(/accountedBranches/);
    expect(b).toMatch(/!accountedBranches\.has\(f\.name\)/);
  });
});

describe("law 3 — GitHub is out of the flow", () => {
  it("no github.com link survives anywhere in the page's behaviour", () => {
    // The whole barrier is the vocabulary, so "go read it on GitHub" is not an answer — an agent
    // that can already read the issue, the diff and the code explains it in this window instead.
    const links = SCRIPT.match(/https:\/\/github\.com[^"'`\s)]*/g) ?? [];
    expect(links, `still links out: ${links.join(", ")}`).toEqual([]);
  });

  it("the board explains an item here instead of opening it there", () => {
    const w = fn("renderWork");
    expect(w).toMatch(/data-explain=/);
    expect(w).toMatch(/askNow\(/);
  });

  it("every decision row's prompts tell the agent he does not know GitHub", () => {
    const d = fn("renderDecisions");
    expect((d.match(/do not know how GitHub works/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("law 4 — a folder is not a claim, so starts use the real safety train", () => {
  it("startable items carry an issue-number launcher action", () => {
    const w = fn("renderWork");
    expect(w).toMatch(/data-launch=/);
    expect(w).toMatch(/launchIssue\(Number\(b\.dataset\.launch\), b\)/);
  });

  it("the disproven bulk-run controls are gone", () => {
    const w = fn("renderWork");
    expect(w).not.toMatch(/data-batch|batchGo|Run these together|cannot touch the same files/);
  });

  it("unavailable items remain explainable without pretending they can start", () => {
    const w = fn("renderWork");
    expect(w).toMatch(/Ask about it/);
    expect(w).toMatch(/data-explain=/);
  });
});

describe("law 5 — the model pickers offer what the CLIs actually accept", () => {
  it("offers real options, per agent, not one hardcoded list for both", () => {
    expect(SCRIPT).toMatch(/const MODELS = \{[\s\S]*?claude:[\s\S]*?codex:/);
    expect(SCRIPT).toMatch(/const EFFORTS = \{[\s\S]*?claude:[\s\S]*?codex:/);
  });

  it("only offers effort levels `claude --help` actually lists", () => {
    // low, medium, high, xhigh, max — read from the installed CLI on 2026-08-01, not invented.
    // One entry per line, so take the LINE — `[^\]]*` stops at the first `]`, which is inside the
    // very first pair. (It did, and this test failed on its own regex before it failed on anything real.)
    const block = /^\s*claude: \[\["", "effort · default"\].*$/m.exec(SCRIPT)?.[0] ?? "";
    expect(block, "claude effort list not found").not.toBe("");
    for (const e of ["low", "medium", "high", "xhigh", "max"]) expect(block).toContain(`"${e}"`);
    // "ultra" is a Codex-side level; offering it to Claude would be a menu entry that fails.
    expect(block).not.toContain('"ultra"');
  });

  it("offers the Codex models his own config names, not guesses", () => {
    const block = /^\s*codex: \[\["", "model · your default"\].*$/m.exec(SCRIPT)?.[0] ?? "";
    expect(block, "codex model list not found").not.toBe("");
    expect(block).toContain("gpt-5.6-sol");
    expect(block).toContain("gpt-5.6-terra");
  });

  it("swapping the agent rebuilds the menus — a Claude model must not linger on Codex", () => {
    expect(SCRIPT).toMatch(/\$\("chatAgent"\)\.addEventListener\("change", \(\) => \{ paintModelOptions\(\);/);
  });
});

describe("law 6 — each suggestion names the rig it wants", () => {
  it("shows a starred agent/model/effort on the chip", () => {
    expect(SCRIPT).toMatch(/const bestLabel = \(b\) => b \? `★ /);
    expect(SCRIPT).toMatch(/class="sb"/);
  });

  it("clicking a suggestion APPLIES that rig — a recommendation you must hand-copy is a note", () => {
    expect(fn("setSuggestions")).toMatch(/applyBest\(s\.best\)/);
    expect(fn("setSuggestions")).toMatch(/applyBest\(rec\.best\)/);
    expect(fn("applyBest")).toMatch(/syncRouteSummary\(\)/);
  });

  it("every suggestion in both menus carries one", () => {
    for (const name of ["FOLDER_SUGGESTIONS", "ITEM_SUGGESTIONS"]) {
      const body = new RegExp(`const ${name} = [\\s\\S]*?\\n\\];|const ${name} = [\\s\\S]*?\\n};`).exec(SCRIPT)?.[0] ?? "";
      const titles = (body.match(/title:/g) ?? []).length;
      const bests = (body.match(/best: \{/g) ?? []).length;
      expect(bests, `${name}: ${titles} options but ${bests} recommendations`).toBe(titles);
    }
  });

  it("the adversarial one deliberately picks the OTHER vendor", () => {
    // An argument against a plan is worth more from a model that did not help write it.
    const body = /const ITEM_SUGGESTIONS = [\s\S]*?\n};/.exec(SCRIPT)?.[0] ?? "";
    const argue = /Argue against it[\s\S]*?prompt:/.exec(body)?.[0] ?? "";
    expect(argue).toMatch(/agent: "codex"/);
  });
});
