import type { TFunction } from "i18next";
import {
  labStations,
  stationReading,
  type LabStationKey,
  type LabStationFacts,
} from "./lab-guided-data";

// Lab bento checkup (spec 2026-07-05-lab-bento-checkup) — the pure data behind the bento face:
// per-station card model + the synthesized checkup report. Same contract as lab-guided-data:
// measured facts only; every live line IS stationReading()'s output (one source, so the card,
// the report, and the instrument under them can never disagree); an unread station is an honest
// "not yet" — never a placeholder.

// Whether a station has a real reading this visit — the SAME branches stationReading() treats
// as "a reading exists" (a baseline counts for Benchmark: it's a measured state, not a verdict).
export function stationHasReading(key: LabStationKey, f: LabStationFacts): boolean {
  switch (key) {
    // Ground-only station — never in a bento/guided keys array, but the switch must be exhaustive.
    // "Read" = the safe stack is applied (the loop's completion signal for the fast path).
    case "optimize":
      return f.stackApplied;
    case "diagnostics":
      return f.diagnosticsCaptured;
    case "benchmark":
      return !!f.bench?.efficacy || !!f.bench?.baseline;
    case "latency":
      return !!f.latency;
    case "tuning":
      return f.tuningHeadline != null;
    case "blackbox":
      return f.crash != null;
  }
}

// Lab notes — the "learn something just by playing around" layer. STATIC, generic, factual
// lines about how PCs work; deliberately never a claim about THIS rig (the live reading line
// owns rig-specific truth). Guard-tested for presence + the no-numbers-about-your-rig property.
// i18n note: plain data module, not a component — takes `t: TFunction` as its last param
// (mirrors ago()/smoothness() elsewhere in this codebase); the caller passes its own `t`.
export function labNotes(t: TFunction): Record<LabStationKey, string> {
  return {
    // Ground-only — never rendered by a bento card, but the Record must be exhaustive.
    optimize: t("lab.labBento.notes.optimize"),
    diagnostics: t("lab.labBento.notes.diagnostics"),
    benchmark: t("lab.labBento.notes.benchmark"),
    latency: t("lab.labBento.notes.latency"),
    tuning: t("lab.labBento.notes.tuning"),
    blackbox: t("lab.labBento.notes.blackbox"),
  };
}

export type BentoCard = {
  key: LabStationKey;
  n: number; // 1-based position over the stations THIS rig has (never hardcoded)
  name: string;
  forLine: string; // what it's for — the card's plain-English tagline
  reading: string; // LIVE — stationReading()'s exact output
  hasReading: boolean;
  note: string; // the static lab note
};

export function labBentoCards(keys: LabStationKey[], f: LabStationFacts, t: TFunction): BentoCard[] {
  const stations = labStations(t);
  const notes = labNotes(t);
  return keys.map((key, i) => ({
    key,
    n: i + 1,
    name: stations[key].name,
    forLine: stations[key].forLine,
    reading: stationReading(key, f, t),
    hasReading: stationHasReading(key, f),
    note: notes[key],
  }));
}

// The checkup report — the owner's "annotated summary the user can easily comprehend".
// Coverage headline + per-station lines (the same live readings) + ONE next step pointing at
// the first unread station in bench order. All derived; nothing here invents a result.
export type CheckupReport = {
  headline: string;
  sub: string;
  lines: { key: LabStationKey; name: string; reading: string; hasReading: boolean }[];
  // "Next: station N — Name." — null when every station has a reading.
  next: string | null;
};

export function labCheckup(cards: BentoCard[], t: TFunction): CheckupReport {
  const read = cards.filter((c) => c.hasReading);
  const firstUnread = cards.find((c) => !c.hasReading) ?? null;
  const next = firstUnread
    ? t("lab.labBento.checkup.next", {
        n: firstUnread.n,
        name: firstUnread.name,
        forLine: firstUnread.forLine,
      })
    : null;

  let headline: string;
  let sub: string;
  if (read.length === 0) {
    headline = t("lab.labBento.checkup.notStarted.headline");
    sub = t("lab.labBento.checkup.notStarted.sub");
  } else if (read.length === cards.length) {
    headline = t("lab.labBento.checkup.complete.headline");
    sub = t("lab.labBento.checkup.complete.sub");
  } else {
    headline = t("lab.labBento.checkup.inProgress.headline", {
      read: read.length,
      total: cards.length,
    });
    sub = t("lab.labBento.checkup.inProgress.sub");
  }

  return {
    headline,
    sub,
    lines: cards.map((c) => ({
      key: c.key,
      name: c.name,
      reading: c.reading,
      hasReading: c.hasReading,
    })),
    next,
  };
}
