import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(here, "index.html"), "utf8");
const SCRIPT = /<script>([\s\S]*)<\/script>/.exec(PAGE)?.[1] ?? "";
const fn = (name) => new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}`).exec(PAGE)?.[0] ?? "";

describe("the default Console is one obvious owner journey", () => {
  it("offers exactly Continue, Start, and History as the primary actions", () => {
    const primaryNav = /<nav aria-label="Compy Console">([\s\S]*?)<details/.exec(PAGE)?.[1] ?? "";
    expect(primaryNav).toMatch(/data-t="ch"[^>]*>[\s\S]*?Continue<\/button>/);
    expect(primaryNav).toMatch(/data-t="wk"[^>]*>[\s\S]*?Start/);
    expect(primaryNav).toMatch(/data-t="hs"[^>]*>[\s\S]*?History/);
    expect(primaryNav).not.toMatch(/>Now<\/button>|>Work|>Chats/);
    expect(primaryNav.match(/data-t=/g)).toHaveLength(3);
  });

  it("puts folder, agent, model, and effort inside one closed Change route disclosure", () => {
    const start = PAGE.indexOf('<details id="routeDetails"');
    const end = PAGE.indexOf("</details>", start);
    const block = PAGE.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(block).toContain("Change route");
    for (const id of ["chatFolder", "chatAgent", "chatModel", "chatEffort"]) expect(block).toContain(`id="${id}"`);
    expect(PAGE.indexOf('<section class="pane" id="wk">')).toBeLessThan(start);
  });

  it("keeps machine vitals out of all three primary actions", () => {
    expect(PAGE).toMatch(/body:is\(\[data-view="ch"\],\[data-view="wk"\],\[data-view="hs"\]\) \.vitals\{display:none}/);
    expect(fn("switchTo")).toMatch(/document\.body\.dataset\.view = id/);
  });

  it("gives Start one plain-language composer and keeps work cards on the same surface", () => {
    expect(PAGE).toContain('id="startBox"');
    expect(PAGE).toContain('id="startSend"');
    expect(PAGE).toContain('id="workList"');
    expect(fn("startFromPrompt")).toMatch(/newThread[\s\S]*switchTo\("ch"\)[\s\S]*send\(text\)/);
    expect(fn("render")).toMatch(/pip\("p-wk",[\s\S]*S\.work\.startable \? "ok" : ""/);
  });

  it("makes History searchable and projects native sessions through the noise filter", () => {
    expect(PAGE).toContain('id="historySearch"');
    expect(PAGE).toContain('id="historySummary"');
    expect(fn("renderChats")).toMatch(/projectHistory/);
    expect(SCRIPT).toMatch(/historySearch[\s\S]*renderChats/);
    expect(fn("render")).toMatch(/projectHistory[\s\S]*pip\("p-hs"/);
  });

  it("shows a clear reload action when the loaded interface is behind the server", () => {
    expect(PAGE).toContain('id="updateNotice"');
    expect(PAGE).toContain('id="reloadConsole"');
    expect(fn("checkRevision")).toMatch(/\/api\/meta/);
    expect(fn("checkRevision")).toMatch(/PAGE_REVISION/);
  });
});

describe("natural input and durable conversation continuity", () => {
  it("typing an issue number routes that exact item through the launcher", () => {
    expect(fn("send")).toMatch(/match\(\/\^#\?\(\\d\+\)\$\//);
    expect(fn("send")).toMatch(/launchIssue\(Number\(issueOnly\[1\]\)\)/);
  });

  it("does not install a random browser UUID as the durable thread id", () => {
    expect(fn("send")).not.toMatch(/thread\.id\s*=\s*crypto\.randomUUID/);
    expect(fn("send")).not.toMatch(/sessionId|crypto\.randomUUID/);
    expect(fn("send")).toMatch(/ev === "thread"[\s\S]*thread\.id = d\.threadId/);
  });

  it("makes every saved chat reopenable with its native route and transcript", () => {
    expect(PAGE).toContain('id="chatList"');
    expect(fn("renderChats")).toMatch(/data-chat-agent/);
    expect(fn("renderChats")).toMatch(/Continue/);
    expect(fn("openSavedChat")).toMatch(/\/api\/chats\//);
    expect(fn("openSavedChat")).toMatch(/thread = \{ id: chat\.id/);
    expect(fn("openSavedChat")).toMatch(/\$\("chatBox"\)\.value = ""/);
    expect(fn("openSavedChat")).toMatch(/chat\.truncated[\s\S]*most recent/);
    expect(fn("openSavedChat")).toMatch(/switchTo\("ch"\)/);
  });

  it("distinguishes readable archives from conversations that can actually continue", () => {
    const history = fn("renderChats");
    expect(history).toMatch(/availableFolders/);
    expect(history).toMatch(/chat\.resumable \? "Continue" : "Read"/);
    expect(fn("renderContinueLanding")).toMatch(/availableFolders/);
  });

  it("the global working indicator returns to the active conversation", () => {
    expect(PAGE).toMatch(/<button[^>]*id="liveState"/);
    expect(SCRIPT).toMatch(/liveState[\s\S]*switchTo\("ch"\)/);
  });

  it("starting over cannot replace a conversation while its answer is still running", () => {
    const startOver = fn("newThread");
    expect(startOver).toMatch(/if \(chatAbort\)/);
    expect(startOver.indexOf("if (chatAbort)")).toBeLessThan(startOver.indexOf("thread = { id: null }"));
    expect(startOver).toMatch(/if \(chatAbort\)[\s\S]*switchTo\("ch"\)[\s\S]*return false/);
  });

  it("opening saved history cannot replace a conversation that is still streaming", () => {
    const open = fn("openSavedChat");
    expect(open).toMatch(/if \(chatAbort\)/);
    expect(open.indexOf("if (chatAbort)")).toBeLessThan(open.indexOf("await fetch"));
    expect(open).toMatch(/if \(chatAbort\)[\s\S]*switchTo\("ch"\)[\s\S]*return/);
    expect(open.lastIndexOf("if (chatAbort)")).toBeGreaterThan(open.indexOf("await response.json()"));
  });

  it("locks route identity for the lifetime of a running turn", () => {
    expect(fn("lockChatRoute")).toMatch(/chatNew[\s\S]*chatFolder[\s\S]*chatAgent/);
    expect(fn("send")).toMatch(/lockChatRoute\(true\)[\s\S]*finally[\s\S]*lockChatRoute\(false\)/);
  });

  it("only a real running chat process can show the working bar", () => {
    expect(fn("paintLive")).toMatch(/busy = Boolean\(chatAbort\)/);
    expect(fn("paintLive")).not.toMatch(/chatSend"\)\.disabled/);
  });

  it("programmatic Ask and Work actions refuse before mutating the live route", () => {
    for (const name of ["askNow", "openChat"]) {
      const action = fn(name);
      expect(action).toMatch(/if \(chatAbort\)/);
      expect(action.indexOf("if (chatAbort)")).toBeLessThan(action.indexOf('const sel = $("chatFolder")'));
    }
  });
});

describe("work starts through the safety train", () => {
  it("never labels unavailable work as Ready", () => {
    const work = fn("renderWork");
    expect(work).toMatch(/availabilityLabel\(i\)/);
    expect(work).not.toMatch(/a\.available \? "Ready" : esc\(i\.status\)/);
  });

  it("a green board action launches its issue instead of directly spawning chat in the folder", () => {
    expect(fn("renderWork")).toMatch(/data-launch=/);
    expect(fn("renderWork")).toMatch(/launchIssue\(Number\(b\.dataset\.launch\), b\)/);
    expect(fn("renderWork")).not.toMatch(/data-batch/);
  });

  it("the default page explains that implementation uses the safety checks automatically", () => {
    expect(PAGE).toContain("safety checks happen automatically");
  });

  it("never offers implementation inside the read-only conversation", () => {
    const suggestions = /const ITEM_SUGGESTIONS = [\s\S]*?\n};/.exec(SCRIPT)?.[0] ?? "";
    expect(suggestions).not.toMatch(/Just do it|Implement .* end to end/);
  });

  it("only puts owner-gated work under Your decisions", () => {
    expect(fn("renderDecisions")).toMatch(/status === "Needs Kuya" \|\| x\.gate === "Kuya"/);
  });

  it("does not call a draft pull request a finished decision", () => {
    expect(fn("renderDecisions")).toMatch(/filter\(\(p\) => !p\.draft\)/);
  });
});
