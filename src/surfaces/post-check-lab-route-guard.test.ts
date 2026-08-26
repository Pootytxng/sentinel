// bug->guard (J, 2026-07-22): "post-check routing — landing on the dashboard after a check feels
// directionless; add a second CTA that opens the Lab's Optimize tab directly."
//
// The fix SHIPPED (FirstCheck's "Take me to Test" button + the `compy_lab_open_station` handoff)
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
// EXTENDED 2026-08-11 (crash-rescue discoverability, SESSION_HANDOFF §4). The hallway was
// hard-wired to the "optimize" string on BOTH sides, so a second destination could not use it
// without a second writer — the exact regression the singleness test above exists to catch. The
// station is now a parameter of the one writer (`openLabStation`), `openFixesInLab` delegates to
// it, and the reader takes any station the dock actually renders. These tests now pin the
// GENERALISED contract: still one writer, still write-before-navigate, still one-shot — and the
// reader must not have gone back to matching a single hardcoded station.
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

const HELPER = "openLabStation"; // the one writer of the intent
const FIX_HELPER = "openFixesInLab"; // its Optimize-named delegate, used by the check->fix hallway
const helperBody = app.match(/const openLabStation = \(station: LabStationKey, incidentId\?: string\) => \{([\s\S]*?)\n {2}\};/)?.[1] ?? "";

describe("post-check lab route (J, 2026-07-22)", () => {
  it("persists the station intent from the post-check route", () => {
    // The writer takes the station as a parameter now; the post-check CTA still names "optimize".
    expect(app, `App no longer writes ${KEY} — the post-check CTA lands on the dock, not a station`)
      .toContain(`localStorage.setItem("${KEY}", station)`);
    expect(app, "the post-check CTA no longer names the Optimize station")
      .toMatch(/openFixesInLab = \(\) => openLabStation\("optimize"\)/);
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
  });

  it("reads the intent as a station, not one hardcoded string", () => {
    // Re-hardcoding the reader is how the second destination silently stops working: the writer
    // would still persist "blackbox" and the reader would still clear it — and drop it on the floor.
    expect(
      labConsole,
      "LabConsole matches a single hardcoded station again — every other deep-link is silently dropped",
    ).not.toMatch(/pending === "(optimize|blackbox|benchmark|latency|tuning|diagnostics)"/);
    expect(labConsole, "LabConsole no longer resolves the pending key against the openable stations")
      .toMatch(/openable\.find\(/);
  });

  it("only opens a station this rig actually renders", () => {
    // stationBody() returns null for a station whose data is absent (Tuning without a guide), and
    // measureKeys filters those off the dock. Honouring the raw key would open an empty panel with
    // no dock node behind it — a dead end one level deeper than the one this hallway closed.
    expect(
      labConsole,
      "the openable set no longer derives from measureKeys — a stale key can open a station the dock does not have",
    ).toMatch(/const openable: LabStationKey\[\] = \["optimize", \.\.\.measureKeys\]/);
  });

  it("still offers the second CTA beside the dashboard button", () => {
    // J's complaint was a single exit ("Open the dashboard"). Two exits is the fix.
    expect(firstCheck, "the onGoToLab CTA is gone — the post-check verdict has one exit again")
      .toContain("onGoToLab");
    expect(firstCheck).toMatch(/Take me to Test/);
    expect(firstCheck).toMatch(/Open the dashboard/);
  });
});

describe("the check->fix hallway (2026-08-06)", () => {
  it("routes Home's see-the-fixes affordance through the hallway, not the bare Lab tab", () => {
    expect(app, `Home's onSeeInFix no longer uses ${FIX_HELPER} — it drops the user on the Lab dock`)
      .toContain(`onSeeInFix={${FIX_HELPER}}`);
  });

  it("routes the post-check CTA through the same hallway", () => {
    expect(app, `the post-check CTA no longer calls ${FIX_HELPER}`).toContain(`${FIX_HELPER}();`);
  });

  it("routes Home's crash row through the same single writer (§4)", () => {
    // The crash deep-link must not grow its own localStorage write — that is the second writer the
    // singleness test above exists to forbid, and the ordering bug it would reintroduce.
    expect(app, `Home's intake band no longer routes its station deep-link through ${HELPER}`)
      .toMatch(/onOpenLabStation=\{\(s, incidentId\) => openLabStation\(s as LabStationKey, incidentId\)\}/);
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
