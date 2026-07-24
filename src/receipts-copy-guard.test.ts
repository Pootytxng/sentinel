import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Receipts-arming copy guard (toolchain-enforced "stale-copy sweep").
//
// Today Compy is genuinely zero-telemetry: receipts_gate() returns false, no send path exists, and
// the user-facing "no telemetry / nothing leaves your PC / these never change" copy below is TRUE.
// The RECEIPTS_DOCTRINE plans an OPT-IN receipts telemetry (default-off). The moment that gate is
// armed, these absolute claims become false/over-broad — exactly the stale-copy trap an external
// audit warned about.
//
// This guard does NOT prematurely soften the (currently-honest) copy. Instead it FAILS the build the
// instant receipts_gate() is flipped to true while any watched absolute claim still ships — forcing
// the copy sweep to land in the SAME change that arms telemetry. While the gate is dark it also
// confirms the watched strings still exist, so the watch list can't silently rot out of date.

const receiptsRs = readFileSync(join("src-tauri", "src", "receipts.rs"), "utf8");

// Watched absolute telemetry claims that must be reworded before/when receipts arms.
//
// i18n update (2026-07-23): SetupTour.tsx and Settings.tsx had their copy extracted into
// src/i18n/locales/en/*.json as part of the Simplified Chinese translation — the English text is
// unchanged (still the source of truth for what ships in English), it just moved from a literal
// in the .tsx to a value in the matching locale JSON, read by the component via t(...). Per this
// guard's own doctrine above ("if the copy moved/changed, update WATCHED"), the `file` entries
// below now point at the JSON that actually carries the phrase. Onboarding.tsx (retired/unmounted)
// and setup-steps.ts (test-pinned pure data module) were deliberately left untouched by that pass,
// so those two entries still point at the original .tsx/.ts source.
const WATCHED: { file: string; phrase: string }[] = [
  { file: join("src", "Onboarding.tsx"), phrase: "no telemetry" },
  {
    file: join("src", "surfaces", "setup", "setup-steps.ts"),
    phrase: "No telemetry. These never change.",
  },
  { file: join("src", "i18n", "locales", "en", "home.json"), phrase: "no telemetry" },
  {
    file: join("src", "i18n", "locales", "en", "settings.json"),
    phrase: "no telemetry, nothing leaves your PC",
  },
];

function receiptsArmed(): boolean {
  const m = receiptsRs.match(
    /fn\s+receipts_gate\s*\(\s*\)\s*->\s*bool\s*\{\s*(true|false)\s*\}/,
  );
  if (!m) throw new Error("could not parse receipts_gate() return literal from receipts.rs");
  return m[1] === "true";
}

describe("receipts-arming copy guard", () => {
  it("receipts_gate() is parseable as a bool literal", () => {
    expect(() => receiptsArmed()).not.toThrow();
  });

  if (receiptsArmed()) {
    it("no absolute 'no telemetry' copy ships once receipts is armed (do the copy sweep!)", () => {
      for (const { file, phrase } of WATCHED) {
        const src = readFileSync(file, "utf8");
        expect(
          src.includes(phrase),
          `receipts_gate() is TRUE but ${file} still claims "${phrase}". Rework this copy ` +
            `(e.g. "local-only by default; optional opt-in sharing") before arming telemetry.`,
        ).toBe(false);
      }
    });
  } else {
    it("watched 'no telemetry' strings still exist while receipts is dark (keep the watch list live)", () => {
      for (const { file, phrase } of WATCHED) {
        const src = readFileSync(file, "utf8");
        expect(
          src.includes(phrase),
          `Watched phrase "${phrase}" no longer found in ${file}. If the copy moved/changed, ` +
            `update WATCHED in this test so the receipts-arming guard stays accurate.`,
        ).toBe(true);
      }
    });
  }
});
