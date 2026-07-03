import { useState, type ReactNode } from "react";
import { Term } from "../design/Term";
import type { HardwareInfo } from "../App";
import type { SessionSummary } from "../types";
import { gradeFps, gradeLow1, gradeColor, type Grade } from "../data/metric-grade";
import { gradeGpuTempForVendor } from "../data/gpu-sensor";
import { gpuVendor } from "./walkthroughs";
import { liveStrip, type PostureLine } from "./command-center-data";
import { RigViewer } from "./rig/RigViewer";
import { HardwareGrid } from "./HardwareGrid";
import { SetupLauncherCard } from "./setup/SetupLauncherCard";
import "./HardwareSection.css";
import "./HomeV3.css";

// HomeV3 — the answer-first Home (P3 UI slim-down, plan §5.3) — the Home.
// One question per room: "Is my PC ready, and what's the one thing to do?" Top to bottom: the posture
// VERDICT (the only element that pops — squint test), the #1 limiter as the single hero action
// (passed in from CommandCenter so the audited apply/rollback flow stays identical), 3 glanceable
// last-session tiles, then the 3D rig hologram — the retained centerpiece (owner correction §6:
// minimalism ≠ sterile) with the full hardware cards one tap away. All numbers real or honestly
// empty; zero new IPC — everything renders off the same props CommandCenter already receives.

function Tile({
  label,
  value,
  note,
  grade,
}: {
  label: ReactNode;
  value: string;
  note?: string;
  grade?: Grade;
}) {
  const color = grade ? gradeColor(grade) : "";
  return (
    <section className="cc-panel hv3-tile">
      <span className="cc-panel-eyebrow">{label}</span>
      <span className="hv3-tile-value" style={color ? { color } : undefined}>
        {value}
      </span>
      {note && <span className="hv3-tile-note">{note}</span>}
    </section>
  );
}

export function HomeV3({
  hw,
  sessions,
  posture,
  limiterSlot,
  onNavigate,
}: {
  hw: HardwareInfo;
  sessions: SessionSummary[];
  posture: PostureLine;
  /** The #1 limiter card, built by CommandCenter — same audited apply flow, no forked logic. */
  limiterSlot: ReactNode;
  /** Jump to a room — the last-session tiles are a door into Monitor's full debrief. */
  onNavigate?: (tab: "Play") => void;
}) {
  // Rig view: 3D hologram is the DEFAULT centerpiece; same persisted choice as the dashV2 Home so a
  // cards-preferring user keeps their pick across the flag flip.
  const [rig3d, setRig3d] = useState(() => {
    try {
      return localStorage.getItem("compy_home_rig_3d") !== "0";
    } catch {
      return true;
    }
  });
  const chooseRig3d = (v: boolean) => {
    setRig3d(v);
    try {
      localStorage.setItem("compy_home_rig_3d", v ? "1" : "0");
    } catch {
      /* localStorage unavailable — session-only choice */
    }
  };

  const strip = liveStrip(sessions);
  // Hardware-tailored grading: FPS judged against THIS rig's refresh; GPU temp vendor-gated so
  // NVIDIA stays deliberately ungraded (LOCKED rule #5 — sensor confidence unchanged).
  const rig = { refreshHz: hw.display?.current_refresh_rate_hz ?? null };
  const vendor = gpuVendor(hw.gpus?.[0]?.name);

  return (
    <div className="hv3-root">
      {/* THE answer — posture verdict. The one element that should survive the squint test. */}
      <section className={`cc-panel hv3-verdict hv3-verdict-${posture.tone}`}>
        <div className="cc-panel-eyebrow">System posture</div>
        <h2 className="hv3-headline">{posture.headline}</h2>
        <p className="hv3-sentence">{posture.sentence}</p>
        {posture.reassurance && <p className="hv3-reassure">{posture.reassurance}</p>}
      </section>

      {/* The ONE primary action — the #1 limiter (audited apply flow, built upstream). */}
      {limiterSlot}

      {/* 3 glanceable tiles — the live strip trimmed to three (plan §4.3). Real last-session
          numbers or an honest empty state; the header is a door into the full debrief. */}
      <div className="hv3-tiles-head">
        <span className="cc-panel-eyebrow hv3-tiles-label">
          Last session{strip.kind === "data" ? ` · ${strip.game}` : ""}
        </span>
        {strip.kind === "data" && onNavigate && (
          <button type="button" className="hv3-debrief-link" onClick={() => onNavigate("Play")}>
            Full debrief →
          </button>
        )}
      </div>
      {strip.kind === "data" ? (
        <div className="hv3-tiles">
          <Tile
            label={<Term id="hz-vs-fps">Avg FPS</Term>}
            value={strip.avgFps.toFixed(0)}
            grade={gradeFps(strip.avgFps, rig)}
          />
          <Tile
            label={<Term id="one-percent-lows">1% low</Term>}
            value={strip.low1Est.toFixed(0)}
            note="estimate"
            grade={gradeLow1(strip.low1Est, strip.avgFps)}
          />
          <Tile
            label="Peak GPU"
            value={strip.peakTempC == null ? "—" : `${strip.peakTempC.toFixed(0)}°C`}
            grade={gradeGpuTempForVendor(vendor, strip.peakTempC)}
          />
        </div>
      ) : (
        <section className="cc-panel hv3-tiles-empty">
          Play a session to see this — Compy captures it from outside the game.
        </section>
      )}

      {/* The retained centerpiece — 3D rig hologram by default; the full hardware cards ("hardware
          grid on tap", plan §4.3) are the Cards toggle. Same persisted preference as before. */}
      <div className="hv3-rig-head">
        <span className="cc-panel-eyebrow hv3-tiles-label">This rig</span>
        <div className="hw-view-toggle" role="tablist" aria-label="Rig view">
          <button
            type="button"
            role="tab"
            aria-selected={!rig3d}
            className={`hw-view-btn ${!rig3d ? "hw-view-on" : ""}`}
            onClick={() => chooseRig3d(false)}
          >
            Cards
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={rig3d}
            className={`hw-view-btn ${rig3d ? "hw-view-on" : ""}`}
            onClick={() => chooseRig3d(true)}
          >
            3D
          </button>
        </div>
      </div>
      {rig3d ? <RigViewer hw={hw} /> : <HardwareGrid hw={hw} />}

      {/* The guided Setup & Tour front door stays — quiet, below the answer, never competing with it. */}
      <SetupLauncherCard />
    </div>
  );
}
