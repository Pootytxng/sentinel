// Guard: the chat must be reachable without permission from the board.
//
// Shipped 2026-08-01 with the chat wired to exactly one entry point — a green Start button on a
// board item. `openChat` was only bound to `[data-open]` elements, and those were only rendered
// when `a.available && folder`. On any day where every item is owner-gated or belongs to another
// lane — the NORMAL state of this board — `startable` is 0, no Start button exists, and the chat
// drawer could not be opened at all. The owner's words were "as long as its literally just a chat
// box like this one were literally talking in now", and it was behind a door that is usually
// locked. He found it before any test did.
//
// A conversation needs a working directory, not a work item. These assert that.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(here, "index.html"), "utf8");
const SOURCES = readFileSync(join(here, "sources.mjs"), "utf8");

describe("the chat is a destination, not a reward", () => {
  it("has its own nav entry", () => {
    expect(PAGE).toMatch(/<button[^>]*data-t="ch"/);
  });

  it("is the tab the console opens on — the point of the console is the conversation", () => {
    // Exactly one pane and one nav button may carry `on` in the served markup.
    const openPanes = [...PAGE.matchAll(/<section class="pane on" id="(\w+)"/g)].map((m) => m[1]);
    expect(openPanes).toEqual(["ch"]);
    const openNav = [...PAGE.matchAll(/<button class="on" data-t="(\w+)"/g)].map((m) => m[1]);
    expect(openNav).toEqual(["ch"]);
  });

  it("lives inside that pane, not in a drawer something has to open", () => {
    const pane = /<section class="pane on" id="ch">([\s\S]*?)<\/section>/.exec(PAGE)?.[1] ?? "";
    expect(pane).toMatch(/id="chat"/);
    expect(pane).toMatch(/id="chatLog"/);
    expect(pane).toMatch(/id="chatBox"/);
    expect(pane).toMatch(/id="chatSend"/);
    expect(pane).toMatch(/id="chatFolder"/);
    // Both agents, in one place, exactly as asked for.
    expect(pane).toMatch(/<option value="claude">/);
    expect(pane).toMatch(/<option value="codex">/);
  });

  it("carries no leftover open/close machinery — a surface you must open can be closed to you", () => {
    expect(PAGE).not.toMatch(/id="chatClose"/);
    expect(PAGE).not.toMatch(/chatTitle/);
    expect(PAGE).not.toMatch(/\$\("chat"\)\.classList/);
  });

  it("sends to the folder the PICKER names, not to a folder a board item handed it", () => {
    const send = /async function send\(\)[\s\S]*?\n}/.exec(PAGE)?.[0] ?? "";
    expect(send, "send() not found").not.toBe("");
    expect(send).toMatch(/\$\("chatFolder"\)\.value/);
    // The old shape: `if (!text || !thread.folder) return;` — a silent refusal whenever no board
    // item had been clicked. Nothing may make sending conditional on a board item again.
    expect(send).not.toMatch(/thread\.folder/);
  });

  it("still lets a board item aim it — Start preselects the folder rather than owning the chat", () => {
    expect(PAGE).toMatch(/function openChat\(folder\)/);
    expect(PAGE).toMatch(/switchTo\("ch"\)/);
  });

  it("offers a chat on gated items too — asking about work is not claiming it", () => {
    const work = /function renderWork\(\)[\s\S]*?\n}/.exec(PAGE)?.[0] ?? "";
    expect(work).toMatch(/!a\.available && folder \? `<button[^`]*data-open=/);
  });
});

describe("the folder list the picker needs actually exists", () => {
  it("the snapshot carries folders", () => {
    expect(SOURCES).toMatch(/export function readFolders\(\)/);
    expect(SOURCES).toMatch(/^\s*folders: readFolders\(\),$/m);
  });

  it("readFolders reads checkouts rather than inventing a second list of them", () => {
    const fn = /export function readFolders\(\)[\s\S]*?\n}/.exec(SOURCES)?.[0] ?? "";
    expect(fn).toMatch(/discoverCheckouts/);
    // Wrapped in attempt(): an unreadable disk must render as "unreachable", never as a blank picker
    // that silently refuses to send.
    expect(fn).toMatch(/attempt\(/);
  });
});
