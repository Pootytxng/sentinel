import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// SETTINGS ROLLOUT-SWITCH GUARD (comprehensibility sweep 2026-08-20, issue #180 §D —
// bug→guard tier 1).
//
// The defect class: a feature ships behind a DEFAULT-OFF toggle to de-risk rollout, graduates to
// default-ON, and the switch stays behind. Settings then carries developer-era forks ("Live
// console", "JARVIS motion") next to genuine user preferences, and a mass-market user cannot tell
// which is which. The owner read that screen as a regression; the real finding was rollout debt
// that had never been swept (plan 2026-08-20-comprehensibility-sweep §2).
//
// THE LAW this guard mechanizes: a Settings row must be a GENUINE PREFERENCE — a choice a user
// re-visits because their taste or environment differs (theme, language, motion, tray, overlay…)
// — never a switch whose only job is to preserve a superseded face of the app. Superseded faces
// are deleted, not preserved behind a toggle (the one-face rule, see monitor-one-face-guard).
//
// MECHANISM. Every `settings.*.title` row key rendered by Settings.tsx must appear in the
// allowlist below. Adding a row therefore fails this test until the author classifies it HERE,
// in a reviewed diff, as a genuine preference — which is exactly the moment a rollout switch
// gets caught, because "restores the old look/face" cannot be argued into that definition.
// Deleting a row never fails.

const ALLOWED_ROW_TITLES = new Set([
  // Genuine preferences, each with the choice it encodes:
  "settings.language.title", // which language the UI speaks
  "settings.behavior.closeToTray.title", // close button hides vs exits
  "settings.behavior.motion.title", // Full / Follow system / Reduced (the ONE motion switch)
  "settings.behavior.homeInterview.title", // ask a question on Home, or keep it silent
  "settings.behavior.expertView.title", // un-hide expert data (a real tinkerer preference, 5850ac0f)
  "settings.behavior.overlayDensity.title", // in-game overlay: how much it shows
  "settings.behavior.overlayBackdrop.title", // in-game overlay: plate vs transparent
  "settings.setup.title", // re-run first-time setup (an action, not a fork)
  "settings.about.updateChecks.title", // the one outbound call's off switch
]);

describe("Settings rollout-switch guard (issue #180)", () => {
  const src = readFileSync(join("src", "surfaces", "Settings.tsx"), "utf8");

  it("every Settings row is a classified genuine preference — no unreviewed switches", () => {
    const rendered = [...src.matchAll(/t\("(settings\.[\w.]+\.title)"\)/g)].map((m) => m[1]);
    expect(rendered.length, "Settings.tsx renders no rows — the extractor regex went stale").toBeGreaterThan(0);
    const unclassified = [...new Set(rendered)].filter((k) => !ALLOWED_ROW_TITLES.has(k));
    expect(
      unclassified,
      `Settings gained row(s) not classified as genuine preferences: ${unclassified.join(", ")}.\n` +
        "If this is a real user preference, add it to ALLOWED_ROW_TITLES with a one-line 'choice " +
        "it encodes' comment. If its job is to preserve a superseded face or de-risk a rollout, " +
        "it is barred (issue #180): ship the feature as the one face, or keep a devtools-only " +
        "localStorage failsafe with NO Settings row.",
    ).toEqual([]);
  });

  it("the two swept rollout switches stay gone", () => {
    for (const key of ["settings.appearance.monitorConsole", "settings.appearance.jarvisMotion"]) {
      expect(
        src.includes(key),
        `${key} is back in Settings.tsx — it was retired as rollout debt (issue #180 §B)`,
      ).toBe(false);
    }
  });
});
