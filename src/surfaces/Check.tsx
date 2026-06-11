import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PriorityItem, SessionSummary } from "../types";
import { TrustSwitch } from "../design/TrustSwitch";
import { WhatsThis } from "../design/WhatsThis";
import { useConfirm } from "../design/ConfirmDialog";
import { Walkthrough } from "../design/Walkthrough";
import { walkthroughForKey, gpuVendor, type GpuVendor } from "./walkthroughs";
import { tuningGuideForVendor } from "../data/tuning-guides";
import { gpuRunningHot } from "../data/tuning-measure";
import { useScan } from "./use-scan";
import { ScanStream } from "./ScanStream";
import "./Check.css";

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
type LeftoversReport = { findings: Leftover[]; checked: number; unavailable: string[] };

// Finding id → the Learn entry that explains its family (WhatsThis renders only where one exists).
const LEFTOVER_LEARN_ID: Record<string, string> = {
  "pagefile-fixed": "pagefile-disable",
};

// Stable vendor support roots for the COPYABLE url (spec 2026-06-10-driver-freshness-check).
// Never a launch button — opening external https would need an owner-gated allowlist change.
const VENDOR_SUPPORT: Partial<Record<GpuVendor, { label: string; url: string }>> = {
  amd: { label: "AMD", url: "https://www.amd.com/en/support" },
  nvidia: { label: "NVIDIA", url: "https://www.nvidia.com/Download/index.aspx" },
  intel: { label: "Intel", url: "https://www.intel.com/content/www/us/en/download-center/home.html" },
};

// Pure threshold logic. Age is a FACT we read locally; "newer exists" stays a MAYBE — we cannot
// know the latest driver without the network (remote fetch is gated off), so never "out of date",
// never a version claim. Unreadable date → neutral skip, no alarm. Vendor comes from the GPU's own
// name (not the app-level vendor prop) so the advisory names the right driver on mixed rigs.
function driverFreshness(gpus: GpuDriverInfo[]):
  | { tone: "skip" | "pass"; message: string; url?: undefined }
  | { tone: "advisory"; message: string; url: string | null } {
  const gpu = gpus.find((g) => g.driver_age_days != null);
  if (!gpu) return { tone: "skip", message: "Driver date unreadable — skip" };
  const age = gpu.driver_age_days as number;
  if (age <= 90) return { tone: "pass", message: `Driver is recent — ${age} days old.` };
  const v = VENDOR_SUPPORT[gpuVendor(gpu.name)];
  return {
    tone: "advisory",
    message: `Your ${v?.label ?? "GPU"} driver is ${age} days old. Newer ones may be available — worth checking your vendor's page.`,
    url: v?.url ?? null,
  };
}

// CHECK — the consolidation surface that absorbs Readiness + Priorities (spec 2026-06-06-check-play-lab).
// Top: the shared scan (radar + streaming rows from useScan — same core as the first-run arc). Below:
// Priorities' buckets as the permanent ranked result, with drift-watch cards when a regression-
// outside-Compy is detected. Self-contained via useScan + its own apply (existing command); onChanged
// lets App re-sync its other surfaces. Zero new IPC.

function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (!then) return "recently";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return mins <= 1 ? "just now" : `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export default function Check({
  isAppliable,
  onOpenLibrary,
  onChanged,
  vendor,
  sessions = [],
  gpus = [],
}: {
  isAppliable: (recId: string) => boolean;
  onOpenLibrary: (focusId?: string) => void;
  onChanged: () => void;
  vendor: GpuVendor;
  sessions?: SessionSummary[];
  gpus?: GpuDriverInfo[];
}) {
  const { readiness, priorities, recs, running, elapsed, shownRows, phase, rerun } = useScan();
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [fineOpen, setFineOpen] = useState(false);
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
      title: `Apply "${r.title}"?`,
      body: "Compy snapshots the prior state so you can roll this back anytime.",
      confirmLabel: "Apply",
    });
    if (!ok) return;
    setApplyingId(r.id);
    try {
      await invoke("apply_recommendation", { recId: r.id, recTitle: r.title });
      await rerun();
      onChanged(); // keep App's other surfaces in sync
    } catch {
      /* surfaced on next scan */
    } finally {
      setApplyingId(null);
    }
  };

  const checks = readiness?.checks ?? [];
  const limiters = priorities?.limiters ?? [];
  const alreadyFine = priorities?.already_fine ?? [];
  const notWorth = priorities?.not_worth_touching ?? [];
  const drifts = readiness?.drifts ?? [];
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  // Advisory tuning nudge (spec 2026-06-08) — appears ONLY when recent sessions ran sustained-warm
  // (bathroom law: signposted at the moment of need, never a standing "try undervolting!" banner).
  // AMD-only in v1 (the guide is AMD). It's a named-place link to the Learn guide (deliberate travel),
  // not a one-click fix (doorknob) — Compy never tunes the voltage for you.
  const tuningGuide = tuningGuideForVendor(vendor);
  const hot = tuningGuide ? gpuRunningHot(sessions) : null;

  // Leftovers v1 — strictly ON-DEMAND (charter: no scan on launch, no background scanning).
  // Read-only: checking changes nothing; v1 wires no restore.
  const [leftovers, setLeftovers] = useState<LeftoversReport | null>(null);
  const [leftoversBusy, setLeftoversBusy] = useState(false);
  const runLeftovers = async () => {
    setLeftoversBusy(true);
    try {
      setLeftovers(await invoke<LeftoversReport>("get_leftovers"));
    } catch {
      /* surfaced as the still-empty section; the button stays available to retry */
    } finally {
      setLeftoversBusy(false);
    }
  };

  // Driver freshness (read-only advisory) — only rendered when the caller wires hardware in,
  // so surfaces/tests that don't pass gpus see nothing rather than a spurious "unreadable".
  const driver = gpus.length > 0 ? driverFreshness(gpus) : null;
  const [copiedUrl, setCopiedUrl] = useState(false);
  const copyDriverUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1500);
    } catch {
      /* clipboard blocked — the URL text stays visible to select manually */
    }
  };

  return (
    <section className="check-root">
      <header className="check-head">
        <div>
          <h2 className="check-title">Check</h2>
          <p className="check-sub">
            {running
              ? "Scanning your rig…"
              : `${checks.length} checks · ${elapsed?.toFixed(1) ?? "—"}s · ${limiters.length} worth fixing`}
          </p>
        </div>
        <button className="check-rerun" disabled={running} onClick={() => rerun()}>
          {running ? "Scanning…" : "Re-run check"}
        </button>
      </header>

      <ScanStream readiness={readiness} shownRows={shownRows} running={running} phase={phase} />

      {/* The ranked result — appears after the rows have streamed. */}
      {phase === "verdict" && (
        <div className="check-result">
          {/* Drift watch — a check that was good and has since regressed outside Compy. */}
          {drifts.map((d) => (
            <div key={d.id} className="check-drift">
              <div className="check-drift-head">
                <span className="check-drift-label">{d.label}</span>
                <span className="check-drift-when">changed outside Compy · noticed {ago(d.noticed_at)}</span>
              </div>
              <p className="check-drift-detail">{d.detail}</p>
            </div>
          ))}

          {/* Advisory tuning nudge — bathroom law: only when the GPU's been running warm. */}
          {hot && tuningGuide && (
            <div className="check-nudge">
              <div className="check-nudge-main">
                <span className="check-nudge-title">Your GPU's been running warm</span>
                <p className="check-nudge-reason">
                  Peaked at {hot.peakC}°C across your last {hot.sessions} sessions — an undervolt
                  usually drops that for free, cooler and quieter, with frames held.
                </p>
              </div>
              <button className="check-nudge-link" onClick={() => onOpenLibrary(tuningGuide.id)}>
                Cooler &amp; quieter — undervolt guide →
              </button>
            </div>
          )}

          {/* Driver freshness — honest age advisory. The URL is copyable TEXT (doorknob: the copy
              button is the only control); never a launcher, never "out of date", never a version. */}
          {driver && (
            <div className={`check-driver check-driver-${driver.tone}`}>
              <div className="check-row-head">
                <span className="check-row-title">Driver freshness</span>
                {driver.tone === "advisory" && <span className="check-advisory">advisory</span>}
              </div>
              <p className="check-row-reason">{driver.message}</p>
              {driver.tone === "advisory" && driver.url && (
                <div className="check-driver-url">
                  <code className="check-driver-url-text">{driver.url}</code>
                  <button className="check-driver-copy" onClick={() => copyDriverUrl(driver.url!)}>
                    {copiedUrl ? "Copied ✓" : "Copy link"}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="check-section-label">Biggest limiters</div>
          {limiters.length === 0 ? (
            <p className="check-clear">
              Nothing worth fixing today — this rig is already where it should be.
            </p>
          ) : (
            <ul className="check-list">
              {limiters.map((lim) => (
                <li key={lim.id} className="check-row">
                  <div className="check-row-main">
                    <div className="check-row-head">
                      <span className="check-row-title">{lim.title}</span>
                      <span className="check-conf">{cap(lim.confidence)} confidence</span>
                    </div>
                    <p className="check-row-reason">{lim.reason}</p>
                    {/* Advisory checks that need action outside Compy finally show the way
                        (walkthroughs §3) — the readiness check is no longer a dead "verify it yourself". */}
                    {!canApply(lim) && walkthroughForKey(lim.linked ?? lim.id) && (
                      <details className="fix-walkthrough">
                        <summary>Show me the way</summary>
                        <Walkthrough
                          walkthrough={walkthroughForKey(lim.linked ?? lim.id)!}
                          vendor={vendor}
                        />
                      </details>
                    )}
                  </div>
                  {canApply(lim) ? (
                    <TrustSwitch
                      applied={false}
                      busy={applyingId === (lim.linked ?? lim.id)}
                      onToggle={() => applyLimiter(lim)}
                      ariaLabel={`Apply ${lim.title}`}
                    />
                  ) : (
                    <span className="check-advisory">advisory</span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {alreadyFine.length > 0 && (
            <div className="check-fine">
              <button className="check-fine-head" onClick={() => setFineOpen((o) => !o)}>
                <span>{alreadyFine.length} already fine — nothing to sell you here</span>
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
          )}

          {notWorth.length > 0 && (
            <div className="check-notworth">
              <div className="check-section-label check-section-label-muted">Not worth touching</div>
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
            </div>
          )}
        </div>
      )}

      {/* Leftovers v1 — pre-existing optimizer rot, read-only, ON-DEMAND. Museum placard, never a
          siren: receipts (found vs stock default), the matched guide-era tweak, the mechanism cost,
          and a hardware-aware verdict. "Nothing found" is a first-class result; unreadable probes
          are reported as unchecked, never counted clean. No restore action exists in v1. */}
      <div className="check-leftovers">
        <div className="check-section-label check-section-label-muted">Leftovers</div>
        <p className="check-leftovers-blurb">
          Tweaks an old guide may have left on this PC before Compy existed. Read-only — checking
          changes nothing.
        </p>
        <button className="check-leftovers-run" disabled={leftoversBusy} onClick={runLeftovers}>
          {leftoversBusy ? "Checking…" : "Check for leftover tweaks"}
        </button>
        {leftovers && leftovers.findings.length === 0 && (
          <p className="check-leftovers-clean" role="status">
            {leftovers.unavailable.length === 0
              ? "No leftover tweaks found — your Windows config matches stock where it matters."
              : `No leftovers in the ${leftovers.checked} setting${
                  leftovers.checked === 1 ? "" : "s"
                } we could read — ${leftovers.unavailable.length} couldn't be read, so nothing is claimed about ${
                  leftovers.unavailable.length === 1 ? "it" : "them"
                }.`}
          </p>
        )}
        {leftovers && leftovers.findings.length > 0 && (
          <>
            <ul className="check-list">
              {leftovers.findings.map((f) => (
                <li key={f.id} className="check-row check-row-info check-leftover-row">
                  <div className="check-row-main">
                    <div className="check-row-head">
                      <span className="check-row-title">{f.title}</span>
                      <WhatsThis id={LEFTOVER_LEARN_ID[f.id] ?? f.id} onOpen={onOpenLibrary} />
                      <span className="check-advisory">advisory</span>
                    </div>
                    <p className="check-row-reason">
                      Found: {f.current_value} · Windows default: {f.stock_default}
                    </p>
                    <p className="check-row-reason">
                      {f.mechanism_cost} {f.verdict}
                    </p>
                    <p className="check-row-reason check-leftover-note">
                      Matches: {f.matched_tweak}. {f.restore_note}
                      {f.uncertain_source &&
                        " If you set this on purpose, it's yours to keep — Compy can't tell who set it."}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            {leftovers.unavailable.length > 0 && (
              <p className="check-leftover-note">
                {leftovers.unavailable.length} more setting
                {leftovers.unavailable.length === 1 ? "" : "s"} couldn't be read — nothing is
                claimed about {leftovers.unavailable.length === 1 ? "it" : "them"}.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
