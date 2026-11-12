import { ConfidenceWord } from "../design/ConfidenceWord";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeLedger } from "../data/ledger-write";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Priorities, PriorityItem, SessionSummary, StartupEntry, UpgradePath, UpgradeSuggestion } from "../types";
import { LIMITER_AWAY } from "./rig/limiter-part";
import { TrustSwitch } from "../design/TrustSwitch";
import { WhatsThis } from "../design/WhatsThis";
import { useConfirm } from "../design/ConfirmDialog";
import { WalkthroughDisclosure } from "../design/WalkthroughDisclosure";
import { walkthroughForKeyForLanguage, gpuVendor, type GpuVendor } from "./walkthroughs";
import { tuningGuideForVendorForLanguage } from "../data/tuning-guides";
import { gpuRunningHot } from "../data/tuning-measure";
import { setStartupEntryEnabled } from "../data/startup-toggle";
import { useHardwareChange, summarizeHardwareChanges } from "../hooks/use-hardware-change";
import { useScan, buildSetupSummary, rowVerdict } from "./use-scan";
import { useExpertView } from "../design/use-expert-view";
import { ScanStream } from "./ScanStream";
import { SidePileItem, SIDE_PILE_ORDER } from "./side-pile";
import { upgradeFitLine } from "./upgrade-fit";
import { prettyGameName } from "./game-name";
import { readManualParts } from "./rig/manual-parts";
import { gpuUntied, AGGREGATE_REC_ROWS, anyLimiterUnread, measuredClearOfGpuLimit } from "./settings-done";
// Side-effect import: guarantees the i18next singleton is initialized even when this component
// is the first (or only) thing a test/entry point loads — mirrors main.tsx's own `import "./i18n"`.
import "../i18n";
import "./Check.css";

/** P9-limit-source: a recorded session's start as a date in the app's language ("Nov 11", with the
 *  year when it isn't this year's); the stamp as sent when it doesn't parse. */
function sessionDate(iso: string, lang: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const year = d.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {};
  return d.toLocaleDateString(lang, { month: "short", day: "numeric", ...year });
}

/** CR-view-1112c-zh-gap (screen check view-1112c 04-optimize-zh-CN.png): two sentences join with a
 *  space in English and with none after a full-width stop in Chinese. */
function sentenceGap(lang: string | undefined): string {
  return (lang ?? "").startsWith("zh") ? "" : " ";
}

/** P9-screen-is-limit: a GPU row whose own session averaged at or above the refresh rate that session
 *  recorded. Both must be measured; null otherwise (the GPU row reads as before). */
function screenIsLimit(item: UpgradeSuggestion): { hz: number; fps: number; game: string } | null {
  const m = item.measured_from;
  if (item.kind !== "gpu" || !m) return null;
  const fps = m.avg_fps;
  const hz = m.refresh_hz;
  if (fps == null || hz == null || !Number.isFinite(fps) || !Number.isFinite(hz) || fps <= 0 || hz <= 0) return null;
  return fps >= hz ? { hz, fps: Math.round(fps), game: m.game } : null;
}

// Structural subset of App's GpuInfo — driver freshness needs only name + age (object covariance).
type GpuDriverInfo = { name: string; driver_age_days: number | null };

// Leftovers v1 (read-only) — mirrors the Rust LeftoversReport shape.
type Leftover = {
  id: string;
  title: string;
  current_value: string;
  stock_default: string;
  matched_tweak: string;
  mechanism_cost: string;
  verdict: string;
  uncertain_source: boolean;
  restore_note: string;
};
type UnavailableProbe = { id: string; title: string; reason: string };
type LeftoversReport = { findings: Leftover[]; checked: number; unavailable: UnavailableProbe[] };

// Finding id → the Learn entry that explains its family (WhatsThis renders only where one exists).
// Exported so the law-guard test can verify every detector resolves to a REAL entry (no dead links).
// memory-compression-off resolves by its own id (entry added 2026-06-11).
export const LEFTOVER_LEARN_ID: Record<string, string> = {
  "pagefile-fixed": "pagefile-disable",
  "bcdedit-timer-flags": "useplatformclock",
  "mmcss-tampering": "mmcss-systemresponsiveness",
  "core-parking-forced": "core-unparking",
  "defender-policy-off": "disable-defender",
  "mpo-disabled": "mpo-disable",
  "tcp-autotuning-off": "tcp-mega-packs",
  "win32-priority-separation": "win32priorityseparation",
};

// Stable vendor support roots for the COPYABLE url (spec 2026-06-10-driver-freshness-check).
// Never a launch button — opening external https would need an owner-gated allowlist change.
const VENDOR_SUPPORT: Partial<Record<GpuVendor, { label: string; url: string }>> = {
  amd: { label: "AMD", url: "https://www.amd.com/en/support" },
  nvidia: { label: "NVIDIA", url: "https://www.nvidia.com/Download/index.aspx" },
  intel: { label: "Intel", url: "https://www.intel.com/content/www/us/en/download-center/home.html" },
};

// NIC driver freshness (R2 driver win-source v1) — mirrors the Rust NicDriverInfo shape.
type NicDriverInfo = { name: string; driver_date: string; driver_age_days: number | null; vendor: string };
const NIC_SUPPORT: Record<string, { label: string; url: string }> = {
  intel: { label: "Intel", url: "https://www.intel.com/content/www/us/en/download-center/home.html" },
  realtek: { label: "Realtek", url: "https://www.realtek.com/Download" },
};

// Pure threshold logic. Age is a FACT we read locally; "newer exists" stays a MAYBE — we cannot
// know the latest driver without the network (remote fetch is gated off), so never "out of date",
// never a version claim. Unreadable date → neutral skip, no alarm. Vendor comes from the GPU's own
// name (not the app-level vendor prop) so the advisory names the right driver on mixed rigs.
function driverFreshness(
  gpus: GpuDriverInfo[],
  t: TFunction,
):
  | { tone: "skip" | "pass"; message: string; url?: undefined; label?: undefined }
  | { tone: "advisory"; message: string; label: string; url: string | null } {
  const gpu = gpus.find((g) => g.driver_age_days != null);
  if (!gpu)
    return {
      tone: "skip",
      message: t("optimize.check.driverUnreadable"),
    };
  const age = gpu.driver_age_days as number;
  if (age <= 90) return { tone: "pass", message: t("optimize.check.driverRecent", { days: age }) };
  const v = VENDOR_SUPPORT[gpuVendor(gpu.name)];
  // The row states the FACT only; the card's single shared note carries the one "newer may be
  // available" maybe for every stale driver (P5.5: no duplicated paragraphs per device).
  return {
    tone: "advisory",
    message: t("optimize.check.driverStale", {
      vendor: v?.label ?? t("optimize.check.driverVendorFallbackGpu"),
      days: age,
    }),
    label: v?.label ?? t("optimize.check.driverVendorFallbackGeneric"),
    url: v?.url ?? null,
  };
}

// CHECK — the consolidation surface that absorbs Readiness + Priorities (spec 2026-06-06-check-play-lab).
// Top: the shared scan (radar + streaming rows from useScan — same core as the first-run arc). Below:
// Priorities' buckets as the permanent ranked result, with drift-watch cards when a regression-
// outside-Compy is detected. Self-contained via useScan + its own apply (existing command); onChanged
// lets App re-sync its other surfaces. Zero new IPC.

export default function Check({
  isAppliable,
  onOpenLibrary,
  onChanged,
  vendor,
  sessions = [],
  gpus = [],
  embedded = false,
  onExport,
  exporting = false,
  v2Ia = false,
  onOpenCare,
  onUpgradePath,
  onScanPriorities,
}: {
  isAppliable: (recId: string) => boolean;
  onOpenLibrary: (focusId?: string) => void;
  onChanged: () => Promise<unknown> | void;
  vendor: GpuVendor;
  sessions?: SessionSummary[];
  gpus?: GpuDriverInfo[];
  // When composed inside the merged Optimize "Fixes" segment, the segment label already names the
  // surface — so suppress the standalone "Check" tab-title to avoid stacked redundant headings.
  embedded?: boolean;
  // Calm chrome (P5): the full-report export rides with the scan results (the setup-summary card)
  // instead of the app header. App-owned handler/modal; renders only when the flag is on.
  onExport?: () => void;
  exporting?: boolean;
  // V2-4b IA (spec 2026-07-03-owner-optimize-feedback): only the V2 Optimize room sets this —
  // classic/standalone render byte-identically with it false. Under the one-mention law the
  // aggregate limiters that re-render recs Fix already shows as rows (pending-safe-recs,
  // applied-changes) are suppressed (Fix carries their state ON its rows), the setup summary
  // moves to the Applied segment (a record, not an action), driver freshness renders ONLY when
  // there is actually something stale to say, and the upgrade path is labeled early.
  v2Ia?: boolean;
  /** P6-timeline: opens the Care view (Crash & Freeze Rescue), whose "Since it last worked" list is
   *  the one place drift and hardware changes are listed. Absent → the pointer is text only. */
  onOpenCare?: () => void;
  /** P9-upgrade-block-reachable: called with this scan's upgrade path (null = none) each time it
   *  changes, for a room that renders `UpgradePathBlock` itself (Check suppresses it under v2Ia). */
  onUpgradePath?: (upgradePath: UpgradePath | null) => void;
  /** P9-no-upgrade-named: called with this scan's priorities (null = no scan in hand) each time they
   *  change, for a room that renders `NoUpgradeBlock` when the scan named no hardware limiter. */
  onScanPriorities?: (priorities: Priorities | null) => void;
}) {
  const { t, i18n } = useTranslation();
  // cache: true — Optimize/Fixes is the PERMANENT surface (vs the first-run FirstCheck/Tour arcs), so
  // re-opening it serves the last verdict instantly instead of replaying the scan + 280ms/row reveal
  // every visit. The cache clears on any apply/rollback; "Re-run check" still does a full fresh scan.
  const { readiness, priorities, recs, reverted, running, failed, elapsed, shownRows, phase, rerun } =
    useScan({ cache: true });
  const [applyingId, setApplyingId] = useState<string | null>(null);
  // Expert view (spec 2026-07-11-expert-layer-middle-ground §3): the "measured fine" and "not worth
  // touching" piles render open — the long tail stops being de-emphasized. Flipping the preference
  // re-baselines both; the user can still fold either afterward. Presentation-only.
  const expert = useExpertView();
  const [fineOpen, setFineOpen] = useState(expert);
  // Post-scan, the full per-check row list collapses behind a quiet toggle (the confidence chips carry
  // the summary; the actionable items render in the verdict below) — keeps the settled tab neat.
  const [showAllChecks, setShowAllChecks] = useState(false);
  // "Not worth touching" (the refusal pile) is secondary noise — collapse it by default like the
  // "measured fine" pile, so the settled tab leads with what's actionable.
  const [notWorthOpen, setNotWorthOpen] = useState(expert);
  useEffect(() => {
    setFineOpen(expert);
    setNotWorthOpen(expert);
  }, [expert]);
  const confirm = useConfirm();

  const linkedRec = (lim: PriorityItem) => {
    const id = lim.linked ?? lim.id;
    return recs.find((r) => r.id === id);
  };
  const canApply = (lim: PriorityItem) => {
    const r = linkedRec(lim);
    return !!r && !r.currently_applied && isAppliable(r.id);
  };

  const applyLimiter = async (lim: PriorityItem) => {
    const r = linkedRec(lim);
    if (!r) return;
    const ok = await confirm({
      title: t("optimize.check.applyTitle", { title: r.title }),
      body: t("optimize.check.snapshotConfirmBody"),
      confirmLabel: t("optimize.check.applyConfirmLabel"),
    });
    if (!ok) return;
    setApplyingId(r.id);
    try {
      // Announces the ledger change first: the Test room's experiment bench, mounted beside this
      // surface, re-reads only on that event or a refocus (#619).
      await writeLedger("apply_recommendation", { recId: r.id, recTitle: r.title });
      await rerun();
      onChanged(); // keep App's other surfaces in sync
    } catch (e) {
      setApplyingId(null);
      // Don't fail silently — a declined UAC prompt or a refused apply must TELL the user it
      // didn't happen, not leave them guessing until the next scan re-derives state.
      await confirm({
        title: t("optimize.check.applyFailedTitle"),
        body: String(e),
        confirmLabel: t("optimize.check.ok"),
        acknowledge: true,
      });
    } finally {
      setApplyingId(null);
    }
  };

  // Turn a specific drifted-off change back on, right here — names the setting + carries its fix,
  // instead of "1 setting(s) — go to Optimize/Ledger". Re-applies via the snapshotted apply path.
  const applyReverted = async (rev: { rec_id: string; title: string }) => {
    const ok = await confirm({
      title: t("optimize.check.turnOnTitle", { title: rev.title }),
      body: t("optimize.check.snapshotConfirmBody"),
      confirmLabel: t("optimize.check.turnItOn"),
    });
    if (!ok) return;
    setApplyingId(rev.rec_id);
    try {
      await writeLedger("apply_recommendation", { recId: rev.rec_id, recTitle: rev.title });
      await rerun();
      onChanged();
    } catch (e) {
      setApplyingId(null);
      await confirm({
        title: t("optimize.check.turnOnFailedTitle"),
        body: String(e),
        confirmLabel: t("optimize.check.ok"),
        acknowledge: true,
      });
    } finally {
      setApplyingId(null);
    }
  };
  const gameModeDrifted = reverted.some((r) => r.rec_id === "game-mode");

  // startup-load: name the apps + let the user turn them off RIGHT HERE (not "go to the Startup tab").
  // Fetched lazily only when the limiter is present; the toggle is the same reversible non-elevated
  // HKCU StartupApproved write the Tune startup list uses (disabling stops auto-start, never uninstalls).
  const [startup, setStartup] = useState<StartupEntry[]>([]);
  const [togglingStartup, setTogglingStartup] = useState<string | null>(null);
  const hasStartupLimiter = (priorities?.limiters ?? []).some((l) => l.id === "startup-load");
  useEffect(() => {
    if (!hasStartupLimiter) return;
    let alive = true;
    invoke<StartupEntry[]>("get_startup_entries")
      .then((e) => {
        if (alive) setStartup(e);
      })
      .catch(() => {
        /* read-only probe; absence just shows nothing */
      });
    return () => {
      alive = false;
    };
  }, [hasStartupLimiter]);
  const disableStartup = async (entry: StartupEntry) => {
    setTogglingStartup(entry.name);
    try {
      // A disable is a ledger change (#599): the helper announces it before these re-reads. Once it
      // has landed, App's refresh (History, Health) runs and is awaited on its own — this list's
      // re-read is a best-effort probe like the first one, and its failure is not a failed disable.
      await setStartupEntryEnabled(entry.name, false, () =>
        Promise.all([
          onChanged(),
          invoke<StartupEntry[]>("get_startup_entries").then(setStartup, () => {
            /* the list keeps its last read; the disable itself succeeded */
          }),
        ]),
      );
    } catch (e) {
      setTogglingStartup(null);
      await confirm({
        title: t("optimize.check.startupChangeFailedTitle"),
        body: String(e),
        confirmLabel: t("optimize.check.ok"),
        acknowledge: true,
      });
    } finally {
      setTogglingStartup(null);
    }
  };

  // P9-upgrade-block-reachable: the room that composes Check under v2Ia renders the upgrade block
  // itself, below its action groups (V2-4b), so it is handed the same scan's upgrade path.
  const upgradePath = priorities?.upgrade_path ?? null;
  useEffect(() => {
    onUpgradePath?.(upgradePath);
  }, [upgradePath, onUpgradePath]);
  const scanPriorities = priorities ?? null;
  useEffect(() => {
    onScanPriorities?.(scanPriorities);
  }, [scanPriorities, onScanPriorities]);

  const checks = readiness?.checks ?? [];
  // One-mention law (V2-4b): these two aggregate limiters re-render recommendations that the
  // composed Fix surface already shows as actionable rows (Game Mode was appearing 3×). Under
  // the v2 IA their state rides ON those rows; the ranked list keeps only non-rec limiters.
  const allLimiters = priorities?.limiters ?? [];
  const limiters = v2Ia
    ? allLimiters.filter((l) => l.id !== "pending-safe-recs" && l.id !== "applied-changes")
    : allLimiters;
  const alreadyFine = priorities?.already_fine ?? [];
  const notWorth = priorities?.not_worth_touching ?? [];
  const checkDrifts = (readiness?.drifts ?? []).filter((d) => d.id !== "applied-changes");

  // Advisory tuning nudge (spec 2026-06-08) — appears ONLY when recent sessions ran sustained-warm
  // (bathroom law: signposted at the moment of need, never a standing "try undervolting!" banner).
  // AMD-only in v1 (the guide is AMD). It's a named-place link to the Learn guide (deliberate travel),
  // not a one-click fix (doorknob) — Compy never tunes the voltage for you.
  const tuningGuide = tuningGuideForVendorForLanguage(vendor, i18n.language);
  const hot = tuningGuide ? gpuRunningHot(sessions) : null;

  // Leftovers v1 — strictly ON-DEMAND (charter: no scan on launch, no background scanning).
  // Read-only: checking changes nothing; v1 wires no restore.
  const [leftovers, setLeftovers] = useState<LeftoversReport | null>(null);
  const [leftoversBusy, setLeftoversBusy] = useState(false);
  const [leftoversErr, setLeftoversErr] = useState<string | null>(null);
  const runLeftovers = async () => {
    setLeftoversBusy(true);
    setLeftoversErr(null);
    try {
      setLeftovers(await invoke<LeftoversReport>("get_leftovers"));
    } catch {
      // Tell the user it didn't finish (was silently swallowed → looked identical to not-yet-run).
      setLeftoversErr(t("optimize.check.leftoversFailedError"));
    } finally {
      setLeftoversBusy(false);
    }
  };

  // Driver freshness (read-only advisory) — only rendered when the caller wires hardware in,
  // so surfaces/tests that don't pass gpus see nothing rather than a spurious "unreadable".
  const driver = gpus.length > 0 ? driverFreshness(gpus, t) : null;
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const copyDriverUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 1500);
    } catch {
      /* clipboard blocked — the URL text stays visible to select manually */
    }
  };

  // NIC driver freshness — LAZY: fetched once, only when the driver card actually renders
  // (its own command keeps the slow Win32_PnPSignedDriver read off the hardware hot path).
  // Not probe-cached: this read is already conditional + lazy (only fires when a stale-driver advisory
  // is shown AND nicDrivers is null), so it's off the hot path, and keeping it live preserves a fresh
  // read each time the card appears.
  const [nicDrivers, setNicDrivers] = useState<NicDriverInfo[] | null>(null);
  useEffect(() => {
    if (!driver || nicDrivers !== null) return;
    invoke<NicDriverInfo[]>("get_nic_driver_info")
      .then((r) => setNicDrivers(r ?? []))
      .catch(() => setNicDrivers([]));
  }, [driver, nicDrivers]);
  const staleNics = (nicDrivers ?? []).filter(
    (n) => n.driver_age_days != null && n.driver_age_days > 90,
  );

  // Hardware-change detection (A5): the backend fingerprints the rig and flags when core parts
  // changed since last setup. Built but previously UNWIRED — surfaced here as an advisory card that
  // names exactly what changed, with an inline "this is my rig now" that re-baselines so it can
  // never nag forever (the no-dead-end-flags law).
  const { report: hwChange, acknowledging: ackingHw, acknowledge: acknowledgeHwChange } =
    useHardwareChange();
  // Overflow handling: on a big multi-part swap the change list can be long — cap what we render
  // and collapse the remainder to "and N more change(s)" so the advisory never floods the card.
  const hwSummary = summarizeHardwareChanges(hwChange?.changes ?? []);

  const livingPreview =
    typeof document !== "undefined" && document.documentElement.dataset.living === "on";

  // Exportable setup summary (A5) — a plain-English, paste-ready restatement of what this scan
  // measured, so the user can share their setup with a friend/forum. Read-only: it's clipboard-copy
  // of already-measured facts (no IPC, no launch, no mutation); buildSetupSummary never fabricates.
  const setupSummary = buildSetupSummary(readiness, priorities, t);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const copySetupSummary = async () => {
    try {
      await navigator.clipboard.writeText(setupSummary);
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 1500);
    } catch {
      /* clipboard blocked — the summary text stays on screen to select manually */
    }
  };

  return (
    <section className="check-root">
      <header className="check-head">
        <div>
          {!embedded && <h2 className="check-title">{t("common.rail.check")}</h2>}
          {/* V2-4b: settled, the RoomShell verdict + confidence chips own the summary — this line
              would stack a third restatement. It still narrates the scan while one is running. */}
          {(!v2Ia || running) && (
          <p className="check-sub">
            {running
              ? t("optimize.check.scanningYourRig")
              : failed
                ? // The scan rejected: nothing new was read, so no clean claim; with an earlier result
                  // on screen, say that it is the earlier one (CR-tour-reject).
                  readiness
                  ? t("optimize.check.scanFailedPrevious")
                  : t("optimize.check.scanFailed")
                : livingPreview
                ? // An unread check never "came back right" (codebase review 2026-11-03): with any
                  // unread, the line speaks for the checks Compy could read and names the rest.
                  (readiness?.unknown_count ?? 0) > 0
                  ? limiters.length === 0
                    ? t("optimize.check.measuredCleanReadable", { count: readiness!.unknown_count })
                    : t("optimize.check.livingWorthLookUnread", {
                        count: limiters.length,
                        unread: readiness!.unknown_count,
                      })
                  : limiters.length === 0
                    ? // An advisory is noted, not graded (VRR, HDR, 8 GB of RAM): never "came back right".
                      (readiness?.advisory_count ?? 0) > 0
                      ? t("optimize.check.measuredCleanJudged", { count: readiness!.advisory_count })
                      : t("optimize.check.measuredCleanRig")
                    : t("optimize.check.livingWorthLook", { count: limiters.length })
                : t("optimize.check.classicSummary", {
                    checks: checks.length,
                    elapsed: elapsed?.toFixed(1) ?? "—",
                    limiters: limiters.length,
                  })}
          </p>
          )}
        </div>
        <button className="check-rerun" disabled={running} onClick={() => rerun()}>
          {running ? t("optimize.check.scanningEllipsis") : t("optimize.check.rerunCheck")}
        </button>
      </header>

      {/* Confidence chips (owner-greenlit) — the readiness breakdown by status, color-coded: a quick
          green/neutral/red read of where the rig stands. Reuses the counts already computed by
          get_game_readiness; each chip hidden when its count is 0 (a clean rig shows just "N ready"). */}
      {phase === "verdict" && readiness && (
        <div className="check-confidence" role="status" aria-label={t("optimize.check.readinessBreakdownAria")}>
          {/* "look good" not "ready" — the room verdict already uses "ready" for appliable
              FIXES; these chips count CHECKS. One word per meaning (V2-9 punch f), and the
              copy branches properly — never "1 need attention" (punch e). */}
          {readiness.ready_count > 0 && (
            <span className="cc-chip cc-chip-ready">
              {t("optimize.check.chipLooksGood", { count: readiness.ready_count })}
            </span>
          )}
          {readiness.advisory_count > 0 && (
            <span className="cc-chip cc-chip-advisory">
              {t("optimize.check.chipAdvisory", { count: readiness.advisory_count })}
            </span>
          )}
          {readiness.attention_count > 0 && (
            <span className="cc-chip cc-chip-attention">
              {t("optimize.check.chipNeedsAttention", { count: readiness.attention_count })}
            </span>
          )}
          {readiness.unknown_count > 0 && (
            <span className="cc-chip cc-chip-unknown">
              {t("optimize.check.chipUnknown", { count: readiness.unknown_count })}
            </span>
          )}
        </div>
      )}

      {/* During the scan: the live streaming radar. Once settled: the full per-check receipt collapses
          behind a quiet toggle — the confidence chips above carry the summary and the verdict below
          carries the actions, so the long row list no longer dominates the settled tab. */}
      {running || phase === "scan" ? (
        <ScanStream readiness={readiness} shownRows={shownRows} running={running} phase={phase} />
      ) : (
        readiness &&
        readiness.checks.length > 0 && (
          <div className="check-fine check-allchecks">
            <button
              className="check-fine-head"
              onClick={() => setShowAllChecks((o) => !o)}
              aria-expanded={showAllChecks}
            >
              <span>{t("optimize.check.allChecks", { count: readiness.checks.length })}</span>
              <span>{showAllChecks ? "▾" : "▸"}</span>
            </button>
            {/* P5.5 (owner critique 2026-07-02): the expanded receipt is proper rows — status mark ·
                check name · its one-line measured result — in the UI voice, not the mono terminal
                list (that visual belongs to the live scan moment only). */}
            {showAllChecks && (
              <ul className="check-all-list">
                {readiness.checks.map((c) => {
                  // An advisory is noted, not graded: never the ✓ of a check that came back right,
                  // and it says so ahead of its reading, which the row may cut short (desk review
                  // 2026-11-03, third pass; FirstCheck's advisory rows read the same).
                  const kind = c.status === "advisory" ? "advisory" : rowVerdict(c.status);
                  const reading = c.detail.trim() || c.value;
                  const result =
                    kind === "advisory"
                      ? reading
                        ? `${t("optimize.check.resultAdvisory")} · ${reading}`
                        : t("optimize.check.resultAdvisory")
                      : reading ||
                        (kind === "ok"
                          ? t("optimize.check.resultOk")
                          : kind === "fix"
                            ? t("optimize.check.resultFix")
                            : t("optimize.check.resultUnknown"));
                  return (
                    <li key={c.id} className={`check-all-row check-all-${kind}`}>
                      <span className="check-all-mark" aria-hidden="true">
                        {kind === "fix" ? "→" : kind === "ok" ? "✓" : "·"}
                      </span>
                      <span className="check-all-name">{c.label}</span>
                      <span className="check-all-result">{result}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )
      )}

      {/* The ranked result — appears after the rows have streamed. */}
      {phase === "verdict" && (
        <div className="check-result">
          {/* Hardware-change advisory (A5): names exactly what changed since last setup + offers a
              re-check and an inline "this is my rig now" that re-baselines (so it never nags). Its
              "See what changed" opens the Care view, which shows what else changed (P6-timeline). */}
          {hwChange?.changed && hwChange.changes.length > 0 && (
            <div className="check-drift check-hwchange" role="status">
              <div className="check-drift-head">
                <span className="check-drift-label">{t("optimize.check.hwChangedLabel")}</span>
              </div>
              <p className="check-drift-detail">
                {[...hwSummary.visible, ...(hwSummary.overflowLabel ? [hwSummary.overflowLabel] : [])].join(
                  " · ",
                )}{" "}
                {t("optimize.check.hwChangeSuffix")}
              </p>
              <div className="check-drift-actions">
                {onOpenCare && (
                  <button className="btn btn-small" onClick={onOpenCare}>
                    {t("optimize.check.seeWhatElseChanged")}
                  </button>
                )}
                <button className="btn btn-small" disabled={running} onClick={() => rerun()}>
                  {t("optimize.check.recheckMySetup")}
                </button>
                <button className="btn btn-small" disabled={ackingHw} onClick={acknowledgeHwChange}>
                  {ackingHw ? t("optimize.check.saving") : t("optimize.check.thisIsMyRigNow")}
                </button>
              </div>
            </div>
          )}
          {/* Drift watch — a check that was good and has since regressed. One card for all of them:
              each name and its detail, and the way to the Care view's "Since it last worked" list,
              which shows every open drift with when Compy noticed it (P6-timeline). Never a WHO: drift can't tell a Windows Update revert from the
              user's own in-app rollback, so "outside Compy" would be a false claim. The
              "applied-changes" drift is EXCLUDED: the limiter card below serves it (named + inline
              "turn it back on"). */}
          {checkDrifts.length > 0 && (
            <div className="check-drift" role="status">
              <div className="check-drift-head">
                <span className="check-drift-label">
                  {t("optimize.check.driftPointerLabel", { count: checkDrifts.length })}
                </span>
              </div>
              {checkDrifts.map((d) => (
                <p key={d.id} className="check-drift-detail">
                  {d.unreadable_now
                    ? t("optimize.check.driftUnreadable", { label: d.label })
                    : d.detail
                      ? t("optimize.check.driftItem", { label: d.label, detail: d.detail })
                      : d.label}
                </p>
              ))}
              <p className="check-drift-detail">{t("optimize.check.driftPointer")}</p>
              {onOpenCare && (
                <div className="check-drift-actions">
                  <button className="btn btn-small" onClick={onOpenCare}>
                    {t("optimize.check.seeWhatChanged")}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Advisory tuning nudge — bathroom law: only when the GPU's been running warm. */}
          {hot && tuningGuide && (
            <div className="check-nudge">
              <div className="check-nudge-main">
                <span className="check-nudge-title">{t("optimize.check.gpuRunningWarmTitle")}</span>
                <p className="check-nudge-reason">
                  {t("optimize.check.gpuWarmReason", { peakC: hot.peakC, sessions: hot.sessions })}
                </p>
              </div>
              <button className="check-nudge-link" onClick={() => onOpenLibrary(tuningGuide.id)}>
                {t("optimize.check.coolerQuieterGuide")}
              </button>
            </div>
          )}

          {/* Driver freshness — honest age advisory. The URL is copyable TEXT (doorknob: the copy
              button is the only control); never a launcher, never "out of date", never a version. */}
          {/* Driver freshness (P5.5: ONE grouped card) — a row per device (kind · fact · Copy
              button), one shared "newer may be available" note instead of a paragraph per device.
              Honesty rules unchanged: age is a fact, "newer exists" stays a maybe, links are
              copy-to-clipboard only (never a launcher, never "out of date", never a version). */}
          {/* V2-4b: in the v2 room this is advisory hardware state, not a Compy action — ONE
              quiet row ONLY when something stale was actually measured (its primary home becomes
              the hologram part-tap inspector when that layer lands). Classic renders as always. */}
          {driver && (!v2Ia || driver.tone === "advisory" || staleNics.length > 0) && (
            <div className={`check-driver check-driver-${driver.tone}`}>
              <div className="check-row-head">
                <span className="check-row-title">{t("optimize.check.driverFreshnessTitle")}</span>
                {(driver.tone === "advisory" || staleNics.length > 0) && (
                  <span className="check-advisory">{t("optimize.check.advisoryBadge")}</span>
                )}
              </div>
              <ul className="check-driver-list">
                <li className="check-driver-row">
                  <span className="check-driver-kind">{t("optimize.check.kindGpu")}</span>
                  <span className="check-driver-fact">{driver.message}</span>
                  {driver.tone === "advisory" && driver.url && (
                    <button className="check-driver-copy" onClick={() => copyDriverUrl(driver.url!)}>
                      {copiedUrl === driver.url
                        ? t("optimize.check.copiedCheckmark")
                        : t("optimize.check.copyLink", { label: driver.label })}
                    </button>
                  )}
                </li>
                {/* NIC drivers (win-source v1): one row each — same fact-only voice. Unreadable
                    dates show nothing. */}
                {staleNics.map((n) => {
                  const support = NIC_SUPPORT[n.vendor];
                  return (
                    <li key={n.name} className="check-driver-row">
                      <span className="check-driver-kind">{t("optimize.check.kindNetwork")}</span>
                      <span className="check-driver-fact">
                        {t("optimize.check.nicDriverFact", {
                          vendor: support?.label ?? t("optimize.check.networkFallback"),
                          name: n.name,
                          days: n.driver_age_days,
                        })}
                      </span>
                      {support && (
                        <button
                          className="check-driver-copy"
                          onClick={() => copyDriverUrl(support.url)}
                        >
                          {copiedUrl === support.url
                            ? t("optimize.check.copiedCheckmark")
                            : t("optimize.check.copyLink", { label: support.label })}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {(driver.tone === "advisory" || staleNics.length > 0) && (
                <p className="check-driver-note">{t("optimize.check.newerMayBeAvailable")}</p>
              )}
              {/* The quiet pass line claims "recent" ONLY when every NIC date was readable —
                  a partial read stays silent rather than overclaiming. */}
              {nicDrivers !== null &&
                nicDrivers.length > 0 &&
                staleNics.length === 0 &&
                nicDrivers.every((n) => n.driver_age_days != null) && (
                  <p className="check-row-reason check-leftover-note">
                    {t("optimize.check.networkDriverRecent", { count: nicDrivers.length })}
                  </p>
                )}
            </div>
          )}

          {/* V2-4b: when the only limiters were the suppressed rec-aggregates, the section head
              disappears entirely — a "no limiter stands out / nothing to change" claim would be
              false while the rec rows below still offer changes. */}
          {v2Ia && limiters.length === 0 ? null : (
          <>
          <div className="check-section-label">{t("optimize.check.biggestLimiters")}</div>
          {limiters.length === 0 ? (
            // Deliberately NOT "measured clean" — the scan subtitle above already says it (the
            // same double-saying the P5 taste catch flagged on Home). One phrase, one owner.
            <p className="check-clear">{t("optimize.check.noLimiterStandsOut")}</p>
          ) : (
            <ul className="check-list">
              {limiters.map((lim) => {
                // The "applied-changes" limiter is the vague-flag anti-pattern: name the actual
                // drifted setting(s) and carry the inline fix, not "1 setting(s) — go to another tab".
                if (lim.id === "applied-changes" && reverted.length > 0) {
                  return (
                    <li key={lim.id} className="check-row">
                      <div className="check-row-main">
                        <div className="check-row-head">
                          <span className="check-row-title">
                            {reverted.length === 1
                              ? t("optimize.check.revertedSingleTitle", { title: reverted[0].title })
                              : t("optimize.check.revertedMultiCount", { count: reverted.length })}
                          </span>
                        </div>
                        <p className="check-row-reason">
                          {reverted.length === 1
                            ? t("optimize.check.revertedReasonSingle")
                            : t("optimize.check.revertedReasonMulti", {
                                titles: reverted.map((r) => r.title).join(", "),
                              })}
                        </p>
                        <div className="check-drift-actions">
                          {reverted.map((rev) => (
                            <button
                              key={rev.rec_id}
                              className="btn btn-small"
                              disabled={applyingId !== null}
                              onClick={() => applyReverted(rev)}
                            >
                              {applyingId === rev.rec_id
                                ? t("optimize.check.turningOnEllipsis")
                                : reverted.length === 1
                                  ? t("optimize.check.turnItBackOn")
                                  : t("optimize.check.turnTitleOn", { title: rev.title })}
                            </button>
                          ))}
                        </div>
                        {gameModeDrifted && (
                          <p className="check-drift-note">{t("optimize.check.gameModeDriftedNote")}</p>
                        )}
                      </div>
                    </li>
                  );
                }
                // startup-load: name the auto-start apps + turn them off inline (not "go to a tab").
                if (lim.id === "startup-load") {
                  const enabled = startup.filter((s) => s.enabled);
                  return (
                    <li key={lim.id} className="check-row">
                      <div className="check-row-main">
                        <div className="check-row-head">
                          <span className="check-row-title">{lim.title}</span>
                          <span className="check-conf">
                            <ConfidenceWord band={lim.confidence} />
                          </span>
                        </div>
                        <p className="check-row-reason">{t("optimize.check.startupLimiterReason")}</p>
                        {enabled.length > 0 && (
                          <ul className="check-startup-list">
                            {enabled.map((s) => (
                              <li key={s.name} className="check-startup-row">
                                <span className="check-startup-name" title={s.command}>
                                  {s.name}
                                </span>
                                <button
                                  type="button"
                                  className="btn btn-small"
                                  disabled={togglingStartup !== null}
                                  onClick={() => disableStartup(s)}
                                >
                                  {togglingStartup === s.name
                                    ? t("optimize.check.turningOffEllipsis")
                                    : t("optimize.check.turnOffAtStartup")}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  );
                }
                return (
                  <li key={lim.id} className="check-row">
                    <div className="check-row-main">
                      <div className="check-row-head">
                        <span className="check-row-title">{lim.title}</span>
                        <span className="check-conf">
                          <ConfidenceWord band={lim.confidence} />
                        </span>
                      </div>
                      <p className="check-row-reason">{lim.reason}</p>
                      {/* Advisory checks that need action outside Compy finally show the way
                          (walkthroughs §3) — the readiness check is no longer a dead "verify it yourself". */}
                      {!canApply(lim) && walkthroughForKeyForLanguage(lim.linked ?? lim.id, i18n.language) && (
                        <WalkthroughDisclosure
                          label={t("optimize.check.showMeTheWay")}
                          walkthrough={walkthroughForKeyForLanguage(lim.linked ?? lim.id, i18n.language)!}
                          vendor={vendor}
                        />
                      )}
                    </div>
                    {canApply(lim) ? (
                      <TrustSwitch
                        applied={false}
                        busy={applyingId === (lim.linked ?? lim.id)}
                        onToggle={() => applyLimiter(lim)}
                        ariaLabel={t("optimize.check.applyAriaLabel", { title: lim.title })}
                      />
                    ) : (
                      <span className="check-advisory">{t("optimize.check.advisoryBadge")}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          </>
          )}

          {/* P9-hint-shown: the newest measured session's GPU-load hint ("busy at times" / "sat at
              or above N% for X% of it"), one quiet line under the limiter rows, outside the
              section above so it still shows when no limiter stands out. Hidden when absent.
              The sentence comes whole from priorities.rs (it opens "Recent session hint:"). */}
          {priorities?.session_hint && (
            <p className="check-session-hint">{priorities.session_hint}</p>
          )}

          {/* R3 Lane B: upgrade-path advisory — renders ONLY when a verdict already names hardware
              as the limiter (GPU-limited session / HDD install drive). Links are plain retailer
              searches, COPY-only in-app (no navigation, no opener); the disclosure always rides. */}
          {/* V2-4b: suppressed in the v2 room — demoted content must not LEAD the room, so the
              room (OptimizeStation, via onUpgradePath) renders it labeled early BELOW its action
              groups instead. */}
          {!v2Ia && priorities?.upgrade_path && <UpgradePathBlock upgradePath={priorities.upgrade_path} links />}

          {/* Side-piles (P5 calm chrome): under the merged shell's provider these teleport into the
              single "Nothing else needs attention" expander; classic/standalone render here as
              always. Content, counts, and reasons identical either way — moved, never removed. */}
          {alreadyFine.length > 0 && (
            <SidePileItem order={SIDE_PILE_ORDER.measuredFine}>
            <div className="check-fine">
              <button
                className="check-fine-head"
                onClick={() => setFineOpen((o) => !o)}
                aria-expanded={fineOpen}
              >
                <span>{t("optimize.check.measuredFineCount", { count: alreadyFine.length })}</span>
                <span>{fineOpen ? "▾" : "▸"}</span>
              </button>
              {fineOpen && (
                <ul className="check-fine-list">
                  {alreadyFine.map((i) => (
                    <li key={i.id} className="check-fine-row">
                      <span className="check-fine-mark" aria-hidden="true">✓</span>
                      <span>{i.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            </SidePileItem>
          )}

          {notWorth.length > 0 && (
            <SidePileItem order={SIDE_PILE_ORDER.notWorthTouching}>
            <div className="check-notworth">
              <button
                className="check-section-label check-section-label-muted check-collapse-head"
                onClick={() => setNotWorthOpen((o) => !o)}
                aria-expanded={notWorthOpen}
              >
                <span>{t("optimize.check.notWorthCount", { count: notWorth.length })}</span>
                <span aria-hidden="true">{notWorthOpen ? "▾" : "▸"}</span>
              </button>
              {notWorthOpen && (
              <ul className="check-list">
                {notWorth.map((i) => (
                  <li key={i.id} className="check-row check-row-info">
                    <div className="check-row-main">
                      <div className="check-row-head">
                        <span className="check-row-title">{i.title}</span>
                        {/* Named-place law (§2): link the SPECIFIC refusal to its EXACT Learn entry
                            via the quick-look (resolves only where an entry exists) — no generic
                            "read all of Learn" dump. */}
                        <WhatsThis id={i.linked ?? i.id} onOpen={onOpenLibrary} />
                      </div>
                      <p className="check-row-reason">{i.reason}</p>
                    </div>
                  </li>
                ))}
              </ul>
              )}
            </div>
            </SidePileItem>
          )}

          {/* Exportable setup summary (A5) — a dedicated card that restates the settled scan in
              plain English, ready to copy and share. Read-only: copies measured facts to the
              clipboard, no launch/URL, no mutation. The text stays on screen so it can be selected
              manually if the clipboard is blocked. */}
          {/* V2-4b: a record of what happened, not an action — in the v2 room it lives on the
              Applied segment with the rest of the records (OptimizeV2 renders it there). */}
          {!v2Ia && setupSummary && (
            <div
              className="check-summary"
              style={{
                border: "1px solid var(--accent-line, rgba(46, 230, 192, 0.28))",
                background: "var(--accent-soft, rgba(46, 230, 192, 0.05))",
                borderRadius: "var(--ix-radius)",
                padding: "12px 16px 14px",
                marginTop: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <span className="check-section-label" style={{ margin: 0 }}>
                  {t("optimize.check.setupSummaryTitle")}
                </span>
                <span style={{ display: "inline-flex", gap: 8 }}>
                  {/* Export lives HERE — with the proof — instead of the app header. Same
                      App-owned export + report modal; only the button moved. */}
                  {onExport && (
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={onExport}
                      disabled={exporting}
                    >
                      {exporting ? t("optimize.check.exportingEllipsis") : t("optimize.check.exportFullReport")}
                    </button>
                  )}
                  <button type="button" className="btn btn-small" onClick={copySetupSummary}>
                    {copiedSummary ? t("optimize.check.copiedCheckmark") : t("optimize.check.copySummary")}
                  </button>
                </span>
              </div>
              <p
                className="check-row-reason"
                style={{ margin: "6px 0 10px", color: "var(--ix-text-2)" }}
              >
                {t("optimize.check.setupSummaryBlurb")}
              </p>
              <pre
                aria-label={t("optimize.check.setupSummaryTextAria")}
                style={{
                  margin: 0,
                  padding: "10px 12px",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "inherit",
                  fontSize: "var(--type-label)",
                  lineHeight: 1.5,
                  color: "var(--ix-text-2)",
                  background: "var(--ix-surface-2, rgba(0, 0, 0, 0.18))",
                  borderRadius: "calc(var(--ix-radius) - 4px)",
                }}
              >
                {setupSummary}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Optimization Cleanup (Leftovers v1 engine) — pre-existing optimizer rot, read-only,
          ON-DEMAND. Public name locked by the owner 2026-07-15 ("Optimization Cleanup", never
          "Paramedic Mode"); Phase 0 of the 2026-07-16 optimization-cleanup spec ships the live
          audit under that name as a first-class section — a check the user is meant to RUN can't
          hide in the "Nothing else needs attention" pile. Code identifiers, command names, ids,
          and the persisted leftover_adopted provenance deliberately keep "leftovers" (same
          discipline as the 2026-06-11 "Past Tweaks" era). Museum placard, never a siren: receipts
          (found vs stock default), the matched guide-era tweak, the mechanism cost, and a
          hardware-aware verdict. "Nothing found" is a first-class result; unreadable probes are
          reported as unchecked, never counted clean. Phase 1 (2026-07-16) ARMED the restore path
          backend-side (restore_gate()==true, restore_leftover registered) after owner-present
          live-UAC QA; this surface doesn't call it yet — the restore UI is its own later train. */}
      <div className="check-leftovers">
        <div className="check-section-label">
          {t("optimize.check.optimizationCleanupTitle")} <WhatsThis id="leftovers" onOpen={onOpenLibrary} />
        </div>
        <p className="check-leftovers-blurb">
          {t("optimize.check.leftoversBlurb")}
        </p>
        <button className="check-leftovers-run" disabled={leftoversBusy} onClick={runLeftovers}>
          {leftoversBusy ? t("optimize.check.leftoversCheckingEllipsis") : t("optimize.check.checkThisPcForOldTweaks")}
        </button>
        {leftoversErr && (
          <p className="check-leftovers-clean" role="status">
            {leftoversErr}
          </p>
        )}
        {leftovers && leftovers.findings.length === 0 && (
          <p className="check-leftovers-clean" role="status">
            {leftovers.unavailable.length === 0
              ? t("optimize.check.leftoversAllClean")
              : t("optimize.check.leftoversPartialClean", {
                  count: leftovers.checked,
                  unavailable: leftovers.unavailable.length,
                  itemWord: t(
                    leftovers.unavailable.length === 1
                      ? "optimize.check.pronounIt"
                      : "optimize.check.pronounThem",
                  ),
                })}
          </p>
        )}
        {leftovers && leftovers.findings.length > 0 && (
          <ul className="check-list" aria-label={t("optimize.check.oldTweaksFoundAria")}>
            {leftovers.findings.map((f) => (
              <li key={f.id} className="check-row check-row-info check-leftover-row">
                <div className="check-row-main">
                  <div className="check-row-head">
                    <span className="check-row-title">{t("optimize.check.pastTweakPrefix", { title: f.title })}</span>
                    <WhatsThis id={LEFTOVER_LEARN_ID[f.id] ?? f.id} onOpen={onOpenLibrary} />
                    <span className="check-advisory">{t("optimize.check.advisoryBadge")}</span>
                  </div>
                  <p className="check-row-reason">
                    {t("optimize.check.foundVsDefault", {
                      current: f.current_value,
                      stockDefault: f.stock_default,
                    })}
                  </p>
                  <p className="check-row-reason">
                    {f.mechanism_cost} {f.verdict}
                  </p>
                  <p className="check-row-reason check-leftover-note">
                    {t("optimize.check.matchesPrefix")}
                    {f.matched_tweak}
                    {t("optimize.check.matchesMid")}
                    {f.restore_note}
                    {f.uncertain_source && t("optimize.check.uncertainSourceNote")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {/* Whatever couldn't be read is NAMED with its reason (e.g. bcdedit: needs admin) —
            an unchecked setting is never folded into "nothing found". Framed calmly since
            2026-07-23 (tester Matthew: three bare "Couldn't check…" lines under the verdict read
            as an error dump): one head states what they are, the per-item lines keep the exact
            honest format (guard-pinned), and the admin note explains the design instead of
            sounding broken. */}
        {leftovers && leftovers.unavailable.length > 0 && (
          <div className="check-leftover-unchecked">
            <p className="check-unchecked-head">
              {t("optimize.check.uncheckedHead", { count: leftovers.unavailable.length })}
            </p>
            <ul className="check-unchecked-list">
              {leftovers.unavailable.map((u) => (
                <li key={u.id}>
                  {t("optimize.check.couldntCheckPre")}
                  {u.title}
                  {t("optimize.check.couldntCheckMid")}
                  {u.reason}
                  {t("optimize.check.couldntCheckPost")}
                </li>
              ))}
            </ul>
            {leftovers.unavailable.some((u) => /admin/i.test(u.reason)) && (
              <p className="check-unchecked-note">
                {t("optimize.check.adminRightsNote")}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** CR-upgrade-area-truth (3): an upgrade row's title and why in the app's language, keyed by its
 *  `kind`. The GPU row's why is worded from the numbers it carries; without them (an older backend)
 *  it falls back to the Rust sentence. A kind this build doesn't know keeps the Rust strings. */
export function upgradeRowText(item: UpgradeSuggestion, t: TFunction): { title: string; why: string } {
  if (item.kind === "ssd") {
    return { title: t("optimize.check.upgradeRowSsdTitle"), why: t("optimize.check.upgradeRowSsdWhy") };
  }
  if (item.kind === "gpu") {
    const n = item.gpu_numbers;
    const pct = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 100;
    const sane = n && [n.share_pct, n.peak_pct, n.threshold_pct, n.limit_share_pct].every(pct) ? n : null;
    return {
      title: t("optimize.check.upgradeRowGpuTitle"),
      why: sane
        ? t("optimize.check.upgradeRowGpuWhy", {
            share: sane.share_pct,
            peak: sane.peak_pct,
            threshold: sane.threshold_pct,
            limitShare: sane.limit_share_pct,
          })
        : item.why,
    };
  }
  return { title: item.title, why: item.why };
}

/**
 * R3 Lane B / Phase 9: the upgrade-path advisory, from the scan's `upgrade_path` (a GPU-limited
 * session or an HDD install drive). Each row says what was measured, where from, the screen limit
 * when that session already filled the screen, and what Compy can't check before any part.
 *
 * `links`: the copy-only retailer searches and their disclosure (classic Check). Without them
 * (P9-upgrade-block-reachable: the shipped Optimize room) the block is the measured lines only, under
 * the "early" label V2-4b gave it; whether retail links return there is an owner call.
 */
export function UpgradePathBlock({ upgradePath, links }: { upgradePath: UpgradePath; links: boolean }) {
  const { t, i18n } = useTranslation();
  // Upgrade-path links are copy-only (R3 Lane B): clipboard, per-button feedback, no navigation.
  const [copiedRetail, setCopiedRetail] = useState<string | null>(null);
  // P9-gpu-fit-unknowns: the parts the user added (Test → Add a part), read once, never written here.
  const [manualParts] = useState(readManualParts);
  const copyRetailLink = async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedRetail(key);
      setTimeout(() => setCopiedRetail(null), 1500);
    } catch {
      /* clipboard blocked — the tooltip already names the retailer; nothing else to do */
    }
  };
  // The room's copy shows only what was measured: no rows, no block (classic keeps its shape).
  if (!links && upgradePath.items.length === 0) return null;
  return (
    <div className="check-upgrade" data-testid="check-upgrade" data-links={links ? "on" : "off"}>
      {links ? (
        <div className="check-section-label">{t("optimize.check.upgradePathTitle")}</div>
      ) : (
        <div className="check-section-label">
          {t("optimize.optimizeV2.upgradePathLabel")}{" "}
          <span className="check-upgrade-early" data-testid="check-upgrade-early">
            {t("optimize.optimizeV2.upgradePathEarly")}
          </span>
        </div>
      )}
      {upgradePath.items.map((item) => {
        const screen = screenIsLimit(item);
        return (
          <div key={item.kind} className="check-upgrade-item">
            {/* P9-screen-is-limit: the session averaged at or above the refresh rate it recorded,
                so a faster GPU would not show more frames: the screen is named instead of the
                GPU, with no GPU fit line or shopping links. Unmeasured either side = as before. */}
            {screen ? (
              <>
                <span className="check-upgrade-title">{t("optimize.check.screenLimitTitle")}</span>
                <p className="check-row-reason" data-testid="check-upgrade-screen">
                  {t("optimize.check.screenLimitBody", {
                    hz: screen.hz,
                    fps: screen.fps,
                    game: prettyGameName(screen.game) || screen.game,
                  })}
                </p>
              </>
            ) : (
              <>
                <span className="check-upgrade-title">{upgradeRowText(item, t).title}</span>
                <p className="check-row-reason">{upgradeRowText(item, t).why}</p>
              </>
            )}
            {/* P9-limit-source: which recorded session this was measured from (its game, its
                date in the app's language, the counts behind the share); none recorded, no line. */}
            {item.measured_from && (
              <p className="check-row-reason" data-testid="check-upgrade-source">
                {t("optimize.check.upgradeMeasuredFrom", {
                  game: prettyGameName(item.measured_from.game) || item.measured_from.game,
                  date: sessionDate(item.measured_from.started_at, i18n.language),
                  busy: item.measured_from.busy,
                  readings: item.measured_from.readings,
                  threshold: item.measured_from.threshold_pct,
                })}
                {/* P9-session-on-this-hardware: that session can't be tied to the card in this PC
                    now (it recorded none, or this PC's card wasn't read); a session recorded on
                    another card never reaches here (priorities.rs skips it). */}
                {(() => {
                  const untied = gpuUntied(item.measured_from.gpu_tie);
                  if (!untied) return null;
                  return (
                    <span data-testid="check-upgrade-untied">
                      {sentenceGap(i18n.resolvedLanguage ?? i18n.language)}
                      {untied === "not-recorded"
                        ? t("optimize.check.upgradeUntiedNotRecorded")
                        : t("optimize.check.upgradeUntiedCardUnread")}
                    </span>
                  );
                })()}
              </p>
            )}
            {/* P9-gpu-fit-unknowns: what Compy can't check before any card, in the system's
                terms; a user-added power supply is what they told Compy, never a capacity. */}
            {(() => {
              const fit = screen ? null : upgradeFitLine(item.kind, manualParts);
              if (!fit) return null;
              return (
                <p className="check-row-reason check-upgrade-fit" data-testid="check-upgrade-fit">
                  {fit.key === "optimize.check.upgradeFitGpuUserPsu"
                    ? t("optimize.check.upgradeFitGpuUserPsu", { name: fit.name })
                    : fit.key === "optimize.check.upgradeFitSsd"
                      ? t("optimize.check.upgradeFitSsd")
                      : t("optimize.check.upgradeFitGpuUnknown")}
                </p>
              );
            })()}
            {links && (
              <div className="check-upgrade-links">
                {(screen ? [] : item.links).map((l) => (
                  <button
                    key={l.retailer}
                    className="btn btn-small"
                    title={t("optimize.check.copyRetailLinkTitle", { retailer: l.retailer })}
                    onClick={() => copyRetailLink(`${item.kind}-${l.retailer}`, l.url)}
                  >
                    {copiedRetail === `${item.kind}-${l.retailer}`
                      ? t("optimize.check.copiedExclaim")
                      : t("optimize.check.copyRetailSearchLink", { retailer: l.retailer })}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {/* HONESTY (P5.5 owner catch 2026-07-02): the backend disclosure const still says
          "we may earn a commission" — FALSE while every link is a tag-free plain search
          (the A6 guard in priorities.rs pins exactly that). Until Phase D arms affiliate
          tags, render the truthful line; the backend const stays put as the single Phase-D
          swap point. Swap back to {upgradePath.disclosure} in the SAME commit that arms
          tags — the Check guard test pins this. No links shown = nothing to disclose. */}
      {links && <p className="check-upgrade-disclosure">{t("optimize.check.upgradeDisclosure")}</p>}
    </div>
  );
}

/** P9-no-upgrade-named + P9-cpu-gpu-balance: the shipped Optimize room's upgrade area when the scan
 *  named no hardware limiter. It says "No upgrade recommended" and what that was read from (how many
 *  measured game sessions, none GPU-limited, other cards' left out, and the newest one's GPU counts), or "not measured
 *  yet" when there are none, never an empty block. When that newest session was not GPU-limited and
 *  averaged below the refresh rate it ran at, it says the GPU wasn't counted as the limit there and
 *  that Compy can't measure the CPU's share yet. Nothing when the scan named a part (the check's own
 *  row says it), when there is an upgrade row, or when the backend sent no evidence. No retail links. */
export function NoUpgradeBlock({ priorities }: { priorities: Priorities }) {
  const { t, i18n } = useTranslation();
  const ev = priorities.upgrade_evidence;
  if (!ev || priorities.upgrade_path) return null;
  // Review r1: a GPU-limited session among those counted (an older one, or another game's) is not
  // "no upgrade recommended" for the PC; the per-game summary speaks for it. A missing count = unknown.
  if (!(ev.gpu_limited_sessions === 0)) return null;
  // CR-upgrade-area-truth (1): the aggregate rows (safe tweaks pending, applied changes drifting) are
  // settings, never a part; filtered from the one list settings-done reads (they are also "away").
  const limiters = (priorities.limiters ?? []).filter((l) => !AGGREGATE_REC_ROWS.has(l.id));
  const partNamed = limiters.some((l) => l.status === "attention" && !LIMITER_AWAY.has(l.id));
  if (partNamed) return null;
  // CR-upgrade-area-truth (2): a check it couldn't read means it can't say nothing holds this PC back,
  // as the game summary says "not measured" for the same scan.
  const unread = anyLimiterUnread(priorities);
  const n = ev.newest;
  const finite = (x: number | undefined): x is number => x != null && Number.isFinite(x) && x > 0;
  // The newest session, only when its counts can be a measurement and fall under the limit share
  // (CR-upgrade-area-truth NIT (b): the game summary's own guard, including a sane share).
  const clear = !unread && n && !n.gpu_limited && measuredClearOfGpuLimit(n) ? n : null;
  // NIT (a): how many sessions on another card were left out; absent from an older backend, which
  // keeps the fixed note inside the count sentence.
  const leftOut =
    typeof ev.other_card_sessions === "number" && Number.isFinite(ev.other_card_sessions)
      ? Math.max(0, Math.floor(ev.other_card_sessions))
      : null;
  // P9-cpu-gpu-balance: that session's own average under the refresh rate it ran at; either unmeasured
  // = no line (unknown stays unknown). The raw average is compared, as Check's screen-limit rule does.
  const fps = clear?.avg_fps;
  const hz = clear?.refresh_hz;
  // Review nit: a raw 59.6 under 60 Hz must not read "60 fps ... at 60 Hz"; one decimal then.
  const below =
    clear && finite(fps) && finite(hz) && fps < hz
      ? { fps: Math.round(fps) < hz ? String(Math.round(fps)) : fps.toFixed(1), hz }
      : null;
  const untied = clear ? gpuUntied(clear.gpu_tie) : undefined;
  const gap = sentenceGap(i18n.resolvedLanguage ?? i18n.language);
  return (
    <div className="check-upgrade" data-testid="check-no-upgrade" data-links="off">
      <div className="check-section-label">
        {t("optimize.optimizeV2.upgradePathLabel")}{" "}
        <span className="check-upgrade-early">{t("optimize.optimizeV2.upgradePathEarly")}</span>
      </div>
      <div className="check-upgrade-item">
        <span className="check-upgrade-title" data-testid="check-no-upgrade-title">
          {unread
            ? t("optimize.check.noUpgradeUnreadTitle")
            : ev.measured_sessions > 0
              ? t("optimize.check.noUpgradeTitle")
              : t("optimize.check.noUpgradeNothingMeasuredTitle")}
        </span>
        <p className="check-row-reason" data-testid="check-no-upgrade-source">
          {unread
            ? t("optimize.check.noUpgradeLimiterUnread")
            : ev.measured_sessions > 0
              ? leftOut === null
                ? t("optimize.check.noUpgradeReadFrom", { count: ev.measured_sessions })
                : t("optimize.check.noUpgradeReadFromCounted", { count: ev.measured_sessions })
              : t("optimize.check.noUpgradeNotMeasured")}
          {!unread && leftOut !== null && leftOut > 0 && (
            <span data-testid="check-no-upgrade-left-out">
              {gap}
              {t("optimize.check.noUpgradeLeftOut", { count: leftOut })}
            </span>
          )}
          {clear && (
            <>
              {gap}
              {t("optimize.check.noUpgradeNewest", {
                game: prettyGameName(clear.game) || clear.game,
                date: sessionDate(clear.started_at, i18n.language),
                busy: clear.busy,
                readings: clear.readings,
                threshold: clear.threshold_pct,
                limitShare: clear.limit_share_pct,
              })}
            </>
          )}
          {untied && (
            <span data-testid="check-no-upgrade-untied">
              {gap}
              {untied === "not-recorded"
                ? t("optimize.check.upgradeUntiedNotRecorded")
                : t("optimize.check.upgradeUntiedCardUnread")}
            </span>
          )}
        </p>
        {below && (
          <p className="check-row-reason" data-testid="check-no-upgrade-balance">
            {t("optimize.check.noUpgradeCpuUnknown", { fps: below.fps, hz: below.hz })}
          </p>
        )}
      </div>
    </div>
  );
}
