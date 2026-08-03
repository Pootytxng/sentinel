// Guard: the one store the console owns must never lose what the owner typed, and must never
// quietly become a second source of truth.

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { EMPTY, addIdea, addLink, providerOf, readNotes, remove, writeNotes } from "./notes.mjs";

const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "compy-notes-")); dirs.push(d); return join(d, "notes.json"); };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("it degrades instead of blocking the console", () => {
  it("a missing file reads as empty", () => {
    expect(readNotes({ file: tmp() })).toEqual(EMPTY);
  });

  it("a CORRUPT file reads as empty rather than throwing — notes must never take the console down", () => {
    const f = tmp();
    writeFileSync(f, "{ this is not json", "utf8");
    expect(readNotes({ file: f })).toEqual(EMPTY);
  });

  it("a file with the wrong shape is coerced, not trusted", () => {
    const f = tmp();
    writeFileSync(f, JSON.stringify({ ideas: "nope", links: null }), "utf8");
    expect(readNotes({ file: f })).toEqual(EMPTY);
  });
});

describe("writes are atomic, because losing typed notes is the failure that matters", () => {
  it("leaves no temp file behind", () => {
    const f = tmp();
    writeNotes({ ideas: [], links: [] }, { file: f });
    expect(existsSync(f)).toBe(true);
    expect(existsSync(`${f}.tmp-${process.pid}`)).toBe(false);
  });

  it("round-trips exactly", () => {
    const f = tmp();
    const v = { ideas: [{ id: "a", text: "x", folder: null, created: "2026-08-01T00:00:00.000Z" }], links: [] };
    writeNotes(v, { file: f });
    expect(readNotes({ file: f })).toEqual(v);
  });
});

describe("ideas", () => {
  it("keeps newest first, so the inbox reads like an inbox", () => {
    const f = tmp();
    addIdea({ text: "first", file: f, now: new Date("2026-08-01T10:00:00Z"), id: "1" });
    addIdea({ text: "second", file: f, now: new Date("2026-08-01T11:00:00Z"), id: "2" });
    expect(readNotes({ file: f }).ideas.map((i) => i.text)).toEqual(["second", "first"]);
  });

  it("refuses an empty or whitespace-only idea", () => {
    const f = tmp();
    expect(addIdea({ text: "   ", file: f }).ok).toBe(false);
    expect(readNotes({ file: f }).ideas).toEqual([]);
  });

  it("refuses something that is really a spec, and says why", () => {
    const r = addIdea({ text: "x".repeat(4001), file: tmp() });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/train/);
  });
});

describe("links point only at real conversations", () => {
  it.each([
    ["https://chatgpt.com/c/abc", "chatgpt"],
    ["https://chat.openai.com/c/abc", "chatgpt"],
    ["https://claude.ai/chat/abc", "claude"],
  ])("%s -> %s", (url, want) => expect(providerOf(url)).toBe(want));

  it.each([
    ["https://evil.com/chatgpt.com"],
    ["https://chatgpt.com.evil.com/x"],
    ["not a url"],
    [""],
  ])("refuses %s", (url) => {
    expect(providerOf(url)).toBe(null);
    expect(addLink({ title: "t", url, file: tmp() }).ok).toBe(false);
  });

  it("accepts a real subdomain of a provider, not a lookalike", () => {
    expect(providerOf("https://app.claude.ai/chat/1")).toBe("claude");
  });

  it("falls back to a sensible title rather than storing a blank one", () => {
    const r = addLink({ title: "  ", url: "https://claude.ai/chat/1", file: tmp() });
    expect(r.ok).toBe(true);
    expect(r.link.title).toBe("Claude conversation");
  });
});

describe("removal", () => {
  it("removes by id and leaves the rest", () => {
    const f = tmp();
    addIdea({ text: "keep", file: f, id: "k" });
    addIdea({ text: "drop", file: f, id: "d" });
    expect(remove({ kind: "ideas", id: "d", file: f }).ok).toBe(true);
    expect(readNotes({ file: f }).ideas.map((i) => i.id)).toEqual(["k"]);
  });

  it("refuses an unknown list rather than creating one", () => {
    expect(remove({ kind: "secrets", id: "x", file: tmp() }).ok).toBe(false);
  });

  it("reports a miss instead of silently succeeding", () => {
    expect(remove({ kind: "ideas", id: "nope", file: tmp() }).ok).toBe(false);
  });
});

describe("the shared-array bug this file caught, pinned so it cannot come back", () => {
  it("two reads of a missing file do not share their arrays", () => {
    const a = readNotes({ file: tmp() });
    const b = readNotes({ file: tmp() });
    expect(a.ideas).not.toBe(b.ideas);
    expect(a.links).not.toBe(b.links);
  });

  it("writing to one fresh file cannot leak into a read of a different one", () => {
    const one = tmp();
    const two = tmp();
    addIdea({ text: "only in one", file: one, id: "x" });
    expect(readNotes({ file: two }).ideas).toEqual([]);
  });

  it("EMPTY is frozen, so a future accidental mutation is loud instead of silent", () => {
    expect(Object.isFrozen(EMPTY)).toBe(true);
    expect(Object.isFrozen(EMPTY.ideas)).toBe(true);
    expect(() => { "use strict"; EMPTY.ideas.push({ id: "boom" }); }).toThrow();
    expect(EMPTY.ideas).toEqual([]);
  });
});
