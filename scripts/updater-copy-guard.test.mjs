// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// bug->guard (2026-07-22): the signed updater became Compy's one outbound network feature while
// several current user/legal surfaces still promised that the app made none. Pin both halves:
// no telemetry/account remains true, and the consent-first signed updater is disclosed.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const files = {
  settings: read("src", "surfaces", "Settings.tsx"),
  onboarding: read("src", "Onboarding.tsx"),
  setupTour: read("src", "surfaces", "setup", "SetupTour.tsx"),
  learn: read("src", "surfaces", "Learn.tsx"),
  privacy: read("docs", "PRIVACY.md"),
  betaGuide: read("docs", "BETA_TESTER_README.md"),
  landing: read("site-app", "src", "pages", "index.astro"),
  comparison: read("site-app", "src", "pages", "compare.astro"),
};

describe("updater disclosure copy", () => {
  it("does not ship obsolete absolute network promises on current surfaces", () => {
    expect(files.settings).not.toContain("nothing leaves your PC");
    expect(files.onboarding).not.toContain("Nothing leaves your PC");
    expect(files.setupTour).not.toContain("Nothing leaves your PC");
    expect(files.learn).not.toContain("Compy never fetches the internet");
    expect(files.privacy).not.toContain("Compy makes **no network requests**");
    expect(files.betaGuide).not.toContain("no network calls, no account, no auto-update");
    expect(files.betaGuide).not.toContain("No telemetry, no account, no remote anything, no updater");
    expect(files.landing).not.toContain("zero outbound connections");
    expect(files.landing).not.toContain("nothing leaves your PC");
    expect(files.comparison).not.toContain("zero outbound network requests");
  });

  it("discloses the signed, consent-first updater while preserving no-telemetry truth", () => {
    expect(files.settings).toContain("no telemetry");
    expect(files.settings).toContain("signed updates");
    expect(files.onboarding).toContain("signed update checks");
    expect(files.setupTour).toContain("signed update checks");
    expect(files.privacy).toContain("signed update");
    expect(files.privacy).toContain("No telemetry");
    expect(files.betaGuide).toContain("signed updater");
    expect(files.landing).toContain("signed update checks; downloads need your click");
    expect(files.comparison).toContain("signed updates");
  });
});
