// bug->guard (issue #91 Compy Care Tier 1 — the Care entry extracted from the intake band
// 2026-08-12). The DOM half of this contract (the entry renders in every state of
// `compy_home_interview`, including the "0" failsafe) lives in home-interview.test.tsx, which owns the
// real Home fixtures. THIS file holds the properties that are true of the entry's DATA, before any
// component renders it — the ones a render test cannot see because it only ever asserts what the
// component happened to be handed.
//
// Why the entry exists at all: crash rescue lived inside the Home intake band from 2026-08-09, so
// the one affordance a user in trouble comes to Home to find inherited that band's flag. A user who
// switched the band off in Settings lost crash rescue with it — and the population that turns a
// busy band off overlaps hard with the population whose PC keeps crashing.
//
// The owner-approved contract (docs/BACKLOG.md §Discovery contract), in one word: the Care entry is
// always visible on Home INDEPENDENT of the broad intake band (deleted 2026-08-20; the successor
// interview carries its own flag, and the entry is independent of that one too). The original
// sentence assumed that band was off by default; it graduated to on 2026-08-11, and independence is
// what carries the requirement either way.
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import i18n from "../i18n";
import { homeCareEntry } from "./home-intake-data";
import { INTERVIEW_FINDINGS, interviewFinding } from "./home-interview-data";
import { labRouter, LAB_STATION_ORDER, type LabStationKey } from "./lab-guided-data";

const CARE = homeCareEntry(i18n.t);
// The interview replaced the intake band (step 3, issue #177), so the "is there a second door to
// the crash station" question is now asked of the interview's findings. Facts are the WORST case on
// purpose - nothing measured, every room present - so a finding's routing is graded on the tree,
// not on a lucky reading.
const BARE = {
  recsLoaded: false,
  safeStackReady: 0,
  fastPathWired: false,
  activeChanges: 0,
  sessionCount: 0,
  lastSession: null,
  readiness: null,
  gpuTempC: null,
  rooms: ["play", "learn", "lab"] as const,
};
const FINDINGS = INTERVIEW_FINDINGS.map((id) =>
  interviewFinding(id, { ...BARE, rooms: [...BARE.rooms] }, i18n.t),
);
const REAL_KEYS: LabStationKey[] = ["optimize", ...LAB_STATION_ORDER];

describe("the Care entry is ONE door to the crash evidence", () => {
  it("every interview route to the crash evidence agrees with it — one sentence, one destination", () => {
    // The band's version of this case asserted ABSENCE: no intake row may deep-link the crash
    // station, because a row and the Care entry sat on the SAME screen and two doors to one place
    // is the duplication rubric 3 exists to catch. The interview is not on that screen — it is a
    // modal the user reaches by answering a question — so absence is the wrong property to hold,
    // and holding it would forbid the interview from ever answering "it crashed", which is its job.
    //
    // What still matters, and is what actually broke things for the tester, is AGREEMENT: the same
    // felt sentence must not have two destinations. So every finding that routes to a station must
    // route to the Care entry's station whenever it is answering the crash question at all.
    // P6-door: the stutter answer is a "something's wrong" answer too, and lands on the same view.
    const crashFindings = FINDINGS.filter((f) => f.id.startsWith("crash") || f.id === "stutter");
    expect(crashFindings.length, "the interview no longer answers the crash symptom").toBeGreaterThan(0);
    for (const f of crashFindings) {
      expect(
        f.action.kind === "station" ? f.action.station : f.action.kind,
        `interview finding "${f.id}" answers a crash and sends the user to something other than the Care entry's station`,
      ).toBe(CARE.station);
    }
  });

  it("points at a station the Lab actually renders", () => {
    expect(
      REAL_KEYS,
      `the Care entry deep-links to "${CARE.station}", which is not a Lab station — the click does nothing`,
    ).toContain(CARE.station);
  });

  it("agrees with the Lab's own router about where the crash symptom goes", () => {
    // Two routers answer "it crashed or froze": the Lab's in-room one and this entry. Pointing them
    // at different stations means the same sentence has two destinations.
    const labTarget = labRouter(i18n.t).find((r) => r.station === CARE.station);
    expect(labTarget, "the Lab router no longer answers the crash symptom").toBeTruthy();
  });

  it("names a room the entry can fall back to when no station writer is wired", () => {
    // The fallback exists so an isolated mount is never a dead click. A room key nothing routes
    // would make the fallback itself the dead end.
    expect(["play", "learn", "lab"]).toContain(CARE.room);
  });
});

describe("the Care entry is a SIGN, not a chip", () => {
  it("carries a label, a symptom and a because — all three, none empty", () => {
    for (const field of ["label", "symptom", "because"] as const) {
      expect(CARE[field].trim().length, `the Care entry's ${field} is empty`).toBeGreaterThan(0);
    }
  });

  it("says the word a crashing user would actually search for", () => {
    // Same law crash-rescue-naming-guard holds over the station NAME, applied to the Home sign that
    // points at it. The tester who walked to Windows Event Viewer did so because nothing in front
    // of him said "crash" — a door that does not say it is invisible to the person who needs it.
    //
    // P6-door (ROADMAP Phase 6, Constitution §27) renamed the door to the one Care door,
    // "Something's wrong", which now also takes the stutter answer. The door's ROW still has to say
    // "crash" — it moved from the name to the one line under it, which is printed on the same
    // button — and it now has to say "stutter" too, because a hitching user scans for that word.
    const door = `${CARE.label} ${CARE.symptom}`.toLowerCase();
    expect(door, `the Care door reads "${CARE.label} / ${CARE.symptom}" — nothing in it says "crash"`)
      .toContain("crash");
    expect(door, `the Care door reads "${CARE.label} / ${CARE.symptom}" — nothing in it says "stutter"`)
      .toContain("stutter");
  });

  it("carries a door name, not a blank button", () => {
    // Before P6-door this pinned the door's label to the station's name. The door is now the one
    // Care door, "Something's wrong", and deliberately does NOT carry the station's name, so that
    // equality is gone. What stays is that the door has a name at all; the word a crashing or
    // hitching user scans for is held on the door's row (above), the station's own name must still
    // say "crash" (crash-rescue-naming-guard), and every crash and stutter answer must land where
    // the door does (the crashFindings loop at the top of this file).
    expect(CARE.label.trim().length, "Home's Care door has no name").toBeGreaterThan(0);
  });

  it("does not describe itself with the room's name — the because names the ACTION", () => {
    // Same law as the intake rows' because-line: naming the room here would drift the moment the
    // rail is relabelled (as it was on 2026-08-12, Lab -> Test).
    for (const roomName of ["Test", "History", "Live", "Lab", "Blackbook", "Monitor"]) {
      expect(
        CARE.because.includes(roomName),
        `the Care entry's because-line names the room "${roomName}" — it must name what the destination DOES`,
      ).toBe(false);
    }
  });
});

// ── EXTENDED 2026-08-25 (Tier 1 plan tasks 8–9, issue #222): the ROUTE, not just the entry ───────
//
// Everything above is true of the entry's DATA. What follows is true of the hallway it opens, which
// task 8 finished: Home can now send the user to ONE named incident, and the observer built in task
// 9 is the producer that finally makes that parameter fillable. The route is spread across five
// files and held together by two localStorage keys and a prop signature — nothing type-checks it
// end to end, so every seam below can rot green:
//
//   * the door can quietly become conditional on a crash report existing — and a door you only see
//     AFTER a crash is a door nobody learns about BEFORE one, which is the whole point of #91;
//   * the incident id can get folded into the station string, where the reader's `openable.find()`
//     drops it on the floor with no error;
//   * the one-shot incident key can stop being cleared when the station is unrenderable, silently
//     re-selecting a stale crash on the NEXT Lab visit;
//   * the derived React state can outlive the one-shot key it came from (it did — see the
//     manual-reopen block at the bottom);
//   * the crash route can be re-pointed at Optimize, the older and more travelled hallway.
//
// Sibling guards, deliberately not duplicated: post-check-lab-route-guard.test.ts owns the
// write-before-navigate ordering and the singleness of the writer; home-console.test.tsx owns the
// notice's behavioural render; care-incident-observer-contract.test.ts owns the producer.
const STATION_KEY = "compy_lab_open_station";
const INCIDENT_KEY = "compy_lab_open_incident";

const app = readFileSync(join("src", "App.tsx"), "utf8");
const homeConsole = readFileSync(join("src", "surfaces", "HomeConsole.tsx"), "utf8");
const intakeData = readFileSync(join("src", "surfaces", "home-intake-data.ts"), "utf8");
const labConsole = readFileSync(join("src", "surfaces", "LabConsole.tsx"), "utf8");
const blackBox = readFileSync(join("src", "surfaces", "BlackBox.tsx"), "utf8");
const homeLocale = JSON.parse(readFileSync(join("src", "i18n", "locales", "en", "home.json"), "utf8"));
const gamingLocale = JSON.parse(readFileSync(join("src", "i18n", "locales", "en", "gaming.json"), "utf8"));

describe("the Care door is always there, not only after a crash", () => {
  it("builds the entry from nothing but `t` — it cannot be gated on evidence it has not got", () => {
    // A signature that took a report, a count or a boolean would be the shape of the regression: it
    // would let a caller hide the door on the machines that have never crashed, which is every
    // machine until the moment it matters.
    expect(intakeData, "homeCareEntry now takes more than `t` — it can be gated on crash evidence")
      .toMatch(/export function homeCareEntry\(t: TFunction\): HomeCareEntry \{/);
  });

  it("renders the door on room availability alone", () => {
    // `careRenders` may depend on the Lab room EXISTING (a door to a room that is not there is a
    // dead end). It must not depend on a report, an incident count, or the pending notice.
    const cond = homeConsole.match(/const careRenders = ([^;]+);/)?.[1] ?? "";
    expect(cond, "careRenders is gone — the door's visibility is no longer decided in one place")
      .not.toBe("");
    expect(cond, `careRenders now consults crash evidence (${cond}) — the door hides until it is too late`)
      .not.toMatch(/incident|report|crash|pendingCare|count/i);
  });

  it("keeps the notice and the door as SEPARATE surfaces", () => {
    // The notice is transient (one incident, dismissable); the door is permanent. Rendering the
    // door inside the notice's conditional would make the permanent half disappear on dismiss.
    expect(homeConsole.indexOf('className="hc-notice"'), "the Care notice is gone from Home").toBeGreaterThan(-1);
    expect(homeConsole.indexOf('className="hc-care"'), "the Care door is gone from Home").toBeGreaterThan(-1);
    expect(homeConsole, "the door is no longer rendered on its own `careRenders` branch")
      .toMatch(/\{careRenders && \(\s*<section className="hc-care"/);
  });
});

describe("the crash route lands on the crash, not the dock and not Optimize", () => {
  it("routes the notice's open action through the Care handler, never the fixes hallway", () => {
    expect(homeConsole, "the notice's primary action no longer calls onOpenCareIncident")
      .toMatch(/onClick=\{\(\) => onOpenCareIncident\?\.\(pendingCare\.incident_id\)\}/);
    // openFixesInLab is the Optimize-named delegate. If it ever appears on the crash path, a user
    // asking "why did it crash" is handed a list of tweaks instead of their own evidence.
    const noticeBlock = homeConsole.slice(
      homeConsole.indexOf('className="hc-notice"'),
      homeConsole.indexOf('className="hc-care"'),
    );
    expect(noticeBlock, "the crash notice now routes into the Optimize hallway")
      .not.toMatch(/onSeeInFix|openFixesInLab|"optimize"/);
  });

  it("opens the blackbox station WITH the incident id from App's one writer", () => {
    expect(app, "openCareIncident no longer deep-links the exact incident")
      .toMatch(/openLabStation\("blackbox", incidentId\)/);
    expect(app, 'the crash route now names "optimize" — it lands on the fixes, not the evidence')
      .not.toMatch(/openCareIncident[\s\S]{0,400}?openLabStation\("optimize"/);
  });

  it("marks the incident opened BEFORE navigating, so a re-render cannot re-announce it", () => {
    const body = app.match(/const openCareIncident = \(incidentId: string\) => \{([\s\S]*?)\n {2}\};/)?.[1] ?? "";
    expect(body, "openCareIncident is gone — the Care route has no single handler").not.toBe("");
    const mark = body.indexOf("mark_care_incident_opened");
    const nav = body.indexOf("openLabStation(");
    expect(mark, "the open is no longer recorded — the notice comes straight back").toBeGreaterThan(-1);
    expect(nav, "the handler no longer navigates").toBeGreaterThan(-1);
    expect(nav, "navigation now precedes the record — a fast remount re-announces the same crash")
      .toBeGreaterThan(mark);
  });

  it("carries the incident on its OWN key, not folded into the station string", () => {
    // The two have different lifetimes and different failure modes: an unrenderable station is
    // dropped and the user lands on the dock, but an unfindable incident must still OPEN the
    // station and say so. One concatenated key cannot express both.
    expect(app, `the incident no longer rides ${INCIDENT_KEY}`)
      .toContain(`localStorage.setItem("${INCIDENT_KEY}", incidentId)`);
    expect(app, "the station key now carries a composite value — the reader's find() will drop it")
      .toContain(`localStorage.setItem("${STATION_KEY}", station)`);
  });
});

describe("both one-shot keys are consumed and cleared", () => {
  const effect = labConsole.match(/useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[\]\);/)?.[1] ?? "";

  it("reads and clears the station key", () => {
    expect(effect, "the Lab's one-shot mount effect is gone").not.toBe("");
    expect(effect).toContain(`localStorage.getItem("${STATION_KEY}")`);
    expect(effect).toContain(`localStorage.removeItem("${STATION_KEY}")`);
  });

  it("reads and clears the incident key", () => {
    expect(effect, `LabConsole no longer reads ${INCIDENT_KEY} — the deep-link is inert`)
      .toContain(`localStorage.getItem("${INCIDENT_KEY}")`);
    expect(effect, `LabConsole no longer CLEARS ${INCIDENT_KEY} — a stale crash re-selects itself`)
      .toContain(`localStorage.removeItem("${INCIDENT_KEY}")`);
  });

  it("clears the incident key even when the station is missing or unrenderable", () => {
    // The load-bearing ordering. Both clears must happen BEFORE the `if (!pending) return` bail and
    // before the openable lookup; otherwise an unknown station strands the incident key forever and
    // it fires on some unrelated later visit.
    const clearIncident = effect.indexOf(`localStorage.removeItem("${INCIDENT_KEY}")`);
    const bail = effect.indexOf("if (!pending) return");
    const openable = effect.indexOf("openable");
    expect(bail, "the unknown-station bail is gone").toBeGreaterThan(-1);
    expect(clearIncident, "the incident key is cleared after the bail — an unknown station strands it")
      .toBeLessThan(bail);
    expect(clearIncident, "the incident key is cleared after the station lookup").toBeLessThan(openable);
  });

  it("hands the incident only to the station that can honour it", () => {
    expect(effect, "the incident is applied regardless of station — Optimize would receive a crash id")
      .toMatch(/target === "blackbox" && incident/);
  });

  it("drops the selection when the station is closed, so a MANUAL reopen starts clean", () => {
    // bug->guard, found by the #222 frontend/IPC contract audit (2026-08-25). The localStorage key
    // was correctly one-shot, but the React state DERIVED from it was set once and never cleared.
    // Closing Black Box and reopening it by hand — still on the Lab tab, so nothing remounts — fed
    // the old id straight back in: an unrequested `get_crash_blackbox` scan fired, the earlier row
    // re-marked itself, and "This is the one you came here to see" reappeared for an incident the
    // user had already left. A one-shot that survives its own visit is not one-shot, whichever half
    // of the pair remembers it.
    //
    // Mission 1 (2026-08-28) renamed the hand-driven switch from a `setOpenStation((cur) => ...)`
    // toggle to `openFrom(key, opener)`, because a selected station now replaces the room and the
    // control that opened it has to be remembered by identity. The invariant is untouched and the
    // guard got STRICTER for the rename: the clear is now required INSIDE the switch and INSIDE
    // the close, not merely somewhere in the file, where an unrelated line could satisfy it.
    expect(labConsole, "the station switch no longer clears the deep-linked incident")
      .toMatch(/setOpenIncidentId\(null\)/);
    const switcher = labConsole.match(/const openFrom = \([\s\S]{0,600}?\n {2}\};/)?.[0]
      ?? labConsole.match(/const openStationAt[\s\S]{0,600}?\n {2}\};/)?.[0]
      ?? labConsole.match(/setOpenStation\(\(cur\) =>[\s\S]{0,300}?\n/)?.[0]
      ?? "";
    expect(switcher, "the station switch is gone — this guard is policing nothing").not.toBe("");
    expect(switcher, "switching stations by hand no longer drops the deep-linked incident")
      .toMatch(/setOpenIncidentId\(null\)/);
    const closer = labConsole.match(/const closeStation = \([\s\S]{0,400}?\n {2}\};/)?.[0] ?? "";
    expect(closer, "closeStation is gone — this guard is policing nothing").not.toBe("");
    expect(closer, "closing a station no longer drops the deep-linked incident")
      .toMatch(/setOpenIncidentId\(null\)/);
  });

  it("passes it into BlackBox as a selection, never as a filter", () => {
    // A filter would HIDE the other incidents; the user came for one row, but the rest is the
    // context that makes it readable. Selection scrolls and labels, it does not subtract.
    // P6-restore added the ledger props after it; the selection is still passed as-is.
    expect(labConsole).toMatch(/<BlackBox\s+onReport=\{setBbReport\}\s+selectedIncidentId=\{openIncidentId\}\s[^>]*\/>/);
    // Parameter-name-agnostic on purpose: an earlier draft of this line required the callback's
    // argument to be literally `i`, so `.filter((x) => x.incident_id === selectedIncidentId)` —
    // the exact regression it exists to catch — would have sailed through it.
    expect(blackBox, "BlackBox now filters its list by the selected id — the surrounding evidence is gone")
      .not.toMatch(/\.filter\([^)]*\)\s*=>\s*\w+\.incident_id === selectedIncidentId\)/);
    expect(blackBox, "the selected row is no longer marked")
      .toMatch(/data-selected=\{selected \? "true" : undefined\}/);
  });

  it("says so honestly when the deep-linked incident is not in the scan", () => {
    // Windows rotates its own records out, and some sources need admin. Silence here reads as
    // "Compy lost it"; the honest negative is the whole doctrine.
    expect(blackBox, "the missing-incident case is silent again").toContain("selectedMissing");
    expect(gamingLocale.blackBox?.selectedMissing, "the missing-incident copy is gone").toBeTruthy();
  });
});

describe("the visible copy never makes the user learn a room name", () => {
  // The entry's own naming law is above (it must SAY "crash", and it must match the station's
  // name). This is the other half: the copy on the route must not require Compy's INTERNAL name for
  // the station. "Black Box" is what we call the room; a user who has to know it to find their
  // crash has been handed a map instead of a door.
  //
  // The corpus is a NAMED set, not a count. An earlier draft asserted `strings.length >= 8`, which
  // the #222 audit correctly called a magic-number canary: renaming one required key while adding
  // an unrelated string elsewhere in the same object keeps the count and silently drops the
  // coverage. Every key below must resolve to a real string, and every one of them is then policed.
  const REQUIRED: [string, unknown][] = [
    ["home.homeConsole.care.label", homeLocale.homeConsole?.care?.label],
    ["home.homeConsole.care.open", homeLocale.homeConsole?.care?.open],
    ["home.homeConsole.care.notice.aria", homeLocale.homeConsole?.care?.notice?.aria],
    ["home.homeConsole.care.notice.meta", homeLocale.homeConsole?.care?.notice?.meta],
    ["home.homeConsole.care.notice.metaApp", homeLocale.homeConsole?.care?.notice?.metaApp],
    ["home.homeConsole.care.notice.open", homeLocale.homeConsole?.care?.notice?.open],
    ["home.homeConsole.care.notice.dismiss", homeLocale.homeConsole?.care?.notice?.dismiss],
    ["home.homeConsole.intake.rows.crashedFroze.symptom", homeLocale.homeConsole?.intake?.rows?.crashedFroze?.symptom],
    ["home.homeConsole.intake.rows.crashedFroze.because", homeLocale.homeConsole?.intake?.rows?.crashedFroze?.because],
    ["gaming.blackBox.selectedNote", gamingLocale.blackBox?.selectedNote],
    ["gaming.blackBox.selectedMissing", gamingLocale.blackBox?.selectedMissing],
  ];

  it("finds every key on the Care route it is meant to police", () => {
    const missing = REQUIRED.filter(([, v]) => typeof v !== "string" || v.trim() === "").map(([k]) => k);
    expect(missing, `Care-route copy keys are missing or empty: ${missing.join(", ")}`).toEqual([]);
  });

  it("requires no room jargon to understand", () => {
    for (const [key, value] of REQUIRED) {
      expect(String(value), `Care copy at ${key} names an internal room: "${String(value)}"`)
        .not.toMatch(/black ?box/i);
    }
  });

  it("offers two exits of equal weight on the notice", () => {
    // A dismiss the user cannot find is a notice they cannot get rid of; a dismiss styled as the
    // lesser option is the dark pattern. Both must exist as real buttons.
    expect(homeConsole).toMatch(/className="hc-notice-open"/);
    expect(homeConsole).toMatch(/className="hc-notice-dismiss"/);
  });
});
