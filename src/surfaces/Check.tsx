import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PriorityItem, SessionSummary, StartupEntry } from "../types";
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
  const { readiness, priorities, recs, reverted, running, elapsed, shownRows, phase, rerun } = useScan();
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

  // Turn a specific drifted-off change back on, right here — names the setting + carries its fix,
  // instead of "1 setting(s) — go to Optimize/Ledger". Re-applies via the snapshotted apply path.
  const applyReverted = async (rev: { rec_id: string; title: string }) => {
    const ok = await confirm({
      title: `Turn "${rev.title}" back on?`,
      body: "Compy snapshots the prior state so you can roll this back anytime.",
      confirmLabel: "Turn it on",
    });
    if (!ok) return;
    setApplyingId(rev.rec_id);
    try {
      await invoke("apply_recommendation", { recId: rev.rec_id, recTitle: rev.title });
      await rerun();
      onChanged();
    } catch {
      /* surfaced on next scan */
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
      await invoke("set_startup_entry_enabled", { name: entry.name, enabled: false });
      setStartup(await invoke<StartupEntry[]>("get_startup_entries"));
      onChanged();
    } catch {
      /* surfaced on next scan */
    } finally {
      setTogglingStartup(null);
    }
  };

  // Upgrade-path links are copy-only (R3 Lane B): clipboard, per-button feedback, no navigation.
  const [copiedRetail, setCopiedRetail] = useState<string | null>(null);
  const copyRetailLink = async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedRetail(key);
      setTimeout(() => setCopiedRetail(null), 1500);
    } catch {
      /* clipboard blocked — the tooltip already names the retailer; nothing else to do */
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

  const livingPreview =
    typeof document !== "undefined" && document.documentElement.dataset.living === "on";

  return (
    <section className="check-root">
      <header className="check-head">
        <div>
          <h2 className="check-title">Check</h2>
          <p className="check-sub">
            {running
              ? "Scanning your rig…"
              : livingPreview
                ? limiters.length === 0
                  ? "Measured clean — every check came back right on this rig."
                  : `${limiters.length} ${limiters.length === 1 ? "thing" : "things"} worth a look — the rest came back clean.`
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
                    {copiedUrl === driver.url ? "Copied ✓" : "Copy link"}
                  </button>
                </div>
              )}
              {/* NIC drivers (win-source v1): same honesty rules — age is a fact, "newer exists"
                  is a maybe, the link is copyable text only. Unreadable dates show nothing. */}
              {staleNics.map((n) => {
                const support = NIC_SUPPORT[n.vendor];
                return (
                  <div key={n.name} className="check-driver-nic">
                    <p className="check-row-reason">
                      Your {support?.label ?? "network"} driver ({n.name}) is {n.driver_age_days} days
                      old. Newer ones may be available — worth checking your vendor's page.
                    </p>
                    {support && (
                      <div className="check-driver-url">
                        <code className="check-driver-url-text">{support.url}</code>
                        <button className="check-driver-copy" onClick={() => copyDriverUrl(support.url)}>
                          {copiedUrl === support.url ? "Copied ✓" : "Copy link"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {/* The quiet pass line claims "recent" ONLY when every NIC date was readable —
                  a partial read stays silent rather than overclaiming. */}
              {nicDrivers !== null &&
                nicDrivers.length > 0 &&
                staleNics.length === 0 &&
                nicDrivers.every((n) => n.driver_age_days != null) && (
                  <p className="check-row-reason check-leftover-note">
                    Network driver{nicDrivers.length === 1 ? " is" : "s are"} recent too — nothing
                    worth chasing.
                  </p>
                )}
            </div>
          )}

          <div className="check-section-label">Biggest limiters</div>
          {limiters.length === 0 ? (
            <p className="check-clear">
              Measured clean — every check came back right on this rig. Nothing to change today.
            </p>
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
                              ? `“${reverted[0].title}” turned itself back off`
                              : `${reverted.length} settings you applied turned back off`}
                          </span>
                        </div>
                        <p className="check-row-reason">
                          {reverted.length === 1
                            ? "You turned this on with Compy, but something outside Compy switched it back. Turn it back on right here — or leave it, your call."
                            : `You turned these on with Compy, but they're off now: ${reverted
                                .map((r) => r.title)
                                .join(", ")}. Turn them back on right here.`}
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
                                ? "Turning on…"
                                : reverted.length === 1
                                  ? "Turn it back on"
                                  : `Turn “${rev.title}” on`}
                            </button>
                          ))}
                        </div>
                        {gameModeDrifted && (
                          <p className="check-drift-note">
                            Heads-up: Game Mode keeps switching off because your recording software
                            (AMD Adrenalin) resets it at every restart — turning it on works, but it
                            won't stick.
                          </p>
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
                          <span className="check-conf">{cap(lim.confidence)} confidence</span>
                        </div>
                        <p className="check-row-reason">
                          These launch with Windows and use memory + CPU before you open a game. Turn
                          off any you don't need at startup right here — it won't uninstall them, just
                          stops the auto-start (reversible anytime in Tune).
                        </p>
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
                                  {togglingStartup === s.name ? "Turning off…" : "Turn off at startup"}
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
                );
              })}
            </ul>
          )}

          {/* R3 Lane B: upgrade-path advisory — renders ONLY when a verdict already names hardware
              as the limiter (GPU-limited session / HDD install drive). Links are plain retailer
              searches, COPY-only in-app (no navigation, no opener); the disclosure always rides. */}
          {priorities?.upgrade_path && (
            <div className="check-upgrade">
              <div className="check-section-label">Upgrade path (advisory)</div>
              {priorities.upgrade_path.items.map((item) => (
                <div key={item.kind} className="check-upgrade-item">
                  <span className="check-upgrade-title">{item.title}</span>
                  <p className="check-row-reason">{item.why}</p>
                  <div className="check-upgrade-links">
                    {item.links.map((l) => (
                      <button
                        key={l.retailer}
                        className="btn btn-small"
                        title={`Copies a plain ${l.retailer} search link to open in your browser. No affiliate tag today.`}
                        onClick={() => copyRetailLink(`${item.kind}-${l.retailer}`, l.url)}
                      >
                        {copiedRetail === `${item.kind}-${l.retailer}`
                          ? "Copied!"
                          : `Copy ${l.retailer} search link`}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="check-upgrade-disclosure">{priorities.upgrade_path.disclosure}</p>
            </div>
          )}

          {alreadyFine.length > 0 && (
            <div className="check-fine">
              <button
                className="check-fine-head"
                onClick={() => setFineOpen((o) => !o)}
                aria-expanded={fineOpen}
              >
                <span>{alreadyFine.length} measured fine — confirmed right on this rig</span>
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
        {/* Display name "Past Tweaks" (owner pick 2026-06-11) — code identifiers, command names,
            ids, and the persisted leftover_adopted provenance deliberately keep "leftovers". */}
        <div className="check-section-label check-section-label-muted">
          Past Tweaks <WhatsThis id="leftovers" onOpen={onOpenLibrary} />
        </div>
        <p className="check-leftovers-blurb">
          Tweaks an old guide may have left on this PC before Compy existed. Read-only — checking
          changes nothing.
        </p>
        <button className="check-leftovers-run" disabled={leftoversBusy} onClick={runLeftovers}>
          {leftoversBusy ? "Checking…" : "Check for past tweaks"}
        </button>
        {leftovers && leftovers.findings.length === 0 && (
          <p className="check-leftovers-clean" role="status">
            {leftovers.unavailable.length === 0
              ? "No past tweaks found — your Windows config matches stock where it matters."
              : `No past tweaks in the ${leftovers.checked} setting${
                  leftovers.checked === 1 ? "" : "s"
                } we could read — ${leftovers.unavailable.length} couldn't be read, so nothing is claimed about ${
                  leftovers.unavailable.length === 1 ? "it" : "them"
                }.`}
          </p>
        )}
        {leftovers && leftovers.findings.length > 0 && (
          <ul className="check-list" aria-label="Past tweaks found on this PC">
            {leftovers.findings.map((f) => (
              <li key={f.id} className="check-row check-row-info check-leftover-row">
                <div className="check-row-main">
                  <div className="check-row-head">
                    <span className="check-row-title">Past tweak · {f.title}</span>
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
        )}
        {/* Whatever couldn't be read is NAMED with its reason (e.g. bcdedit: needs admin) —
            an unchecked setting is never folded into "nothing found". */}
        {leftovers && leftovers.unavailable.length > 0 && (
          <ul className="check-leftover-unchecked">
            {leftovers.unavailable.map((u) => (
              <li key={u.id}>
                Couldn't check {u.title} — {u.reason}.
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
