// CR-zh-backend-home (view-1112a/14-home-zh-CN.png): in zh-CN, Health printed words the backend
// sends in English. Only words with a STABLE id on this side are translated here:
//   - a Care incident's kind tag (blackbox.rs `IncidentKind::tag`, a closed set) and its headline,
//     from the card's `headline_parts` code (d10, incident-headline.ts);
//   - a ledger row's `applied_label` (history.rs `applied_label_from_action`, a closed set);
//   - a rec's friendly headline (friendly-labels.ts, keyed by rec id).
// Names are never translated: the app's own name, a plan name, a game. A value outside the closed
// set (a newer backend) is shown as sent rather than guessed. An incident headline is worded from
// its code in every language, English included (the en keys are pinned to Rust's sentence).
import type { TFunction } from "i18next";
import { FRIENDLY_LABELS } from "./friendly-labels";
import { incidentHeadline, recordWhen } from "./incident-headline";
import type { HeadlineParts, PendingCareIncident } from "../types";

/** The incident's kind tag in the app's language; an unknown tag as sent, or as `unknown` when the
 *  caller gives one (d10 r1: Black Box's chip passes its fixed plain word, never the backend's). */
export function incidentKindLabel(kind: string, t: TFunction, unknown: string = kind): string {
  switch (kind) {
    case "App crash":
      return t("common.backendWords.kind.appCrash");
    case "App hang":
      return t("common.backendWords.kind.appHang");
    case "GPU timeout":
      return t("common.backendWords.kind.gpuTimeout");
    case "Unexpected shutdown / hard freeze":
      return t("common.backendWords.kind.unexpectedShutdown");
    case "Blue screen":
      return t("common.backendWords.kind.blueScreen");
    case "Hardware-logged error":
      return t("common.backendWords.kind.hardwareError");
    default:
      return unknown;
  }
}

/** "Nov 11, 2:36 PM" in the app's language from the incident's RFC3339 stamp, at the stamp's OWN
 *  offset (as the backend's `occurred_display` is), never the machine's zone; English, or a stamp
 *  without a readable offset, gets the backend's display string as sent. */
export function incidentWhen(pc: Pick<PendingCareIncident, "occurred_at" | "occurred_display">, lang: string): string {
  return recordWhen(pc.occurred_at, pc.occurred_display, lang);
}

/** Parts for a Care card stored before d10 (no `headline_parts`), from its closed kind tag and the app
 *  name Windows recorded. No game tail: the card holds it only inside its English sentence, and that
 *  is not parsed. An unknown tag gives null, so the stored sentence is shown. */
function legacyParts(kind: string, appLabel: string | null): HeadlineParts | null {
  const app = appLabel?.trim() || null;
  const parts = (code: string, withApp = false): HeadlineParts => ({ code, app: withApp ? app : null, while_game: null });
  switch (kind) {
    case "App crash":
      return app ? parts("app_crash", true) : parts("app_crash_no_app");
    case "App hang":
      return app ? parts("app_hang", true) : parts("app_hang_no_app");
    case "GPU timeout":
      return parts("gpu_timeout");
    case "Unexpected shutdown / hard freeze":
      return parts("unexpected_shutdown");
    case "Blue screen":
      return parts("blue_screen");
    case "Hardware-logged error":
      return parts("hardware_error");
    default:
      return null;
  }
}

/** The Care card's headline (d10): worded from the card's `headline_parts` in the app's language
 *  (incident-headline.ts). A card stored before the parts existed: English shows its stored
 *  `summary` as it is; another language words it from the card's kind tag and app name (r1: keeps
 *  CR-zh-backend-home), and an unknown tag shows the stored summary. An empty summary on such a card
 *  comes back empty (the caller has its own fallback). */
export function careHeadline(
  pc: Pick<PendingCareIncident, "headline_parts" | "kind" | "app_label" | "occurred_at" | "occurred_display" | "summary">,
  t: TFunction,
  lang: string,
): string {
  const summary = pc.summary.trim();
  let parts = pc.headline_parts ?? null;
  if (!parts) {
    if (!summary || lang.toLowerCase().startsWith("en")) return summary;
    parts = legacyParts(pc.kind, pc.app_label);
    if (!parts) return summary;
  }
  return incidentHeadline(
    { headline_parts: parts, headline: summary, when: pc.occurred_at, when_display: pc.occurred_display },
    t,
    lang,
  );
}

/** A ledger row's "set to" value in the app's language; a value outside the closed set as sent. */
export function appliedValueLabel(label: string, t: TFunction): string {
  switch (label) {
    case "On":
      return t("common.backendWords.applied.on");
    case "Off":
      return t("common.backendWords.applied.off");
    case "Off (on AC)":
      return t("common.backendWords.applied.offOnAc");
    case "Best performance":
      return t("common.backendWords.applied.bestPerformance");
    case "Ultimate performance":
      return t("common.backendWords.applied.ultimatePerformance");
    case "Stopped":
      return t("common.backendWords.applied.stopped");
    case "Starts with Windows":
      return t("common.backendWords.applied.startsWithWindows");
    case "Won't start with Windows":
      return t("common.backendWords.applied.wontStartWithWindows");
    case "Disabled":
      return t("common.backendWords.applied.disabled");
    case "Removed for this user":
      return t("common.backendWords.applied.removedForUser");
    case "Windows default":
      return t("common.backendWords.applied.windowsDefault");
    case "In Performance Log Users":
      return t("common.backendWords.applied.inPerfLogUsers");
    default:
      return label;
  }
}

/** A rec's friendly headline in the app's language, or null when it has none. */
export function friendlyHeadline(recId: string, t: TFunction): string | null {
  if (!Object.prototype.hasOwnProperty.call(FRIENDLY_LABELS, recId)) return null;
  return t(`common.backendWords.friendly.${recId}`, { defaultValue: FRIENDLY_LABELS[recId].headline });
}

// CR-zh-readiness-words: a readiness check's label and detail are formatted in Rust (readiness.rs)
// with a name or number inside ("Active plan "Synez Power Plan". ..."), and the limiter card prints
// them through priorities.rs (title = label, reason = detail). Each check below is keyed by its
// stable (id, status) plus the exact English sentence Rust sends (mirrored here): (id, status) alone
// is not unique (two Unknown sentences per check). The check's `value` is not used as the
// placeholder: it is formatted differently from the sentence ("60 / 250 Hz", "412 days") and the GPU
// name is not in it, so the name and numbers are lifted out of the sentence and put back untranslated. A
// sentence that matches no mirror (a newer backend, a check not listed here) is shown as sent, and
// English always gets the backend's own words.
type ReadinessVariant = {
  id: string;
  status: string;
  /** The label Rust sends, and its key. */
  label: string;
  labelKey: string;
  /** The detail Rust sends with {{name}} where it formats a value in, and its key. */
  detail: string;
  detailKey: string;
};

const READINESS_VARIANTS: ReadinessVariant[] = [
  // readiness.rs "6. Power profile"
  { id: "power-profile", status: "unknown", label: "Power profile", labelKey: "common.backendWords.readiness.powerProfile.label",
    detail: "Couldn't read the active Windows power plan.", detailKey: "common.backendWords.readiness.powerProfile.unknown" },
  { id: "power-profile", status: "advisory", label: "Power profile", labelKey: "common.backendWords.readiness.powerProfile.label",
    detail: 'Active plan "{{plan}}", which you chose to keep as set outside Compy. Compy changes nothing by itself.',
    detailKey: "common.backendWords.readiness.powerProfile.kept" },
  { id: "power-profile", status: "ready", label: "Power profile", labelKey: "common.backendWords.readiness.powerProfile.label",
    detail: 'Active plan "{{plan}}".', detailKey: "common.backendWords.readiness.powerProfile.ready" },
  { id: "power-profile", status: "attention", label: "Power plan is set to save power",
    labelKey: "common.backendWords.readiness.powerProfile.labelAttention",
    detail: 'Active plan "{{plan}}". Windows designed this plan to save power. Compy has not measured its effect on this PC. Compy changes nothing by itself. You can switch plans in Windows Settings, Power.',
    detailKey: "common.backendWords.readiness.powerProfile.attention" },
  // readiness.rs "1. Monitor refresh rate"
  { id: "monitor-refresh", status: "unknown", label: "Monitor refresh rate", labelKey: "common.backendWords.readiness.monitorRefresh.label",
    detail: "No display information was detected.", detailKey: "common.backendWords.readiness.monitorRefresh.noDisplay" },
  { id: "monitor-refresh", status: "unknown", label: "Monitor refresh rate", labelKey: "common.backendWords.readiness.monitorRefresh.label",
    detail: "Couldn't read the display's supported refresh rates.", detailKey: "common.backendWords.readiness.monitorRefresh.noRates" },
  { id: "monitor-refresh", status: "ready", label: "Monitor refresh rate", labelKey: "common.backendWords.readiness.monitorRefresh.label",
    detail: "Running at the maximum supported {{max}} Hz.", detailKey: "common.backendWords.readiness.monitorRefresh.ready" },
  { id: "monitor-refresh", status: "attention", label: "Monitor below max refresh",
    labelKey: "common.backendWords.readiness.monitorRefresh.labelAttention",
    detail: "Running at {{current}} Hz but the display supports {{max}} Hz. Set the higher rate in Windows Display settings → Advanced display.",
    detailKey: "common.backendWords.readiness.monitorRefresh.attention" },
  // readiness.rs "3. GPU driver age"
  { id: "gpu-driver-age", status: "unknown", label: "GPU driver age", labelKey: "common.backendWords.readiness.gpuDriverAge.label",
    detail: "No GPU was detected.", detailKey: "common.backendWords.readiness.gpuDriverAge.noGpu" },
  { id: "gpu-driver-age", status: "unknown", label: "GPU driver age", labelKey: "common.backendWords.readiness.gpuDriverAge.label",
    detail: "Couldn't read a driver date for {{gpu}}.", detailKey: "common.backendWords.readiness.gpuDriverAge.noDate" },
  { id: "gpu-driver-age", status: "ready", label: "GPU driver age", labelKey: "common.backendWords.readiness.gpuDriverAge.label",
    detail: "{{gpu}} driver is current ({{days}} days old).", detailKey: "common.backendWords.readiness.gpuDriverAge.ready" },
  { id: "gpu-driver-age", status: "advisory", label: "GPU driver age", labelKey: "common.backendWords.readiness.gpuDriverAge.label",
    detail: "{{gpu}} driver is {{days}} days old — still fine. Worth updating around a new game's launch for day-one fixes, but nothing's broken here; updating mid-cycle rarely moves measured FPS.",
    detailKey: "common.backendWords.readiness.gpuDriverAge.advisory" },
  { id: "gpu-driver-age", status: "attention", label: "GPU driver over a year old",
    labelKey: "common.backendWords.readiness.gpuDriverAge.labelAttention",
    detail: "{{gpu}} driver is over a year old ({{days}} days). Updating is recommended.",
    detailKey: "common.backendWords.readiness.gpuDriverAge.attention" },
];

/** Numbers Rust formats in are whole numbers; anything else is a name, taken as sent. */
const NUMERIC_SLOTS = new Set(["max", "current", "days"]);

function variantMatch(detail: string, template: string): Record<string, string> | null {
  const names: string[] = [];
  const source = template
    .split(/(\{\{\w+\}\})/)
    .map((part) => {
      const slot = /^\{\{(\w+)\}\}$/.exec(part);
      if (!slot) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      names.push(slot[1]);
      return NUMERIC_SLOTS.has(slot[1]) ? "(\\d+)" : "(.+)";
    })
    .join("");
  const m = new RegExp(`^${source}$`, "s").exec(detail);
  if (!m) return null;
  const values: Record<string, string> = {};
  names.forEach((n, i) => {
    values[n] = m[i + 1];
  });
  return values;
}

/** A readiness check's label and detail in the app's language. English, or a check whose exact
 *  English sentence isn't mirrored here, comes back as sent. Names and numbers are never translated. */
export function readinessWords(
  c: { id: string; status: string; label: string; detail: string },
  t: TFunction,
  lang: string,
): { label: string; detail: string } {
  const sent = { label: c.label, detail: c.detail };
  if (lang.toLowerCase().startsWith("en")) return sent;
  for (const v of READINESS_VARIANTS) {
    if (v.id !== c.id || v.status !== c.status || v.label !== c.label) continue;
    const values = variantMatch(c.detail, v.detail);
    if (!values) continue;
    return {
      label: t(v.labelKey, { defaultValue: c.label }),
      detail: t(v.detailKey, { ...values, defaultValue: c.detail, interpolation: { escapeValue: false } }),
    };
  }
  return sent;
}

/** Every mirrored English sentence, for the locale test (en must say exactly what Rust says). */
export const READINESS_MIRROR: ReadonlyArray<Pick<ReadinessVariant, "label" | "labelKey" | "detail" | "detailKey">> =
  READINESS_VARIANTS;
