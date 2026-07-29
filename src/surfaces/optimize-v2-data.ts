import type { TFunction } from "i18next";
import type { Recommendation } from "../types";

// Pure verdict/measured derivations for the V2 Optimize room (V2-4, spec
// 2026-07-02-v2-shell-sourcing-and-plan). Same contract as postureLine for Home: measured
// facts only, honestly-loading state while the catalog hasn't resolved, copy branches
// properly (never "(s)" — the plain-language bar).
//
// "Ready" here means what the room's headline promises: a SAFE-tier, one-click-appliable,
// eligible rec that isn't currently applied. Guided/judgment-call tweaks live in the body —
// the headline never counts what a click can't do.

export type OptimizeVerdictLine = {
  settled: boolean; // false while the catalog is still loading (no animation on a placeholder)
  // The apply-complete / all-clear state (P6 §2, absorbed by V2-8): true only when the catalog
  // has settled AND no safe one-click fix is left to apply. The forward door to Monitor renders
  // only then — the door is the reward for finishing the chapter, not a bypass.
  allClear: boolean;
  headline: string;
  sub?: string;
};

// The ONE "ready to apply, one-click-safe" predicate, as the list of matching recs. Both the
// count (safeFixesReady) and any consumer that needs the actual rec ids (the Home intake band's
// one-tap fast path, BACKLOG:916) derive from THIS — so a count and its apply-set can never drift
// out of a divergent re-implementation of the filter.
//
// `dismissedIds` is REQUIRED, and deliberately so (self-review round 9, 2026-07-29). It used to be
// absent entirely, so every caller counted recs the user had already declined and every headline
// built on it promised work that wasn't there. Making it a required positional argument means a
// future caller cannot forget it — the compiler asks the question the reviewer had to. Pass
// `EMPTY_DISMISSED` when the caller genuinely has no set (tests, fixtures), never `new Set()`
// inline, so the intent reads as "none" rather than "not wired up yet".
export const EMPTY_DISMISSED: ReadonlySet<string> = new Set<string>();

export function safeFixesReadyList(
  recs: Recommendation[],
  isAppliable: (recId: string) => boolean,
  dismissedIds: ReadonlySet<string>,
  revertedIds?: ReadonlySet<string>,
): Recommendation[] {
  return recs.filter(
    (r) =>
      r.severity === "safe" &&
      isAppliable(r.id) &&
      !r.currently_applied &&
      r.eligible !== false &&
      !dismissedIds.has(r.id) &&
      !revertedIds?.has(r.id),
  );
}

export function safeFixesReady(
  recs: Recommendation[],
  isAppliable: (recId: string) => boolean,
  dismissedIds: ReadonlySet<string>,
  revertedIds?: ReadonlySet<string>,
): number {
  return safeFixesReadyList(recs, isAppliable, dismissedIds, revertedIds).length;
}

/// How many of the recs a headline WOULD have counted are only missing because the user set them
/// aside. Lets a verdict say "nothing waiting, N set aside" instead of the two available lies:
/// "all applied" (the tweak is still off) or "N ready" (there is nothing to tap).
export function setAsideCount(
  recs: Recommendation[],
  isAppliable: (recId: string) => boolean,
  dismissedIds: ReadonlySet<string>,
  revertedIds?: ReadonlySet<string>,
): number {
  return (
    safeFixesReadyList(recs, isAppliable, EMPTY_DISMISSED, revertedIds).length -
    safeFixesReadyList(recs, isAppliable, dismissedIds, revertedIds).length
  );
}

// i18n note: `t` is threaded through as the LAST param (this is a plain data module, not a
// component — it can't call useTranslation() itself) — every call site passes its own `t` from
// useTranslation(). Mirrors ago()/smoothness() elsewhere in this codebase.
export function optimizeVerdict(
  recs: Recommendation[] | null,
  isAppliable: (recId: string) => boolean,
  // The user's "Not for me" set — required for the same reason as on the predicate above.
  dismissedIds: ReadonlySet<string>,
  activeCount: number,
  // Drifted changes (applied with Compy, since turned off outside it). The body renders these
  // ONLY under "Applied — turned off outside Compy" (V2-4b one-mention), so the headline must
  // never count them as "ready to apply" — the V2-9 punch (g) law: the verdict describes the
  // state the body actually shows.
  reverted: { rec_id: string }[] = [],
  t: TFunction,
): OptimizeVerdictLine {
  if (recs == null) {
    return {
      settled: false,
      allClear: false,
      headline: t("optimize.optimizeV2.verdict.checkingHeadline"),
    };
  }
  const revertedIds = new Set(reverted.map((r) => r.rec_id));
  const ready = safeFixesReady(recs, isAppliable, dismissedIds, revertedIds);
  const setAside = setAsideCount(recs, isAppliable, dismissedIds, revertedIds);
  // The undo promise is the rollback-first law stated plainly — and it names where undo lives.
  const undoSub = t("optimize.optimizeV2.verdict.undoSub");
  // When ready fixes AND drifted changes coexist, the ready headline wins (it's the primary
  // action), but the body ALSO shows the "turned off outside Compy" rows — so the sub must name
  // that drift too (V2-9 (g) law: the verdict describes the state the body actually shows). Without
  // this the drifted section rendered with no mention in the verdict at all.
  const driftClause =
    reverted.length === 1
      ? t("optimize.optimizeV2.verdict.driftClauseSuffix", { count: 1 })
      : reverted.length > 1
        ? t("optimize.optimizeV2.verdict.driftClauseSuffix", { count: reverted.length })
        : "";
  if (ready === 1)
    return {
      settled: true,
      allClear: false,
      headline: t("optimize.optimizeV2.verdict.readyHeadline", { count: 1 }),
      sub: undoSub + driftClause,
    };
  if (ready > 1)
    return {
      settled: true,
      allClear: false,
      headline: t("optimize.optimizeV2.verdict.readyHeadline", { count: ready }),
      sub: undoSub + driftClause,
    };
  // Drifted-only: nothing new to apply, but a change Compy made was switched off outside it.
  // Named honestly — maybe the user did it on purpose, so the verdict offers, never pushes.
  // Still not all-clear (an actionable row remains), so the forward door stays closed.
  if (reverted.length === 1)
    return {
      settled: true,
      allClear: false,
      headline: t("optimize.optimizeV2.verdict.driftedOnlyHeadline", { count: 1 }),
      sub: t("optimize.optimizeV2.verdict.driftedOnlySub", { count: 1 }),
    };
  if (reverted.length > 1)
    return {
      settled: true,
      allClear: false,
      headline: t("optimize.optimizeV2.verdict.driftedOnlyHeadline", { count: reverted.length }),
      sub: t("optimize.optimizeV2.verdict.driftedOnlySub", { count: reverted.length }),
    };
  // Nothing to tap, and the ONLY reason is that the user set those tweaks aside. This branch sits
  // ABOVE the activeCount ones on purpose: "Nothing new to apply — N safe changes are active" would
  // be a lie here, because the set-aside tweak is still OFF. All-clear is still true (there is
  // genuinely nothing waiting on the user), so the forward door stays open — but the verdict names
  // where the missing rows went, and that they can come back.
  if (setAside > 0)
    return {
      settled: true,
      allClear: true,
      headline: t("optimize.optimizeV2.verdict.setAsideHeadline", { count: setAside }),
      sub: t("optimize.optimizeV2.verdict.setAsideSub", { count: setAside }),
    };
  if (activeCount === 1)
    return {
      settled: true,
      allClear: true,
      headline: t("optimize.optimizeV2.verdict.allSafeActiveHeadline", { count: 1 }),
      sub: undoSub,
    };
  if (activeCount > 1)
    return {
      settled: true,
      allClear: true,
      headline: t("optimize.optimizeV2.verdict.allSafeActiveHeadline", { count: activeCount }),
      sub: undoSub,
    };
  return {
    settled: true,
    allClear: true,
    headline: t("optimize.optimizeV2.verdict.nothingToApplyHeadline"),
    sub: t("optimize.optimizeV2.verdict.nothingToApplySub"),
  };
}

// (The former measured-line header strip was retired 2026-07-10 — owner header-slop law: header
// space carries header-format text only. The check/catalog counts are the visible check list and
// fix rows themselves; Home's HUD masthead readout still carries the checks-measured count.)
