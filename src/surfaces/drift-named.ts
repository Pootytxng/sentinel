// n1-drift: "name the drifted setting". Drift Watch (src-tauri/src/drift.rs) notices a readiness check
// that was ready and now is not. Home and Check used to say only how many; this words ONE drift in
// plain language: WHICH setting (its plain name, with where Windows keeps it), what it reads NOW, what
// Compy last RECORDED and WHEN it last saw it as expected, and when Compy noticed. A changed setting is
// a fact, not a fault: no cause, no fix claim. Whatever the backend does not know is said so:
//   - no recorded earlier value  -> "doesn't know what it was before"
//   - no earlier ready stamp     -> "doesn't know ... when it last saw it as expected"
//   - the check can't be read now -> "couldn't read it just now" (never "unchanged", never a value)
// Values are shown as the backend recorded them (a number, a plan name); only Compy's own words are
// translated. An id this file doesn't know falls back to the check's own label and detail.
import type { TFunction } from "i18next";
import { readinessWords } from "../data/backend-words";
import type { Drift } from "../types";

/** How many drifts Home spells out before it says "and N more" (the Care list shows every one). */
export const HOME_DRIFT_LINES = 3;

/** The plain setting name per drift-capable check id (the checks in readiness.rs that can read
 *  "needs attention"). */
const NAME_KEY: Record<string, string> = {
  "power-profile": "common.driftNamed.name.powerProfile",
  "monitor-refresh": "common.driftNamed.name.monitorRefresh",
  vrr: "common.driftNamed.name.vrr",
  "memory-speed": "common.driftNamed.name.memorySpeed",
  "memory-channels": "common.driftNamed.name.memoryChannels",
  "drive-health": "common.driftNamed.name.driveHealth",
  "install-drive": "common.driftNamed.name.installDrive",
  "gpu-driver-age": "common.driftNamed.name.gpuDriverAge",
};

/** A stamp in the app's language, or null when it is missing or not a date (never printed raw). */
function when(iso: string | null | undefined, lang: string): string | null {
  if (iso == null || iso === "") return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString(lang, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const RAW = { interpolation: { escapeValue: false } } as const;

/** One drift as one plain paragraph. */
export function driftSentence(d: Drift, t: TFunction, lang: string): string {
  const unreadable = d.unreadable_now === true;
  const lastSeen = when(d.last_ready_at, lang);
  const noticed = when(d.noticed_at, lang) ?? d.noticed_at;
  const join = (parts: string[]) => parts.join(t("common.driftNamed.joiner"));
  const noticedClause = unreadable
    ? t("common.driftNamed.noticedUnreadable", { noticed, ...RAW })
    : t("common.driftNamed.noticed", { noticed, ...RAW });

  if (d.id === "applied-changes") {
    // A change you turned on with Compy that is off now: named from the ledger, never from a guess.
    const titles = unreadable ? [] : (d.titles ?? []).filter((x) => x.trim() !== "");
    const count = Math.max(titles.length, 1);
    const now = unreadable
      ? t("common.driftNamed.nowUnreadable")
      : titles.length > 0
        ? t("common.driftNamed.applied.off", { count: titles.length, titles: titles.join(", "), ...RAW })
        : t("common.driftNamed.applied.offUnnamed");
    const before =
      lastSeen != null
        ? t("common.driftNamed.applied.before", { count, when: lastSeen, ...RAW })
        : t("common.driftNamed.applied.beforeUnknown", { count });
    return t("common.driftNamed.line", {
      name: t("common.driftNamed.applied.name"),
      clauses: join([now, before, noticedClause]),
      ...RAW,
    });
  }

  const nameKey = NAME_KEY[d.id];
  if (nameKey == null) {
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

  const hasNow = d.value_now != null && d.value_now.trim() !== "";
  const now = unreadable
    ? t("common.driftNamed.nowUnreadable")
    : hasNow
      ? t("common.driftNamed.now", { now: d.value_now, ...RAW })
      : t("common.driftNamed.nowNoReading");
  const hasBefore = d.last_ready_value != null && d.last_ready_value.trim() !== "";
  const before =
    lastSeen == null
      ? t("common.driftNamed.beforeUnknown")
      : hasBefore
        ? t("common.driftNamed.before", { before: d.last_ready_value, when: lastSeen, ...RAW })
        : t("common.driftNamed.beforeUnknownValue", { when: lastSeen, ...RAW });
  return t("common.driftNamed.line", { name: t(nameKey), clauses: join([now, before, noticedClause]), ...RAW });
}

/** The "and N more" tail for a list cut at `shown`, or null when nothing was cut. */
export function driftMore(total: number, shown: number, t: TFunction): string | null {
  return total > shown ? t("common.driftNamed.more", { count: total - shown }) : null;
}
