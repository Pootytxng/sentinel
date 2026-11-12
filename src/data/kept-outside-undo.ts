// Undo after "Keep <plan>": the confirm for a row recorded as changed outside Compy says which plan
// the undo switches to (the one Compy saved before it switched, from the row's own snapshot), so
// nobody undoes expecting to stay on the plan they chose to keep.
import type { TFunction } from "i18next";
import { usableChangedOutside, type AppliedChange } from "../types";

// Windows' stock schemes by GUID (lib.rs SCHEME_*); any other GUID has no name Compy saved.
const STOCK: Record<string, (t: TFunction) => string> = {
  "381b4222-f694-41f0-9685-ff5bb260df2e": (t) => t("app.dialogs.planBalanced"),
  "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c": (t) => t("app.dialogs.planHighPerformance"),
  "e9a42b02-d5df-448d-aa00-03f14749eb61": (t) => t("app.dialogs.planUltimate"),
  // Windows' stock Power saver scheme (CR-range3-nits a): a saved prior plan of Power saver is named.
  "a1841308-3541-4fab-bc81-f71556f20b4a": (t) => t("app.dialogs.planPowerSaver"),
};

/** The prior plan GUID the row's typed snapshot holds (`{ kind: "power-plan", prior_guid }`), lower-cased. */
function savedGuid(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const s = snapshot as { kind?: unknown; prior_guid?: unknown };
  return s.kind === "power-plan" && typeof s.prior_guid === "string" && s.prior_guid.length === 36
    ? s.prior_guid.toLowerCase()
    : null;
}

/** The Undo confirm's body for a row recorded as changed outside Compy; null for every other row. */
export function keptOutsideUndoBody(
  change: Pick<AppliedChange, "snapshot" | "changed_outside">,
  t: TFunction,
): string | null {
  const rec = usableChangedOutside(change);
  if (!rec) return null;
  const kept = rec.observed.name;
  const guid = savedGuid(change.snapshot);
  const keptGuid = typeof rec.observed.guid === "string" ? rec.observed.guid.toLowerCase() : null;
  if (guid != null && keptGuid != null && guid === keptGuid) {
    return t("app.dialogs.rollbackKeptOutsideSame", { kept });
  }
  const stock = guid != null ? STOCK[guid] : undefined;
  if (stock) return t("app.dialogs.rollbackKeptOutside", { kept, saved: stock(t) });
  return t("app.dialogs.rollbackKeptOutsideUnnamed", { kept });
}
