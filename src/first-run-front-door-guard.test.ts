import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// FIRST-RUN FRONT-DOOR GUARD (C-05, 2026-08-18).
//
// docs/decisions/2026-08-11-design-navigation-audit.md §4: "the tour stops being the front door.
// Land on the diagnosis; offer the tour as a card the user can choose."
//
// THREE separate defects live under that one sentence, and each gets its own case, because fixing
// one without the others is worse than fixing none:
//
//   1. AUTO-OPEN. App.tsx opened SetupTour on first run from two localStorage keys. A user whose
//      PC just crashed met a 10-step hardware lecture instead of an answer.
//
//   2. THE MISSING DOOR. "The launcher card already exists" was true of HomeHud and HomeV2 — and
//      false of HomeConsole, which is the DEFAULT Home (HomeRoom.tsx: `if (homeConsole) return
//      <HomeConsole/>`, flag ON unless literally "0"). Deleting the auto-open ALONE would have
//      stranded the whole tour behind Settings on the build every user actually runs. Verified
//      live before the fix: document.querySelectorAll('.stl-card').length === 0.
//
//   3. TWO NAMES. The same flow called itself "Guided setup" on step 1 and "Hardware tour" on
//      step 5. A user cannot choose a card for a thing that has two names.
//
// WHY A SOURCE-TEXT GUARD AND NOT A RENDER TEST: a render test proves what the component does with
// the props the test hands it. It cannot prove App.tsx never reintroduces a first-run branch, and
// per the capture-the-screen law a green suite cannot prove absence at all — every pin here is
// written to fail on the RETURN of a removed thing, which is the direction a suite can prove.
//
// Repo-root-relative paths; vitest runs from the repo root (scripts/run-vitest.mjs). ESM, no
// __dirname.

const read = (...p: string[]) => readFileSync(join(...p), "utf8");

/** Strip // and block comments so a prose mention of a banned pattern never trips a case. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("first-run front door (C-05)", () => {
  it("App never auto-opens the tour on first run", () => {
    const src = stripComments(read("src", "App.tsx"));

    // The state must start closed, literally.
    expect(
      /const\s*\[\s*showSetupTour\s*,\s*setShowSetupTour\s*\]\s*=\s*useState\s*\(\s*false\s*\)/.test(
        src,
      ),
      "showSetupTour must initialise to a literal false — any lazy initialiser is a first-run branch",
    ).toBe(true);

    // ...and no first-run KEY may be read anywhere in App to decide it. The keys are still WRITTEN
    // on finish (the "have they seen it" signal survives); reading one back is the regression.
    for (const key of ["SETUP_TOUR_KEY", "ONBOARDED_KEY"]) {
      const reads = src.match(new RegExp(`lsGet\\s*\\(\\s*${key}\\s*\\)`, "g")) ?? [];
      expect(
        reads.length,
        `App.tsx reads ${key} — that is how the tour used to seize the front door`,
      ).toBe(0);
    }
  });

  it("every Home surface offers the tour as a card the user can choose", () => {
    // HomeConsole is the default (HomeRoom: homeConsole flag ON unless "0"); the other two are the
    // reachable failsafes. All three are front doors, so all three carry the door.
    for (const surface of ["HomeConsole.tsx", "HomeV2.tsx", "HomeHud.tsx"]) {
      const src = stripComments(read("src", "surfaces", surface));
      expect(
        /<SetupLauncherCard\b/.test(src),
        `${surface} must mount <SetupLauncherCard/> — without it the tour is only reachable ` +
          `through Settings, which is not "a card the user can choose"`,
      ).toBe(true);
    }
  });

  it("the flow has exactly one name", () => {
    // The retired keys, in both locales. Their return means the two-name defect is back.
    for (const loc of ["en", "zh-CN"]) {
      const home = JSON.parse(read("src", "i18n", "locales", loc, "home.json"));
      expect(
        home.setupTour.leg,
        `${loc}/home.json still carries setupTour.leg — the "Guided setup"/"Hardware tour" split`,
      ).toBeUndefined();
      expect(
        typeof home.setupTour.flowName,
        `${loc}/home.json must define setupTour.flowName — the one name`,
      ).toBe("string");
    }

    // And the component must render that one key, not a per-leg lookup.
    const tour = stripComments(read("src", "surfaces", "setup", "SetupTour.tsx"));
    expect(
      /t\(\s*["'`]home\.setupTour\.flowName["'`]\s*\)/.test(tour),
      "SetupTour must label the flow from setupTour.flowName",
    ).toBe(true);
    expect(
      /setupTour\.leg\./.test(tour),
      "SetupTour must not look a name up per leg — that is the two-name defect",
    ).toBe(false);
  });

  it("the one name is the same name on the card, in Settings, and on Home's tile", () => {
    // Not a style check: three surfaces that invite the user into ONE flow must not invite them
    // into three. Compared case- and punctuation-insensitively so wording can still breathe.
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "");
    for (const loc of ["en", "zh-CN"]) {
      const home = JSON.parse(read("src", "i18n", "locales", loc, "home.json"));
      const settings = JSON.parse(read("src", "i18n", "locales", loc, "settings.json"));
      const name = norm(home.setupTour.flowName);

      for (const [where, text] of [
        ["setupLauncherCard.title", home.setupLauncherCard.title],
        ["homeConsole.bento.tour", home.homeConsole.bento.tour],
        ["settings.setup.title", settings.setup.title],
      ] as [string, string][]) {
        expect(
          norm(text).includes(name),
          `${loc} ${where} = ${JSON.stringify(text)} does not contain the flow's one name ` +
            `${JSON.stringify(home.setupTour.flowName)}`,
        ).toBe(true);
      }
    }
  });
});
