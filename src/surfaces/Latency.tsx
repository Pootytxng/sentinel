import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import "../i18n";
import { Card, StatusPill, SectionHeader } from "../design";
import { Term } from "../design/Term";
import {
  msiStatus,
  usbStatus,
  controllerSeverity,
  fmtMs,
  timerRangeLabel,
  pollingJitterStatus,
  pollingJitterLabel,
  pollingRateClass,
  networkPillTone,
  type NetworkPill,
} from "./latency-view";
import type { LatencyReport, WakeMeasurement, MouseMeasurement } from "../types";
import "./Latency.css";

const MOUSE_CAPTURE_MS = 2000;

// Read-only latency diagnostics. Every value here is measured/read from the live
// machine — nothing on this tab changes a setting. Time-windowed measurements
// (wake granularity, mouse polling) run on demand so the snapshot loads instantly.
export function LatencyTab() {
  const { t } = useTranslation();
  const [report, setReport] = useState<LatencyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [wake, setWake] = useState<WakeMeasurement | null>(null);
  const [wakeBusy, setWakeBusy] = useState(false);
  const [mouse, setMouse] = useState<MouseMeasurement | null>(null);
  const [mouseBusy, setMouseBusy] = useState(false);
  const [mouseMsg, setMouseMsg] = useState<string | null>(null);
  const [netPills, setNetPills] = useState<NetworkPill[]>([]);

  useEffect(() => {
    let cancelled = false;
    invoke<LatencyReport>("get_latency_diagnostics")
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Network-readiness chips read the authoritative backend signal (`hw.network_pills`, derived
    // read-only + zero-outbound in hardware.rs). The Latency surface has no `hw` in scope, so it reads
    // it directly — a narrow shape, the Benchmark `RigSpecs` precedent. Failure leaves the card hidden.
    invoke<{ network_pills?: NetworkPill[] } | null>("get_hardware_info")
      .then((hw) => {
        if (!cancelled && hw?.network_pills) setNetPills(hw.network_pills);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const measureWake = async () => {
    setWakeBusy(true);
    try {
      setWake(await invoke<WakeMeasurement | null>("latency_measure_wake"));
    } catch {
      /* leave prior result; the button stays available */
    } finally {
      setWakeBusy(false);
    }
  };

  const measureMouse = async () => {
    setMouseBusy(true);
    setMouseMsg(t("monitor.latency.moveMouseHint"));
    try {
      const m = await invoke<MouseMeasurement | null>("latency_measure_mouse", {
        durationMs: MOUSE_CAPTURE_MS,
      });
      setMouse(m);
      setMouseMsg(m ? null : t("monitor.latency.noMouseReports"));
    } catch {
      setMouseMsg(t("monitor.latency.measurementFailed"));
    } finally {
      setMouseBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="lat-wrap">
        <p className="lat-muted">{t("monitor.latency.readingDiagnostics")}</p>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="lat-wrap">
        <p className="lat-muted">{t("monitor.latency.diagnosticsUnavailable")}</p>
      </div>
    );
  }

  const { msi, msi_active, cpu, usb } = report;
  const rateClass = mouse ? pollingRateClass(mouse.polling.median_hz, t) : null;

  return (
    <div className="lat-wrap">
      <header className="lat-head">
        <h2>{t("monitor.latency.title")}</h2>
        <p className="lat-muted">{t("monitor.latency.subtitle")}</p>
      </header>

      <Card>
        <SectionHeader
          title={
            <>
              {t("monitor.latency.interruptModePre")}
              <Term id="interrupts">{t("monitor.latency.interruptModeEmph")}</Term>
              {t("monitor.latency.interruptModePost")}
            </>
          }
          right={<StatusPill status={msiStatus(msi_active)} />}
        />
        <p className="lat-stat">
          {t("monitor.latency.msiConfirmed", { on: msi_active.active_on, total: msi.total })}
          {msi_active.advertised_but_inactive > 0 &&
            t("monitor.latency.msiAdvertisedInactive", {
              count: msi_active.advertised_but_inactive,
            })}
          {msi_active.unknown > 0 &&
            t("monitor.latency.msiUnknown", { count: msi_active.unknown })}
        </p>
        {report.msi_advisory && <p className="lat-advisory">{report.msi_advisory}</p>}
        {/* Name the guilty device: every VERIFIED line-IRQ device, worst-first — receipts the
            user can act on per device, not just a count. Unknown states are never listed. */}
        {report.line_irq_receipts.length > 0 && (
          <ul className="lat-list">
            {report.line_irq_receipts.map((d) => (
              <li key={d.name}>
                <span className="lat-ctrl">{d.name}</span>
                <span className="lat-devs">
                  {d.advertises_msi
                    ? t("monitor.latency.msiAdvertisesVerified")
                    : t("monitor.latency.msiNotAdvertised")}
                </span>
                {d.latency_sensitive && (
                  <span className="lat-shared lat-shared-warn">
                    {t("monitor.latency.latencySensitive")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionHeader title={t("monitor.latency.timerSectionTitle")} />
        {report.timer_current_ms != null && (
          <p className="lat-stat">
            {t("monitor.latency.currentTimerResolutionPre")}
            <strong>{fmtMs(report.timer_current_ms)}</strong>
          </p>
        )}
        {report.timer && <p className="lat-muted">{timerRangeLabel(report.timer, t)}</p>}
        {wake ? (
          <>
            <p className="lat-stat">
              {t("monitor.latency.wakeMeasuredPre")}
              <strong>{fmtMs(wake.granularity.median_ms)}</strong>
              {t("monitor.latency.wakeMeasuredPost", {
                min: fmtMs(wake.granularity.min_ms),
                max: fmtMs(wake.granularity.max_ms),
                jitter: fmtMs(wake.granularity.jitter_ms),
              })}
            </p>
            <p className="lat-advisory">{wake.note}</p>
          </>
        ) : (
          <button className="lat-btn" onClick={measureWake} disabled={wakeBusy}>
            {wakeBusy ? t("monitor.latency.measuring") : t("monitor.latency.measureWakeGranularity")}
          </button>
        )}
      </Card>

      {cpu && (
        <Card>
          <SectionHeader title={t("monitor.latency.cpuTopologyTitle")} />
          <p className="lat-stat">
            {t("monitor.latency.cpuTopology", {
              count: cpu.l3_complexes,
              physical: cpu.physical_cores,
              logical: cpu.logical_processors,
            })}
          </p>
          {/* The device-named suggestion is the DEEPENED version of the general advisory (it includes
              everything the general line says + the named devices + the manual/never-writes caveats),
              so show it INSTEAD of the general line when present — never both (avoids saying it twice). */}
          {(report.affinity_suggestion || report.cpu_affinity_advisory) && (
            <p className="lat-advisory">
              {report.affinity_suggestion || report.cpu_affinity_advisory}
            </p>
          )}
        </Card>
      )}

      <Card>
        <SectionHeader
          title={t("monitor.latency.usbTopologyTitle")}
          right={usb.length > 0 ? <StatusPill status={usbStatus(usb)} /> : undefined}
        />
        {usb.length === 0 ? (
          <p className="lat-muted">{t("monitor.latency.noUsbControllers")}</p>
        ) : (
          <ul className="lat-list">
            {usb.map((c) => {
              const sev = controllerSeverity(c);
              const devs = [...c.input_devices, ...c.streaming_neighbors].join(", ");
              return (
                <li key={c.controller_id}>
                  <span className="lat-ctrl">{c.controller_name}</span>
                  <span className="lat-devs">{devs}</span>
                  {sev === "attention" && (
                    <span className="lat-shared lat-shared-warn">
                      {t("monitor.latency.jitterRisk")}
                    </span>
                  )}
                  {sev === "info" && (
                    <span className="lat-shared lat-shared-info">{t("monitor.latency.shared")}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {report.usb_top_spec && (
          <p className="lat-muted">
            {t("monitor.latency.usbTopSpecPre")}
            <strong>{report.usb_top_spec}</strong>
            {t("monitor.latency.usbTopSpecPost")}
          </p>
        )}
        {report.usb_advisory && <p className="lat-advisory">{report.usb_advisory}</p>}
        {report.peripheral_link_advisory && (
          <p className="lat-advisory">{report.peripheral_link_advisory}</p>
        )}
        {report.usb_tier_advisory && (
          <p className="lat-advisory">{report.usb_tier_advisory}</p>
        )}
      </Card>

      <Card>
        <SectionHeader
          title={
            <>
              {t("monitor.latency.mousePollingPre")}
              <Term id="polling-rate">{t("monitor.latency.mousePollingEmph")}</Term>
            </>
          }
          right={
            mouse ? (
              <StatusPill
                status={pollingJitterStatus(mouse.polling.jitter_ms)}
                label={`${t("monitor.latency.jitterLabelPre")}${pollingJitterLabel(mouse.polling.jitter_ms, t)}`}
              />
            ) : undefined
          }
        />
        {mouse ? (
          <>
            <p className="lat-stat">
              {t("monitor.latency.medianPollingPre")}
              <strong>{Math.round(mouse.polling.median_hz)} Hz</strong>
              {t("monitor.latency.medianPollingPost", {
                reports: mouse.polling.reports,
                jitter: fmtMs(mouse.polling.jitter_ms),
              })}
            </p>
            {rateClass && <p className="lat-muted">{rateClass}</p>}
            <p className="lat-muted">
              {t("monitor.latency.reportGaps", {
                min: fmtMs(mouse.polling.min_interval_ms),
                max: fmtMs(mouse.polling.max_interval_ms),
              })}
            </p>
            <p className="lat-advisory">{mouse.note}</p>
            <button className="lat-btn lat-btn-ghost" onClick={measureMouse} disabled={mouseBusy}>
              {mouseBusy ? t("monitor.latency.measuring") : t("monitor.latency.measureAgain")}
            </button>
          </>
        ) : (
          <button className="lat-btn" onClick={measureMouse} disabled={mouseBusy}>
            {mouseBusy ? t("monitor.latency.measuring") : t("monitor.latency.measureMousePolling")}
          </button>
        )}
        {/* Capture status renders in BOTH states (not just the no-result branch): a returning user
            who clicks "Measure again" needs the same "move your mouse for ~2 seconds" coaching the
            first-timer gets, and a failed re-measure must surface "Measurement failed." rather than
            swallow it silently. Cleared to null on a successful capture, so it never lingers. */}
        {mouseMsg && <p className="lat-muted">{mouseMsg}</p>}
      </Card>

      {/* Network connection — the online-latency axis (ping/lag), distinct from the local
          responsiveness above. Chips render the backend's read-only readiness signal as-is, colored
          by an honest tone (never a score). Only shown when the signal was actually read. */}
      {netPills.length > 0 && (
        <Card>
          <SectionHeader title={t("monitor.latency.networkConnectionTitle")} />
          <ul className="lat-pills">
            {netPills.map((p, i) => (
              <li key={`${p.label}-${i}`} className={`lat-pill lat-pill-${networkPillTone(p.tone)}`}>
                {p.label}
              </li>
            ))}
          </ul>
          <p className="lat-muted">{t("monitor.latency.networkExplainer")}</p>
        </Card>
      )}
    </div>
  );
}
