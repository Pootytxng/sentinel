// bug->guard (SESSION_HANDOFF §4, tester 2026-08-09): a tester whose PC had crashed went looking
// for help, found nothing in Compy that said "crash", and walked to Windows Event Viewer instead.
// Compy had already read that exact evidence — `blackbox.rs` + `BlackBox.tsx` — and shipped it as a
// Lab station named **"Black Box"**. The reader was fine. The SIGN was the bug.
//
// This guard holds the two properties that fix stands on, neither of which any type or render test
// can see:
//
//   1. Every deep-linking affordance names a station that actually exists. Something pointing at a
//      station key nothing renders is a click that silently does nothing — worse than the dock.
//   2. The crash instrument is named after the PROBLEM, in the user's own words. "Black Box" is an
//      aviation metaphor: correct, evocative, and invisible to someone searching for the word they
//      would actually type. Rename it back and the tester's walk to Event Viewer resumes, with
//      every test still green — which is exactly what happened the first time.
//
// The plain-language rail (CLAUDE.md: no jargon, plain-English "for YOUR hardware") is the standing
// law behind (2); this file is the first place it is mechanically enforced on a nav label.
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import i18n from "../i18n";
import { homeCareEntry } from "./home-intake-data";
import { INTERVIEW_FINDINGS, interviewFinding } from "./home-interview-data";
import { labStations, labRouter, LAB_STATION_ORDER, type LabStationKey } from "./lab-guided-data";

// The crash deep-link moved OUT of the intake rows and into the always-visible Care entry
// (issue #91 discovery contract, 2026-08-12). Both properties below still hold — they just read
// the Care entry now. The band itself was replaced by the interview (step 3, issue #177), so the
// station-set sweep now walks every finding the interview can reach.
const CARE = homeCareEntry(i18n.t);
// Worst-case facts on purpose: nothing measured, every room present. A finding's DESTINATION must
// be real no matter what the machine happens to be reading.
const FINDINGS = INTERVIEW_FINDINGS.map((id) =>
  interviewFinding(
    id,
    {
      recsLoaded: false,
      safeStackReady: 0,
      fastPathWired: false,
      activeChanges: 0,
      sessionCount: 0,
      lastSession: null,
      readiness: null,
      gpuTempC: null,
      rooms: ["play", "learn", "lab"],
    },
    i18n.t,
  ),
);
const STATIONS = labStations(i18n.t);
// "optimize" is a ground-only prepend and deliberately absent from LAB_STATION_ORDER (see
// lab-guided-data), so the set of real keys is the order plus it.
const REAL_KEYS: LabStationKey[] = ["optimize", ...LAB_STATION_ORDER];

// The retired name. Kept as a literal here ON PURPOSE: this file is the one place allowed to say
// it, because saying it is how the sweep below recognises a regression.
const RETIRED = "Black Box";

describe("deep-links point at real stations (§4)", () => {
  it("every interview finding that carries a station names one the Lab actually has", () => {
    for (const f of FINDINGS) {
      if (f.action.kind !== "station") continue;
      expect(
        REAL_KEYS,
        `interview finding "${f.id}" deep-links to "${f.action.station}", which is not a Lab station — the click does nothing`,
      ).toContain(f.action.station);
    }
  });

  it("the Care entry names a station the Lab actually has", () => {
    expect(
      REAL_KEYS,
      `the Care entry deep-links to "${CARE.station}", which is not a Lab station — the click does nothing`,
    ).toContain(CARE.station);
  });

  it("routes the crash symptom to the same station the Lab's own router does", () => {
    // Two routers answer "it crashed or froze" — the Lab's in-room one and Home's Care entry.
    // Pointing them at different stations would mean the same sentence has two destinations.
    const labTarget = labRouter(i18n.t).find((r) => r.station === "blackbox");
    expect(labTarget, "the Lab router no longer answers the crash symptom").toBeTruthy();
    expect(CARE.station, "Home's Care entry no longer deep-links the crash symptom").toBe("blackbox");
  });

  it("keeps crash rescue OUT from behind the interview's flag", () => {
    // The band's version of this case forbade a second crash row: two doors to one station on one
    // screen. The band is gone, and the half of it that actually hurt someone is the half worth
    // keeping — the Care entry must never inherit a flag. It did once (it was an intake row from
    // 2026-08-09 to 2026-08-12), which meant a user who switched the band off in Settings lost
    // crash rescue with it, and that is exactly the population most likely to switch a busy thing
    // off. The interview is flagged; the Care entry sits outside it, and this reads the source to
    // prove the render is not nested in the flag's branch.
    const src = readFileSync(join("src", "surfaces", "HomeConsole.tsx"), "utf8");
    const gate = src.match(/const careRenders = .*/)?.[0] ?? "";
    expect(gate, "HomeConsole no longer computes careRenders").not.toBe("");
    expect(
      gate.toLowerCase(),
      `crash rescue is gated on the interview flag again — "${gate.trim()}"`,
    ).not.toContain("interview");
    expect(
      src,
      "the Care entry is no longer rendered on its own gate — check it has not been folded into the interview branch",
    ).toContain("{careRenders && (");
  });
});

describe("the crash instrument is named after the problem, not a metaphor (§4)", () => {
  it("says the word a crashing user would look for", () => {
    const name = STATIONS.blackbox.name;
    expect(
      name.toLowerCase(),
      `the crash station is called "${name}" — nothing in it says "crash", which is the word the tester searched for before giving up and opening Event Viewer`,
    ).toContain("crash");
  });

  it("does not go back to the retired insider metaphor", () => {
    expect(
      STATIONS.blackbox.name,
      `the crash station is named "${RETIRED}" again — an aviation metaphor is not a sign a non-technical gamer can follow`,
    ).not.toBe(RETIRED);
  });

  it("uses ONE name for the instrument across every user-facing string", () => {
    // A split name (nav says one thing, glossary another) is worse than either name alone: the
    // user who does find the station cannot match it to the reference entry that explains it.
    const offenders: string[] = [];
    for (const locale of ["en", "zh-CN"]) {
      for (const file of ["lab", "gaming", "home", "common"]) {
        let raw: string;
        try {
          raw = readFileSync(join("src", "i18n", "locales", locale, `${file}.json`), "utf8");
        } catch {
          continue; // not every namespace exists in every locale
        }
        if (raw.includes(RETIRED)) offenders.push(`${locale}/${file}.json`);
      }
    }
    expect(
      offenders,
      `these locale files still show users "${RETIRED}" while the station calls itself "${STATIONS.blackbox.name}"`,
    ).toEqual([]);
  });
});
