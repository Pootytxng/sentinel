// bug->guard (issue #91 Compy Care Tier 1 — the Care entry extracted from the intake band
// 2026-08-12). The DOM half of this contract (the entry renders in every state of
// `compy_home_intake`, including the "0" failsafe) lives in home-intake.test.tsx, which owns the
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
// always visible on Home INDEPENDENT of the broad `compy_home_intake` band. The contract's original
// sentence assumed that band was off by default; it graduated to on 2026-08-11, and independence is
// what carries the requirement either way.
import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { homeCareEntry, homeIntakeRows } from "./home-intake-data";
import { labStations, labRouter, LAB_STATION_ORDER, type LabStationKey } from "./lab-guided-data";

const CARE = homeCareEntry(i18n.t);
const ROWS = homeIntakeRows(i18n.t);
const REAL_KEYS: LabStationKey[] = ["optimize", ...LAB_STATION_ORDER];

describe("the Care entry is ONE door to the crash evidence", () => {
  it("no intake row duplicates it — two doors to one station on one screen is the dead end twice", () => {
    // Re-adding a crash row would ALSO put half of crash rescue back behind the band's flag, which
    // is the whole defect the extraction fixed. Both failures, one assertion.
    expect(
      ROWS.filter((r) => r.station === CARE.station).map((r) => r.symptom),
      "an intake row deep-links to the crash station again — the Care entry already owns that door",
    ).toEqual([]);
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
