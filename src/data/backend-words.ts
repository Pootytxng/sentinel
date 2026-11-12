// CR-zh-backend-home (view-1112a/14-home-zh-CN.png): in zh-CN, Health printed words the backend
// sends in English. Only words with a STABLE id on this side are translated here:
//   - a Care incident's kind tag (blackbox.rs `IncidentKind::tag`, a closed set) and, built from
//     that tag plus `app_label` and `occurred_at`, its headline;
//   - a ledger row's `applied_label` (history.rs `applied_label_from_action`, a closed set);
//   - a rec's friendly headline (friendly-labels.ts, keyed by rec id).
// Names are never translated: the app's own name, a plan name, a game. A value outside the closed
// set (a newer backend) is shown as sent rather than guessed. English keeps the backend's own
// sentence for an incident (Black Box prints the same one, with its "while <game>" clause).
import type { TFunction } from "i18next";
import { FRIENDLY_LABELS } from "./friendly-labels";
import type { PendingCareIncident } from "../types";

/** The incident's kind tag in the app's language; an unknown tag as sent. */
export function incidentKindLabel(kind: string, t: TFunction): string {
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
      return kind;
  }
}

/** "Nov 11, 2:36 PM" in the app's language from the incident's RFC3339 stamp; the backend's
 *  display string when the stamp doesn't parse. */
function occurredIn(pc: Pick<PendingCareIncident, "occurred_at" | "occurred_display">, lang: string): string {
  const d = new Date(pc.occurred_at);
  if (isNaN(d.getTime())) return pc.occurred_display;
  return d.toLocaleString(lang, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The incident headline: English keeps the backend's sentence; another language composes it from
 *  the kind tag, the app's name as Windows recorded it and the time. An unknown tag, or an empty
 *  backend sentence (the caller has its own fallback), comes back as sent. */
export function careHeadline(
  pc: Pick<PendingCareIncident, "kind" | "app_label" | "occurred_at" | "occurred_display" | "summary">,
  t: TFunction,
  lang: string,
): string {
  const summary = pc.summary.trim();
  if (!summary || lang.toLowerCase().startsWith("en")) return summary;
  const when = occurredIn(pc, lang);
  const app = pc.app_label?.trim() || null;
  switch (pc.kind) {
    case "App crash":
      return app
        ? t("common.backendWords.headline.appCrash", { app, when })
        : t("common.backendWords.headline.appCrashNoApp", { when });
    case "App hang":
      return app
        ? t("common.backendWords.headline.appHang", { app, when })
        : t("common.backendWords.headline.appHangNoApp", { when });
    case "GPU timeout":
      return t("common.backendWords.headline.gpuTimeout", { when });
    case "Unexpected shutdown / hard freeze":
      return t("common.backendWords.headline.unexpectedShutdown", { when });
    case "Blue screen":
      return t("common.backendWords.headline.blueScreen", { when });
    case "Hardware-logged error":
      return t("common.backendWords.headline.hardwareError", { when });
    default:
      return summary;
  }
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
    default:
      return label;
  }
}

/** A rec's friendly headline in the app's language, or null when it has none. */
export function friendlyHeadline(recId: string, t: TFunction): string | null {
  if (!Object.prototype.hasOwnProperty.call(FRIENDLY_LABELS, recId)) return null;
  return t(`common.backendWords.friendly.${recId}`, { defaultValue: FRIENDLY_LABELS[recId].headline });
}
