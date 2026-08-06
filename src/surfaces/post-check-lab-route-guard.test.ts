// bug->guard (J, 2026-07-22): "post-check routing — landing on the dashboard after a check feels
// directionless; add a second CTA that opens the Lab's Optimize tab directly."
//
// The fix SHIPPED (FirstCheck's "Take me to the Lab" button + the `compy_lab_open_station` handoff)
// but shipped WITHOUT a guard: the key appears in exactly two source files and no test. It is a
// three-part contract split across two components with nothing holding the halves together —
// precisely the shape that rots silently:
//
//   1. the writer persists the intent BEFORE navigating (race-free: LabConsole must not mount first)
//   2. the reader consumes it on mount AND CLEARS it (one-shot: a key that is never cleared turns
//      every later Lab visit into a forced redirect to Optimize)
//   3. the second CTA actually renders next to the dashboard button
//
// Rename the key on one side, drop the removeItem, or delete the button, and nothing goes red today.
//
// EXTENDED 2026-08-06 (the check->fix hallway). The post-check CTA was the only route that got this
// right; Home's own "see the fixes" affordances called setActiveTab("Lab") bare and dropped the user
// on the Lab dock, one hunt away from the fixes they were just told about. The fix collapses every
// route into ONE writer, `openFixesInLab`, so ordering is proven in a single place — and this guard
// now pins that singleness. A second bare writer is the regression it exists to catch.
//
// This is a source-contract guard (see the sibling fastpath-skipped-detail-guard for the same
// honesty note): a behavioural test would need LabConsole mounted with its full prop surface. The
// band's own link IS covered behaviourally, in home-console.test.tsx.
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const KEY = "compy_lab_open_station";
const app = readFileSync(join("src", "App.tsx"), "utf8");
const labConsole = readFileSync(join("src", "surfaces", "LabConsole.tsx"), "utf8");
const firstCheck = readFileSync(join("src", "surfaces", "FirstCheck.tsx"), "utf8");

const HELPER = "openFixesInLab";
const helperBody = app.match(/const openFixesInLab = \(\) => \{([\s\S]*?)\n {2}\};/)?.[1] ?? "";

describe("post-check lab route (J, 2026-07-22)", () => {
  it("persists the Optimize intent from the post-check route", () => {
    expect(app, `App no longer writes ${KEY} — the post-check CTA lands on the dock, not Optimize`)
      .toContain(`localStorage.setItem("${KEY}", "optimize")`);
  });

  it("writes the intent BEFORE navigating, so LabConsole cannot mount first", () => {
    const set = helperBody.indexOf(`localStorage.setItem("${KEY}"`);
    const nav = helperBody.indexOf('navHome("lab")', set);
    expect(helperBody, `${HELPER} is gone — the hallway has no single writer any more`).not.toBe("");
    expect(set, "the setItem call is gone").toBeGreaterThan(-1);
    expect(nav, 'no navHome("lab") follows the setItem — the handoff is no longer race-free').toBeGreaterThan(set);
  });

  it("keeps ONE writer of the intent, so the ordering is proven in one place", () => {
    // A second call site would be a second chance to navigate first and lose the intent.
    const writers = app.split(`localStorage.setItem("${KEY}"`).length - 1;
    expect(writers, `${writers} writers of ${KEY} in App.tsx — route them through ${HELPER} instead`).toBe(1);
  });

  it("consumes the intent ONE-SHOT so it cannot strand a permanent redirect", () => {
    expect(labConsole, `LabConsole no longer reads ${KEY}`).toContain(`localStorage.getItem("${KEY}")`);
    // The clear is the load-bearing half: without it every later Lab visit force-opens Optimize.
    expect(
      labConsole,
      `LabConsole no longer CLEARS ${KEY} — every later Lab visit would force-open Optimize`,
    ).toContain(`localStorage.removeItem("${KEY}")`);
    expect(labConsole).toMatch(/pending === "optimize"/);
  });

  it("still offers the second CTA beside the dashboard button", () => {
    // J's complaint was a single exit ("Open the dashboard"). Two exits is the fix.
    expect(firstCheck, "the onGoToLab CTA is gone — the post-check verdict has one exit again")
      .toContain("onGoToLab");
    expect(firstCheck).toMatch(/Take me to the Lab/);
    expect(firstCheck).toMatch(/Open the dashboard/);
  });
});

describe("the check->fix hallway (2026-08-06)", () => {
  it("routes Home's see-the-fixes affordance through the hallway, not the bare Lab tab", () => {
    expect(app, `Home's onSeeInFix no longer uses ${HELPER} — it drops the user on the Lab dock`)
      .toContain(`onSeeInFix={${HELPER}}`);
  });

  it("routes the post-check CTA through the same hallway", () => {
    expect(app, `the post-check CTA no longer calls ${HELPER}`).toContain(`${HELPER}();`);
  });

  it("no Home face still defaults its fix room to the deleted Optimize room", () => {
    // The generation prune (2026-08-06) deleted the standalone Optimize room; the fixes live in the
    // Lab. A default naming a room that no longer exists is copy that lies in isolation tests.
    for (const face of ["HomeConsole", "HomeHud", "HomeV2"]) {
      const src = readFileSync(join("src", "surfaces", `${face}.tsx`), "utf8");
      expect(src, `${face} still defaults fixRoomLabel to the deleted Optimize room`)
        .not.toMatch(/fixRoomLabel = "Optimize"/);
    }
  });
});
