// Guard: a click must never read as a no-op, and the box must never open empty.
//
// The owner, on first real use: "im clicking the buttons like start and run the launcher and
// nothing happens like it should auto generate and paste the prompt if i click a button like start
// or give me a multiple choice list of how to proceed with suggested actions highlighted."
//
// Both complaints were true, and both were WORSE than nothing happening:
//
//   Start          — swapped tabs and left an empty box. A blank prompt box asks the person who
//                    came here for help to do the hardest part first, so the click read as dead.
//   Run launcher   — actually ran. It opened a console window on the OTHER MONITOR, claimed work,
//                    checked out feat/bklit-anime-design-system in the host repo and let an agent
//                    commit to it. The page went on showing the old world. Confirmed in the reflog
//                    at 11:57:16 and 11:58:14 on 2026-08-01, ~18 minutes before he asked why
//                    nothing was happening.
//
// An action with invisible consequences is the most expensive kind of bug in a tool whose whole
// job is telling you where things actually are.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(here, "index.html"), "utf8");

const fn = (name) => new RegExp(`(?:function|const) ${name}[\\s\\S]*?\\n}`).exec(PAGE)?.[0] ?? "";

describe("every chat opens with somewhere to start", () => {
  it("has a suggestion strip in the chat panel", () => {
    const pane = /<section class="pane on" id="ch">([\s\S]*?)<\/section>/.exec(PAGE)?.[1] ?? "";
    expect(pane).toMatch(/id="sugg"/);
    // Above the input, not below it — it is a way IN to the box, not an afterthought.
    expect(pane.indexOf('id="sugg"')).toBeLessThan(pane.indexOf('id="chatBox"'));
  });

  it("offers a MENU, not a single option", () => {
    expect(PAGE).toMatch(/const FOLDER_SUGGESTIONS/);
    expect(PAGE).toMatch(/const ITEM_SUGGESTIONS/);
    for (const name of ["FOLDER_SUGGESTIONS", "ITEM_SUGGESTIONS"]) {
      const body = new RegExp(`const ${name} = [\\s\\S]*?\\n\\];|const ${name} = [\\s\\S]*?\\n};`).exec(PAGE)?.[0] ?? "";
      expect(body, `${name} not found`).not.toBe("");
      expect((body.match(/title:/g) ?? []).length, `${name} needs several ways in`).toBeGreaterThanOrEqual(3);
    }
  });

  it("marks exactly ONE option recommended in each menu — a highlight on everything highlights nothing", () => {
    for (const name of ["FOLDER_SUGGESTIONS", "ITEM_SUGGESTIONS"]) {
      const body = new RegExp(`const ${name} = [\\s\\S]*?\\n\\];|const ${name} = [\\s\\S]*?\\n};`).exec(PAGE)?.[0] ?? "";
      expect((body.match(/rec: true/g) ?? []).length, `${name} must recommend exactly one`).toBe(1);
    }
  });

  it("the recommended one is visibly different, not just first", () => {
    expect(PAGE).toMatch(/\.sugg-chip\.rec\{/);
    expect(PAGE).toMatch(/RECOMMENDED/);
  });

  it("pre-fills the box with the recommended prompt, so the minimum action is pressing Enter", () => {
    const s = fn("setSuggestions");
    expect(s).toMatch(/list\.find\(\(s\) => s\.rec\)/);
    expect(s).toMatch(/\$\("chatBox"\)\.value = rec\.prompt/);
  });

  it("never clobbers something already typed", () => {
    expect(fn("setSuggestions")).toMatch(/!\$\("chatBox"\)\.value\.trim\(\)/);
  });

  it("fills the box rather than sending — a suggestion is a starting line, not a decision", () => {
    const s = fn("setSuggestions");
    expect(s).not.toMatch(/\bsend\(\)/);
  });
});

describe("Start carries the item it was clicked from", () => {
  it("openChat takes the item, not just a folder", () => {
    expect(PAGE).toMatch(/function openChat\(folder, item\)/);
    const o = fn("openChat");
    expect(o).toMatch(/ITEM_SUGGESTIONS\(item\)/);
    // …and falls back to folder-level suggestions when there is no item.
    expect(o).toMatch(/else folderSuggestions\(\)/);
  });

  it("the board button hands over the real item", () => {
    const w = /function renderWork\(\)[\s\S]*?\n}/.exec(PAGE)?.[0] ?? "";
    expect(w).toMatch(/data-item="\$\{i\.number\}"/);
    expect(w).toMatch(/S\.work\.items\.find\(/);
  });

  it("a gated item gets a prompt about the block, not a prompt to start work", () => {
    const body = /const ITEM_SUGGESTIONS = [\s\S]*?\n};/.exec(PAGE)?.[0] ?? "";
    expect(body).toMatch(/Why is this stuck\?/);
    expect(body).toMatch(/item\.reason/);
  });
});

describe("an action with consequences says so", () => {
  it("a selected item explicitly says there is no terminal to find or keep open", () => {
    const launch = /async function launchIssue\([\s\S]*?\n}/.exec(PAGE)?.[0] ?? "";
    expect(launch).toMatch(/no terminal you need to keep open/i);
    expect(launch).not.toMatch(/other monitor/i);
  });

  it("re-reads the world after the launcher runs, so the board cannot keep showing the old one", () => {
    const launch = /async function launchIssue\([\s\S]*?\n}/.exec(PAGE)?.[0] ?? "";
    expect(launch).toMatch(/setTimeout\(load,/);
  });

  it("a refresh does NOT wipe a conversation or a half-typed prompt", () => {
    const l = /async function load\(\)[\s\S]*?\n}/.exec(PAGE)?.[0] ?? "";
    expect(l).toMatch(/if \(!seeded\)/);
  });
});
