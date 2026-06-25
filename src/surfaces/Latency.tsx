import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, StatusPill, SectionHeader } from "../design";
import {
  msiStatus,
  usbStatus,
  controllerSeverity,
  fmtMs,
  timerRangeLabel,
  pollingJitterStatus,
  pollingJitterLabel,
  pollingRateClass,
} from "./latency-view";
import type { LatencyReport, WakeMeasurement, MouseMeasurement } from "../types";
import "./Latency.css";

const MOUSE_CAPTURE_MS = 2000;

// Read-only latency diagnostics. Every value here is measured/read from the live
// machine — nothing on this tab changes a setting. Time-windowed measurements
// (wake granularity, mouse polling) run on demand so the snapshot loads instantly.
export function LatencyTab() {
  const [report, setReport] = useState<LatencyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [wake, setWake] = useState<WakeMeasurement | null>(null);
  const [wakeBusy, setWakeBusy] = useState(false);
  const [mouse, setMouse] = useState<MouseMeasurement | null>(null);
  const [mouseBusy, setMouseBusy] = useState(false);
  const [mouseMsg, setMouseMsg] = useState<string | null>(null);

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
    setMouseMsg("Move your mouse for ~2 seconds…");
    try {
      const m = await invoke<MouseMeasurement | null>("latency_measure_mouse", {
        durationMs: MOUSE_CAPTURE_MS,
      });
      setMouse(m);
      setMouseMsg(m ? null : "No mouse reports captured — try again and keep the mouse moving.");
    } catch {
      setMouseMsg("Measurement failed.");
    } finally {
      setMouseBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="lat-wrap">
        <p className="lat-muted">Reading diagnostics…</p>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="lat-wrap">
        <p className="lat-muted">Diagnostics unavailable on this machine.</p>
      </div>
    );
  }

  const { msi, msi_active, cpu, usb } = report;
  const rateClass = mouse ? pollingRateClass(mouse.polling.median_hz) : null;

  return (
    <div className="lat-wrap">
      <header className="lat-head">
        <h2>Latency &amp; responsiveness</h2>
        <p className="lat-muted">
          Read-only diagnostics — Compy reports what your machine actually does. Nothing here
          changes a setting.
        </p>
      </header>

      <Card>
        <SectionHeader
          title="Interrupt mode (MSI)"
          right={<StatusPill status={msiStatus(msi_active)} />}
        />
        <p className="lat-stat">
          {msi_active.active_on} of {msi.total} capable devices confirmed on MSI
          {msi_active.advertised_but_inactive > 0 &&
            ` · ${msi_active.advertised_but_inactive} advertise it but run on a line IRQ`}
          {msi_active.unknown > 0 && ` · ${msi_active.unknown} undetermined`}
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
                    ? "advertises MSI · verified running on a line IRQ"
                    : "no MSI support advertised · on a line IRQ"}
                </span>
                {d.latency_sensitive && (
                  <span className="lat-shared lat-shared-warn">latency-sensitive</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionHeader title="Timer resolution & wake granularity" />
        {report.timer_current_ms != null && (
          <p className="lat-stat">
            Current timer resolution: <strong>{fmtMs(report.timer_current_ms)}</strong>
          </p>
        )}
        {report.timer && <p className="lat-muted">{timerRangeLabel(report.timer)}</p>}
        {wake ? (
          <>
            <p className="lat-stat">
              Measured wake: median <strong>{fmtMs(wake.granularity.median_ms)}</strong> (min{" "}
              {fmtMs(wake.granularity.min_ms)}, max {fmtMs(wake.granularity.max_ms)}, jitter{" "}
              {fmtMs(wake.granularity.jitter_ms)})
            </p>
            <p className="lat-advisory">{wake.note}</p>
          </>
        ) : (
          <button className="lat-btn" onClick={measureWake} disabled={wakeBusy}>
            {wakeBusy ? "Measuring…" : "Measure wake granularity"}
          </button>
        )}
      </Card>

      {cpu && (
        <Card>
          <SectionHeader title="CPU topology & interrupt affinity" />
          <p className="lat-stat">
            {cpu.physical_cores} cores / {cpu.logical_processors} threads · {cpu.l3_complexes} L3
            complex{cpu.l3_complexes === 1 ? "" : "es"}
          </p>
          {report.cpu_affinity_advisory && (
            <p className="lat-advisory">{report.cpu_affinity_advisory}</p>
          )}
        </Card>
      )}

      <Card>
        <SectionHeader
          title="USB input topology"
          right={usb.length > 0 ? <StatusPill status={usbStatus(usb)} /> : undefined}
        />
        {usb.length === 0 ? (
          <p className="lat-muted">No USB input controllers detected.</p>
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
                    <span className="lat-shared lat-shared-warn">jitter risk</span>
                  )}
                  {sev === "info" && <span className="lat-shared lat-shared-info">shared</span>}
                </li>
              );
            })}
          </ul>
        )}
        {report.usb_advisory && <p className="lat-advisory">{report.usb_advisory}</p>}
        {report.peripheral_link_advisory && (
          <p className="lat-advisory">{report.peripheral_link_advisory}</p>
        )}
      </Card>

      <Card>
        <SectionHeader
          title="Mouse polling rate"
          right={
            mouse ? (
              <StatusPill
                status={pollingJitterStatus(mouse.polling.jitter_ms)}
                label={`jitter ${pollingJitterLabel(mouse.polling.jitter_ms)}`}
              />
            ) : undefined
          }
        />
        {mouse ? (
          <>
            <p className="lat-stat">
              Median <strong>{Math.round(mouse.polling.median_hz)} Hz</strong> over{" "}
              {mouse.polling.reports} reports (jitter {fmtMs(mouse.polling.jitter_ms)})
            </p>
            {rateClass && <p className="lat-muted">{rateClass}</p>}
            <p className="lat-muted">
              Report gaps ranged {fmtMs(mouse.polling.min_interval_ms)} (fastest) to{" "}
              {fmtMs(mouse.polling.max_interval_ms)} (slowest)
            </p>
            <p className="lat-advisory">{mouse.note}</p>
            <button className="lat-btn lat-btn-ghost" onClick={measureMouse} disabled={mouseBusy}>
              {mouseBusy ? "Measuring…" : "Measure again"}
            </button>
          </>
        ) : (
          <>
            <button className="lat-btn" onClick={measureMouse} disabled={mouseBusy}>
              {mouseBusy ? "Measuring…" : "Measure mouse polling"}
            </button>
            {mouseMsg && <p className="lat-muted">{mouseMsg}</p>}
          </>
        )}
      </Card>
    </div>
  );
}
