import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(here, "index.html"), "utf8");
const SCRIPT = /<script>([\s\S]*)<\/script>/.exec(PAGE)?.[1] ?? "";
const fn = (name) => new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}`).exec(PAGE)?.[0] ?? "";

describe("the default Console is one obvious starting surface", () => {
  it("leads with the owner's question, not a tool name or dashboard taxonomy", () => {
    expect(PAGE).toContain("What are we working on?");
    expect(PAGE).toContain("Tell Compy what you want");
    expect(PAGE).toMatch(/data-t="ch"[^>]*>[\s\S]*?Now<\/button>/);
    expect(PAGE).toMatch(/data-t="wk"[^>]*>[\s\S]*?Work/);
  });

  it("puts folder, agent, model, and effort inside one closed Change route disclosure", () => {
    const start = PAGE.indexOf('<details id="routeDetails"');
    const end = PAGE.indexOf("</details>", start);
    const block = PAGE.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(block).toContain("Change route");
    for (const id of ["chatFolder", "chatAgent", "chatModel", "chatEffort"]) expect(block).toContain(`id="${id}"`);
  });

  it("hides the six-machine-value strip while the conversation is active", () => {
    expect(PAGE).toMatch(/body\[data-view="ch"\] \.vitals\{display:none}/);
    expect(fn("switchTo")).toMatch(/document\.body\.dataset\.view = id/);
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
});

describe("work starts through the safety train", () => {
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
