// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// bug->guard (2026-07-22): citation checks were green while current guidance simultaneously said
// the updater was absent, fully E2E-proven, and the app made no outbound connection. Historical
// archives may retain dated truth; this guard pins only living product/release guidance.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");

const current = {
  release: read("docs", "RELEASE_STATE.md"),
  backlog: read("docs", "BACKLOG.md"),
  owner: read("docs", "OWNER_ACTION_CHECKLIST.md"),
  doctrine: read("docs", "RECEIPTS_DOCTRINE.md"),
  claude: read("CLAUDE.md"),
  gateBrief: read("docs", "GATE_DECISIONS.md"),
  smoke: read("docs", "BETA_SMOKE_CHECKLIST.md"),
  tracker: read("docs", "BETA_TESTER_TRACKER.md"),
  overview: read("COMPY_OVERVIEW.md"),
  cspGuard: read("src", "csp-lockdown-guard.test.ts"),
};

describe("current release truth stays internally consistent", () => {
  it("does not overstate updater field proof", () => {
    expect(current.backlog).not.toMatch(/SHIPPED\s*\+\s*E2E-PROVEN/i);
    expect(current.backlog).not.toMatch(/0\.9\.2 self-updated to 0\.9\.3 through the updater/i);
    expect(current.release).toContain("Do not call this updater-E2E proof");
    expect(current.release).toContain("operationally corroborated");
  });

  it("keeps the next tester send behind a clean staged candidate", () => {
    expect(current.release).toMatch(/do not send it as the new\s+tester baseline/i);
    expect(current.owner).toContain("Do not send v0.9.4 as the new tester baseline");
    expect(current.owner).toMatch(/0\.9\.5-or-later candidate/i);
    expect(current.owner).not.toMatch(/send (?:the )?0\.9\.[0-4]/i);
  });

  it("distinguishes the signed updater from telemetry and webview networking", () => {
    expect(current.doctrine).toContain("signed updater");
    expect(current.doctrine).toContain("one narrow outbound surface");
    expect(current.doctrine).not.toContain("updater off");
    expect(current.claude).toContain("live signed updater");
    expect(current.claude).not.toContain("verified zero-outbound property holds");
    expect(current.gateBrief).toContain("HISTORICAL PROCESS BRIEF");
    expect(current.gateBrief).toContain("now LIVE");
    expect(current.overview).toContain("Local-first, one outbound feature");
    expect(current.smoke).toContain("only the documented signed");
    expect(current.tracker).toContain("signed update check");
    expect(current.cspGuard).toContain("production webview cannot reach remote hosts");
    expect(current.cspGuard).not.toContain("production CSP stays zero-outbound");
  });
});
