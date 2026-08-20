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
import i18n from "../i18n";
import { homeCareEntry } from "./home-intake-data";
import { INTERVIEW_FINDINGS, interviewFinding } from "./home-interview-data";
import { labStations, labRouter, LAB_STATION_ORDER, type LabStationKey } from "./lab-guided-data";

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
    const crashFindings = FINDINGS.filter((f) => f.id.startsWith("crash"));
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
    // of him said "crash" — a label that does not say it is invisible to the person who needs it.
    expect(
      CARE.label.toLowerCase(),
      `the Care entry is labelled "${CARE.label}" — nothing in it says "crash"`,
    ).toContain("crash");
  });

  it("uses the SAME name as the station it opens", () => {
    // A sign that says one thing and a destination that says another is how a user decides they
    // clicked the wrong door and goes back.
    expect(
      CARE.label,
      `Home's Care entry says "${CARE.label}" but the station it opens calls itself "${labStations(i18n.t)[CARE.station].name}"`,
    ).toBe(labStations(i18n.t)[CARE.station].name);
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
