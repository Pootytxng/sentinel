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
// This is a source-contract guard (see the sibling fastpath-skipped-detail-guard for the same
// honesty note): a behavioural test would need LabConsole mounted with its full prop surface.
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const KEY = "compy_lab_open_station";
const app = readFileSync(join("src", "App.tsx"), "utf8");
const labConsole = readFileSync(join("src", "surfaces", "LabConsole.tsx"), "utf8");
const firstCheck = readFileSync(join("src", "surfaces", "FirstCheck.tsx"), "utf8");

describe("post-check lab route (J, 2026-07-22)", () => {
  it("persists the Optimize intent from the post-check route", () => {
    expect(app, `App no longer writes ${KEY} — the post-check CTA lands on the dock, not Optimize`)
      .toContain(`localStorage.setItem("${KEY}", "optimize")`);
  });

  it("writes the intent BEFORE navigating, so LabConsole cannot mount first", () => {
    const set = app.indexOf(`localStorage.setItem("${KEY}"`);
    const nav = app.indexOf('navHome("lab")', set);
    expect(set, "the setItem call is gone").toBeGreaterThan(-1);
    expect(nav, "no navHome(\"lab\") follows the setItem — the handoff is no longer race-free").toBeGreaterThan(set);
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
