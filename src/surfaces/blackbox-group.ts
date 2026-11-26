import type { ChangedBeforeItem, CrashIncident } from "../types";

// Problems room: identical incidents shown as one group (P2-group). Pure helpers, no I/O.
//
// Two incidents are "identical" only when everything the room says about them besides WHEN is the
// same: the program Windows named, the kind, the headline wording, the whole assessment (rule,
// statement, strength, evidence, next step) and any known-issue match. Any difference keeps them
// apart, so a group never hides a reading that differs between its members. What differs per
// incident (vitals, "Changed before this", restore offers, the receipt, the stored "Did this point
// you the right way?" answer) is not part of the key and stays per incident.

/** Mirrors `MAX_INCIDENTS` in src-tauri/src/blackbox.rs (a test reads that file and compares). The
 *  list is the newest records of ALL kinds merged, and earlier reads are cut too (per-channel, WER and
 *  Reliability limits), so a group's count is only ever "of the records Compy read", at any size. */
export const INCIDENT_CAP = 25;

// Notes on what a group can and cannot say:
// - The program is the bare file name from the event: two programs with the same file name in
//   different folders cannot be told apart in the data and share a group.
// - Groups are ordered by their newest member, so the list is not strictly chronological: an old
//   single can sit below a group whose oldest member is older still.
// - The faulting module and code are not part of the key; the record row shows each record's own.

export type IncidentGroup = {
  key: string;
  /** Newest first. */
  items: CrashIncident[];
};

/** The headline minus its trailing date: "ROB RUN stopped working and closed — Nov 20, 12:17 AM" is
 *  split into the shared wording and the optional session-game tail (", during or just after a X
 *  session Compy recorded"). */
export function headlineWording(inc: CrashIncident): string {
  const cut = inc.headline.indexOf(` — ${inc.when_display}`);
  if (cut < 0) return inc.headline;
  return inc.headline.slice(0, cut) + inc.headline.slice(cut + ` — ${inc.when_display}`.length);
}

/** The faulting program as a comparable token: file name only, trimmed, lowercased. */
function programOf(inc: CrashIncident): string {
  const raw = (inc.receipt?.faulting_app ?? "").trim();
  const base = raw.split(/[\\/]/).pop() ?? raw;
  return base.trim().toLowerCase();
}

export function groupKey(inc: CrashIncident): string {
  const a = inc.assessment;
  const c = inc.case_intelligence;
  return JSON.stringify([
    programOf(inc),
    inc.tag,
    headlineWording(inc),
    a
      ? [a.rule ?? null, a.statement ?? null, a.subject ?? null, a.temp_c ?? null, a.strength, a.beyond_us,
         a.consistent_with, a.evidence, a.next_step]
      : null,
    c ? [c.case_id, c.level, c.catalog_version] : null,
  ]);
}

/** How many records of the same program and kind as this group's are NOT in it, because something in
 *  their details (usually the assessment's evidence) differs. Real case: 22 crash records read "no
 *  graphics-driver timeout ... in the System log"; a 23rd said Compy couldn't read the System log for
 *  its time. Different reading, so rightly apart, but the group's "22 times" must not read as "all
 *  Compy read". */
export function recordsApart(group: IncidentGroup, all: CrashIncident[]): number {
  const first = group.items[0];
  if (!first) return 0;
  const program = programOf(first);
  if (!program) return 0;
  return all.filter((i) => i.tag === first.tag && programOf(i) === program && groupKey(i) !== group.key).length;
}

const time = (inc: CrashIncident) => {
  const ms = Date.parse(inc.when);
  return Number.isNaN(ms) ? null : ms;
};

/** Groups by `groupKey`. Members are newest first (stable where a time can't be read); groups are
 *  ordered by their newest member. A group of one is one incident, unchanged. */
export function groupIncidents(incidents: CrashIncident[]): IncidentGroup[] {
  const ordered = incidents
    .map((inc, i) => ({ inc, i }))
    .sort((x, y) => {
      const a = time(x.inc);
      const b = time(y.inc);
      if (a !== null && b !== null && a !== b) return b - a;
      return x.i - y.i;
    })
    .map((x) => x.inc);
  const groups = new Map<string, IncidentGroup>();
  for (const inc of ordered) {
    const key = groupKey(inc);
    const g = groups.get(key);
    if (g) g.items.push(inc);
    else groups.set(key, { key, items: [inc] });
  }
  return [...groups.values()];
}

const unknownSig = (it: ChangedBeforeItem) =>
  it.status === "unknown" && it.events.length === 0
    ? `${it.category}|${it.unknown_reason ?? ""}|${it.last_reading_at ?? ""}`
    : null;

/** The "Unknown: ..." rows that read the same for EVERY incident in the group (same category, same
 *  reason, same last reading): shown once at group level. Anything else stays per incident, and an
 *  unknown is never turned into "none". */
export function sharedUnknownItems(items: CrashIncident[]): ChangedBeforeItem[] {
  if (items.length < 2 || items.some((i) => !i.changed_before)) return [];
  return items[0].changed_before!.items.filter((it) => {
    const sig = unknownSig(it);
    return (
      sig !== null &&
      items.every((o) => o.changed_before!.items.some((x) => x.category === it.category && unknownSig(x) === sig))
    );
  });
}
