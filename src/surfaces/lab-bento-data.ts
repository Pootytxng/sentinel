import {
  LAB_STATIONS,
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
    // Ground-only station (§3) — never in a bento/guided keys array, but the switch must be
    // exhaustive. "Read" = the user has measured history to collect.
    case "gallery":
      return f.galleryHasHistory;
  }
}

// Lab notes — the "learn something just by playing around" layer. STATIC, generic, factual
// lines about how PCs work; deliberately never a claim about THIS rig (the live reading line
// owns rig-specific truth). Guard-tested for presence + the no-numbers-about-your-rig property.
export const LAB_NOTES: Record<LabStationKey, string> = {
  // Ground-only — never rendered by a bento card, but the Record must be exhaustive.
  optimize:
    "Most \"best settings\" guides are generic and one-size-fits-all. These tweaks are the ones vetted safe AND reversible for a rig like yours — every one snapshots its prior state before it touches anything.",
  diagnostics:
    "Most people never see their PC's real parts list. This is the honest inventory — read straight from the machine, nothing installed.",
  benchmark:
    "Benchmarks are noisy: two identical runs never score identical. Compy grades changes against that noise floor, so luck can't be called a win.",
  latency:
    "One click crosses the mouse, USB, Windows, the GPU and your monitor before you see it land — every hop adds delay, and each one is measurable.",
  tuning:
    "Undervolting asks the chip to do the same work on less power — often cooler and just as fast. How far yours goes is the silicon lottery.",
  blackbox:
    "Windows keeps a flight recorder of every crash and freeze. Almost nobody ever reads it — this station does, in plain English.",
  // Ground-only — never rendered by a bento card, but the Record must be exhaustive.
  gallery:
    "Every win here is measured, not claimed — only changes that beat the noise floor earn a piece. It's your rig's real track record, nothing invented.",
};

export type BentoCard = {
  key: LabStationKey;
  n: number; // 1-based position over the stations THIS rig has (never hardcoded)
  name: string;
  forLine: string; // what it's for — the card's plain-English tagline
  reading: string; // LIVE — stationReading()'s exact output
  hasReading: boolean;
  note: string; // the static lab note
};

export function labBentoCards(keys: LabStationKey[], f: LabStationFacts): BentoCard[] {
  return keys.map((key, i) => ({
    key,
    n: i + 1,
    name: LAB_STATIONS[key].name,
    forLine: LAB_STATIONS[key].forLine,
    reading: stationReading(key, f),
    hasReading: stationHasReading(key, f),
    note: LAB_NOTES[key],
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

export function labCheckup(cards: BentoCard[]): CheckupReport {
  const read = cards.filter((c) => c.hasReading);
  const firstUnread = cards.find((c) => !c.hasReading) ?? null;
  const next = firstUnread
    ? `Next: station ${firstUnread.n} — ${firstUnread.name}. ${LAB_STATIONS[firstUnread.key].forLine}`
    : null;

  let headline: string;
  let sub: string;
  if (read.length === 0) {
    headline = "Your checkup hasn't started yet.";
    sub =
      "Work the stations left to right — each one only measures, so there's nothing here you can break. Poke around freely.";
  } else if (read.length === cards.length) {
    headline = "Full checkup complete — every station has a reading.";
    sub = "Here's what your rig's results mean, station by station.";
  } else {
    headline = `Checkup in progress — ${read.length} of ${cards.length} stations have readings.`;
    sub = "What you've measured so far, and where to go next.";
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
