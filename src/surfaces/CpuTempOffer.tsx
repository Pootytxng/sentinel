import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import "../i18n";
import "./CpuTempOffer.css";

// THE CPU-TEMP OFFER (Q9c).
//
// Compy reads CPU temperature driver-free, from a sensor app the user runs (cpu_temp.rs). When
// nothing is publishing, this row used to render one sentence — "run HWiNFO or LibreHardwareMonitor"
// — and stop. That is a dead end: it names the problem and hands back no way to fix it, which the
// name-it-AND-fix-it-inline law exists to forbid.
//
// So the backend now reports what it can honestly observe about each supported app (installed,
// running, publishing), and this component turns that into ONE next step:
//   - it's running but not publishing  → name the exact switch (HWiNFO's Shared Memory Support)
//   - you already have it, it's closed → start it, from here
//   - you don't have one               → the two downloads, with what each costs you
// Every sentence lives in i18n, so both locales describe the same observed state.

const HWINFO_URL = "https://www.hwinfo.com/download/";
const LHM_URL = "https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases";

/** Catalog ids, mirrored from `SENSOR_APPS` in cpu_temp.rs (pinned there by a Rust test). */
export type SensorAppId = "hwinfo" | "lhm";

export type SensorAppStatus = {
  id: SensorAppId;
  running: boolean;
  publishing: boolean;
  launchable: boolean;
  installed: boolean;
};

export type SensorSourceReport = {
  apps: SensorAppStatus[];
  /** 0 ⇒ the process scan did not run, so `running: false` means unknown, not "no". */
  scanned: number;
};

export type Offer =
  /** Something IS publishing, just not a CPU temperature Compy can read. */
  | { kind: "publishingWithoutCpuTemp"; app: SensorAppId }
  /** HWiNFO is up with Shared Memory Support switched off — the single most common cause. */
  | { kind: "sharedMemoryOff" }
  /** LHM/OHM is up but its sensor namespace is answering with nothing. */
  | { kind: "notPublishing"; app: SensorAppId }
  /** Installed and closed — one click away. */
  | { kind: "start"; app: SensorAppId }
  /** Nothing usable found (or the scan couldn't run) — offer the downloads. */
  | { kind: "install" };

/**
 * Pure: the ONE next step this report earns. Order matters — the most specific, most fixable state
 * wins, so a user whose HWiNFO is already running is never told to go install HWiNFO.
 */
export function offerFor(report: SensorSourceReport | null): Offer {
  const app = (id: SensorAppId) => report?.apps.find((a) => a.id === id);
  const hwinfo = app("hwinfo");
  const lhm = app("lhm");

  const publishing = report?.apps.find((a) => a.publishing);
  // The caller only mounts this when there is no CPU temperature. If something is publishing anyway,
  // it has sensors Compy can read but no CPU temperature among them — say that, don't send the user
  // to install what they already run.
  if (publishing) return { kind: "publishingWithoutCpuTemp", app: publishing.id };

  if (hwinfo?.running) return { kind: "sharedMemoryOff" };
  if (lhm?.running) return { kind: "notPublishing", app: lhm.id };
  if (hwinfo?.launchable) return { kind: "start", app: "hwinfo" };
  if (lhm?.launchable) return { kind: "start", app: "lhm" };
  return { kind: "install" };
}

/** Re-checks after a launch: the app needs a moment to come up and publish. Bounded on purpose — a
 *  standing poll would make the panel cost more than it is worth (least-resource-hungry bar). */
const RECHECK_DELAYS_MS = [2500, 5000, 9000];

export function CpuTempOffer() {
  const { t } = useTranslation();
  const [report, setReport] = useState<SensorSourceReport | null>(null);
  const [starting, setStarting] = useState<SensorAppId | null>(null);
  const [failed, setFailed] = useState<SensorAppId | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const load = useCallback(() => {
    invoke<SensorSourceReport>("get_sensor_sources")
      .then(setReport)
      .catch(() => {
        /* Backend unreachable — the offer stays on its honest default (the downloads). */
      });
  }, []);

  useEffect(() => {
    load();
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.length = 0;
    };
  }, [load]);

  const appName = (id: SensorAppId) => t(`monitor.monitorPanels.cpuTempOffer.appName.${id}`);

  const start = (id: SensorAppId) => {
    setFailed(null);
    setStarting(id);
    invoke("launch_sensor_app", { app: id })
      .then(() => {
        // The shell accepted it; whether the app is actually up is something we re-read, never assume.
        RECHECK_DELAYS_MS.forEach((ms) => {
          timers.current.push(setTimeout(load, ms));
        });
      })
      .catch(() => {
        setStarting(null);
        setFailed(id);
      });
  };

  const offer = offerFor(report);

  return (
    <div className="cpu-temp-offer">
      <div className="cpu-temp-offer-title">{t("monitor.monitorPanels.cpuTempOffer.title")}</div>
      <p className="cpu-temp-offer-why">{t("monitor.monitorPanels.cpuTempOffer.why")}</p>

      {offer.kind === "publishingWithoutCpuTemp" && (
        <p className="cpu-temp-offer-state">
          {t("monitor.monitorPanels.cpuTempOffer.publishingWithoutCpuTemp", {
            app: appName(offer.app),
          })}
        </p>
      )}

      {offer.kind === "sharedMemoryOff" && (
        <>
          <p className="cpu-temp-offer-state">
            {t("monitor.monitorPanels.cpuTempOffer.sharedMemoryOff")}
          </p>
          <p className="cpu-temp-offer-how">
            {t("monitor.monitorPanels.cpuTempOffer.sharedMemoryHow")}
          </p>
        </>
      )}

      {offer.kind === "notPublishing" && (
        <p className="cpu-temp-offer-state">
          {t("monitor.monitorPanels.cpuTempOffer.notPublishing", { app: appName(offer.app) })}
        </p>
      )}

      {offer.kind === "start" && (
        <>
          <p className="cpu-temp-offer-state">
            {t("monitor.monitorPanels.cpuTempOffer.installedNotRunning", {
              app: appName(offer.app),
            })}
          </p>
          <div className="cpu-temp-offer-actions">
            <button
              type="button"
              className="btn-small btn-small-on"
              disabled={starting === offer.app}
              onClick={() => start(offer.app)}
            >
              {starting === offer.app
                ? t("monitor.monitorPanels.cpuTempOffer.startingButton", {
                    app: appName(offer.app),
                  })
                : t("monitor.monitorPanels.cpuTempOffer.startButton", { app: appName(offer.app) })}
            </button>
            {offer.app === "hwinfo" && (
              <span className="cpu-temp-offer-note">
                {t("monitor.monitorPanels.cpuTempOffer.startHwinfoNote")}
              </span>
            )}
          </div>
        </>
      )}

      {offer.kind === "install" && (
        <>
          <p className="cpu-temp-offer-state">
            {t("monitor.monitorPanels.cpuTempOffer.installTitle")}
          </p>
          <div className="cpu-temp-offer-actions">
            <button
              type="button"
              className="btn-small btn-small-on"
              onClick={() => {
                openUrl(HWINFO_URL).catch(() => {
                  /* opener blocked — the note still names the tool */
                });
              }}
            >
              {t("monitor.monitorPanels.cpuTempOffer.appName.hwinfo")}
            </button>
            <span className="cpu-temp-offer-note">
              {t("monitor.monitorPanels.cpuTempOffer.hwinfoNote")}
            </span>
          </div>
          <div className="cpu-temp-offer-actions">
            <button
              type="button"
              className="btn-small"
              onClick={() => {
                openUrl(LHM_URL).catch(() => {
                  /* opener blocked — the note still names the tool */
                });
              }}
            >
              {t("monitor.monitorPanels.cpuTempOffer.appName.lhm")}
            </button>
            <span className="cpu-temp-offer-note">
              {t("monitor.monitorPanels.cpuTempOffer.lhmNote")}
            </span>
          </div>
        </>
      )}

      {starting && (
        <p className="cpu-temp-offer-note cpu-temp-offer-progress">
          {t("monitor.monitorPanels.cpuTempOffer.starting", { app: appName(starting) })}
        </p>
      )}
      {failed && (
        <p className="cpu-temp-offer-note cpu-temp-offer-failed">
          {t("monitor.monitorPanels.cpuTempOffer.startFailed", { app: appName(failed) })}
        </p>
      )}

      <button type="button" className="btn-small cpu-temp-offer-recheck" onClick={load}>
        {t("monitor.monitorPanels.cpuTempOffer.recheck")}
      </button>
    </div>
  );
}
