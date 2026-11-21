// n1-drift: "name the drifted setting". Drift Watch (src-tauri/src/drift.rs) notices a readiness check
// that was ready and now is not. Two forms, one source:
//   - driftSentence: the full line (Check, the details): WHICH setting (its plain name, with where it
//     is set), what it reads NOW, what Compy last RECORDED and WHEN it last saw it as expected, and when
//     Compy first noticed.
//   - driftShort: the glance line (Home, Constitution section 13): "{short name}: now {value}" and
//     nothing else, no menu paths, no timestamps.
// A changed setting is a fact, not a fault: no cause, no fix claim. Whatever the backend does not know
// is said so:
//   - no recorded earlier value   -> "doesn't know what it was before"
//   - no earlier ready stamp      -> "doesn't know ... when it last saw it as expected"
//   - the check can't be read now -> "couldn't read it just now" (never "unchanged", never a value)
// Values are shown as the backend recorded them (a number, a plan name); only Compy's own words are
// translated. An id this file doesn't know falls back to the check's own label and detail. A driver
// getting older is not a drift at all (drift.rs TIME_ONLY_CHECKS), so it has no entry here.
import type { TFunction } from "i18next";
import { readinessWords } from "../data/backend-words";
import type { Drift } from "../types";

/** How many drifts Home spells out before it says "and N more" (the Care list shows every one). */
export const HOME_DRIFT_LINES = 3;

/** Per drift-capable check id: the full name (with where it is set) and the short Home name. */
const NAMES: Record<string, { full: string; short: string }> = {
  "power-profile": { full: "common.driftNamed.name.powerProfile", short: "common.driftNamed.short.name.powerProfile" },
  "monitor-refresh": { full: "common.driftNamed.name.monitorRefresh", short: "common.driftNamed.short.name.monitorRefresh" },
  vrr: { full: "common.driftNamed.name.vrr", short: "common.driftNamed.short.name.vrr" },
  "memory-speed": { full: "common.driftNamed.name.memorySpeed", short: "common.driftNamed.short.name.memorySpeed" },
  "memory-channels": { full: "common.driftNamed.name.memoryChannels", short: "common.driftNamed.short.name.memoryChannels" },
  "drive-health": { full: "common.driftNamed.name.driveHealth", short: "common.driftNamed.short.name.driveHealth" },
  "install-drive": { full: "common.driftNamed.name.installDrive", short: "common.driftNamed.short.name.installDrive" },
};

/** A stamp in the app's language (with the year when it is not this year), or null when it is
 *  missing or not a date: never printed raw. */
export function stampOf(iso: string | null | undefined, lang: string, now: Date = new Date()): string | null {
  if (iso == null || iso === "") return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString(lang, {
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}),
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const RAW = { interpolation: { escapeValue: false } } as const;

const usable = (s: string | null | undefined): s is string => s != null && s.trim() !== "";

/** The applied changes now off, named (an unreadable ledger names none). */
function titlesOf(d: Drift): string[] {
  return d.unreadable_now === true ? [] : (d.titles ?? []).filter((x) => x.trim() !== "");
}

/** One drift as one plain paragraph (the full form). */
export function driftSentence(d: Drift, t: TFunction, lang: string): string {
  const unreadable = d.unreadable_now === true;
  const lastSeen = stampOf(d.last_ready_at, lang);
  const noticed = stampOf(d.noticed_at, lang) ?? t("common.driftNamed.unknownTime");
  const join = (parts: string[]) => parts.join(t("common.driftNamed.joiner"));
  const noticedClause = unreadable
    ? t("common.driftNamed.noticedUnreadable", { noticed, ...RAW })
    : t("common.driftNamed.noticed", { noticed, ...RAW });

  if (d.id === "applied-changes") {
    // A change you turned on with Compy that is off now: named from the ledger, never from a guess.
    // The date is the ledger's own stamp for that change, only when there is exactly one change;
    // never the row's last-ready scan time (the row is also ready when the change didn't exist yet).
    const titles = titlesOf(d);
    const count = Math.max(titles.length, 1);
    const now = unreadable
      ? t("common.driftNamed.nowUnreadable")
      : titles.length > 0
        ? t("common.driftNamed.applied.off", { count: titles.length, titles: titles.join(", "), ...RAW })
        : t("common.driftNamed.applied.offUnnamed");
    const appliedOn = titles.length === 1 ? stampOf(d.applied_at?.[0], lang) : null;
    const before =
      appliedOn != null
        ? t("common.driftNamed.applied.onDate", { when: appliedOn, ...RAW })
        : t("common.driftNamed.applied.turnedOn", { count });
    return t("common.driftNamed.line", {
      name: t("common.driftNamed.applied.name"),
      clauses: join([now, before, noticedClause]),
      ...RAW,
    });
  }

  const names = NAMES[d.id];
  if (names == null) {
    // A check this file doesn't know: its own label and detail, as before (detail in the app's language).
    const words = readinessWords(
      { id: d.id, status: unreadable ? "unknown" : "attention", label: d.label, detail: d.detail },
      t,
      lang,
    );
    return unreadable
      ? t("optimize.check.driftUnreadable", { label: d.label })
      : words.detail
        ? t("optimize.check.driftItem", { label: d.label, detail: words.detail })
        : d.label;
  }

  const now = unreadable
    ? t("common.driftNamed.nowUnreadable")
    : usable(d.value_now)
      ? t("common.driftNamed.now", { now: d.value_now, ...RAW })
      : t("common.driftNamed.nowNoReading");
  const before =
    lastSeen == null
      ? t("common.driftNamed.beforeUnknown")
      : usable(d.last_ready_value)
        ? t("common.driftNamed.before", { before: d.last_ready_value, when: lastSeen, ...RAW })
        : t("common.driftNamed.beforeUnknownValue", { when: lastSeen, ...RAW });
  return t("common.driftNamed.line", { name: t(names.full), clauses: join([now, before, noticedClause]), ...RAW });
}

/** One drift as one short fact for Home's glance card: the short name and what it reads now. */
export function driftShort(d: Drift, t: TFunction): string {
  const unreadable = d.unreadable_now === true;
  if (d.id === "applied-changes") {
    if (unreadable) return t("common.driftNamed.short.appliedUnreadable");
    const titles = titlesOf(d);
    return titles.length > 0
      ? t("common.driftNamed.short.appliedOff", { titles: titles.join(", "), ...RAW })
      : t("common.driftNamed.short.appliedUnnamed");
  }
  const names = NAMES[d.id];
  if (names == null) return d.label;
  const name = t(names.short);
  if (unreadable) return t("common.driftNamed.short.unreadable", { name, ...RAW });
  return usable(d.value_now)
    ? t("common.driftNamed.short.now", { name, now: d.value_now, ...RAW })
    : t("common.driftNamed.short.noReading", { name, ...RAW });
}

/** The "and N more" tail for a list cut at `shown`, or null when nothing was cut. */
export function driftMore(total: number, shown: number, t: TFunction): string | null {
  return total > shown ? t("common.driftNamed.more", { count: total - shown }) : null;
}
