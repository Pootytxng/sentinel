import { useEffect, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import Play from "./Play";
import { MonitorBasic } from "./MonitorBasic";
import { TuningPresets } from "./TuningPresets";
import { RoomShell } from "../design/room-shell";
import { SegmentedControl } from "../design/SegmentedControl";
import { useReducedMotion } from "../design/use-motion";
import { useDocumentVisible } from "../data/use-document-visible";
import { useHudFlag, useMonitorConsoleFlag } from "../design/use-hud";
import { MonitorConsole } from "./MonitorConsole";
import { HudMasthead } from "./hud-masthead";
import { readViewMode, applyViewMode, type ViewMode } from "../design/theme";
import { monitorVerdict } from "./monitor-v2-data";
import DecryptedText from "../design/vendor/DecryptedText/DecryptedText";
import "../i18n";
import "./monitor-v2.css";

// MonitorV2 (V2-5, spec 2026-07-02-v2-shell-sourcing-and-plan) — the Monitor room on the V2
// shell: verdict (last-session answer, honest empty state) → the room's working faces → quiet
// Tuning-presets expander → forward door (RoomShell, from DOOR_MAP: play → learn, "See what
// changed"). No measured-line header strip (owner header-slop law 2026-07-10) — the session
// count is the visible Sessions list itself.
//
// This is the classic Monitor shell's EXACT composition on RoomShell — Play, MonitorBasic and
// TuningPresets render verbatim with the same props and the same audited read-only sensor +
// capture commands (zero new IPC, nothing mutated). The verdict/measured lines are pure
// derivations from the same real session data (monitor-v2-data.ts). Basic/Advanced and
// Live/Sessions semantics are identical to the classic shell (Basic default, Live first);
// the classic surfaces re-skin via the token re-point in monitor-v2.css — the same mechanism
// the five instrument themes (and OptimizeV2) use.
//
// Deliberately NO primaryAction: the room's real actions (capture toggle, overlay) live with
// their tiles/cards, and hoisting one would duplicate live state the tiles already own — the
// one-mention law outranks filling the optional slot.
//
// V2-8 (P6 §2 placement): the forward door is ABSENT during a live capture session — it belongs
// to the session-end state, not mid-game. The faces already poll get_fps_status for their own
// tiles; they mirror that state up via the additive onFpsActive callback (no second IPC).
//
// Phase 3 (plan 2026-07-10-console-hud-phase3-monitor): behind compy_monitor_console (DEFAULT
// ON), the LIVE face swaps for the console instrument cluster (MonitorConsole) — Basic core
// set, Advanced full cluster. The Sessions face, TuningPresets, and the onFpsActive door
// mirror are UNCHANGED; flag off renders exactly this file's classic branches (test-pinned).

type Segment = "sessions" | "live";

// Same props App passes to <Play> / <Monitor>, minus `view`/`onFpsActive`/`v2` (this shell drives them).
type Props = Omit<ComponentProps<typeof Play>, "view" | "onFpsActive" | "v2">;

export function MonitorV2(props: Props) {
  const { t } = useTranslation();
  // Live first + default — same owner ruling (2026-06-26) the classic Monitor pins. Built inside
  // the component (not module scope) so the labels re-resolve on a language change.
  const SEGMENTS: { id: Segment; label: string }[] = [
    { id: "live", label: t("monitor.monitorV2.segments.live") },
    { id: "sessions", label: t("monitor.monitorV2.segments.sessions") },
  ];
  const MODES: { id: ViewMode; label: string }[] = [
    { id: "basic", label: t("monitor.monitorV2.modes.basic") },
    { id: "advanced", label: t("monitor.monitorV2.modes.advanced") },
  ];
  const reduced = useReducedMotion();
  const hud = useHudFlag();
  const monitorConsole = useMonitorConsoleFlag();
  const [segment, setSegment] = useState<Segment>("live");
  const [mode, setMode] = useState<ViewMode>(readViewMode);
  const basic = mode === "basic";
  const visible = useDocumentVisible();
  const [presetsOpen, setPresetsOpen] = useState(false);
  // Live capture state, mirrored up from whichever face is polling it (Play live / Basic tiles).
  // While a session is being captured the forward door closes (P6 §2 — the door belongs to the
  // session-end state). Conservative on purpose: the last reported value stands until a face
  // polls again, so the door never opens mid-capture just because the user changed segment.
  const [capturing, setCapturing] = useState(false);
  const chooseMode = (m: ViewMode) => {
    setMode(m);
    applyViewMode(m); // persists + mirrors onto <html data-view-mode>, same as classic
  };
  // (The classic shell's one-shot sensor pre-warm was removed 2026-07-16: every face this shell
  // mounts — MonitorConsole / Basic tiles / Play live — fires the same get_cpu_sensors +
  // get_gpu_sensors on ITS mount, so the pre-warm had become a duplicate IPC round-trip on
  // every nav-in. Nav-mount follow-up, BACKLOG cycle 2026-07-15d.)

  // Self-correcting capture poll — the shell's FALLBACK ownership of get_fps_status. Q7 §398 is a
  // runtime-ownership rule ("one owner supplies each sensor stream"), so the guard has to name the
  // one composition where no face is polling, not just the one segment: advanced + Sessions. In
  // basic mode a face (MonitorConsole basic / MonitorBasic) is mounted at EVERY segment value and
  // already polls get_fps_status at 1 Hz, mirroring up through onFpsActive — the shell adding a 2s
  // poll there is a second owner of the same stream, reachable on all-default flags (onOpenSessions
  // leaves segment at "sessions", then switching back to Basic remounts a face). Advanced + Live
  // has an owner too (MonitorConsole advanced, or Play's live view). That leaves advanced+Sessions:
  // Play stands its poll down on that view, so without this the `capturing` flag strands at true
  // and the forward door never reopens when the session actually ends.
  //
  // `visible` is Q7 §397 (idle cost): `capturing` feeds nothing but the door (doorOpen={!capturing})
  // and the masthead LED — both invisible while the window is hidden, which is exactly when a
  // capture is running behind a fullscreen game. Standing down costs nothing because tick() fires
  // immediately when the effect re-runs, so the door is correct by the time it can be seen again.
  //
  // This re-reads REAL backend state only — it never opens the door speculatively (honours the
  // conservative "door never opens mid-capture just because the user changed segment" contract):
  // once s.active reads false, capturing flips false, this effect re-runs and its guard stops it.
  useEffect(() => {
    if (!capturing || basic || segment === "live" || !visible) return;
    let live = true;
    const tick = () =>
      invoke<{ active: boolean }>("get_fps_status")
        .then((s) => {
          if (live) setCapturing(s.active);
        })
        .catch(() => {});
    const id = window.setInterval(tick, 2000);
    tick();
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [capturing, basic, segment, visible]);

  const verdict = monitorVerdict(props.sessions, t);

  return (
    <RoomShell
      room="play"
      doorOpen={!capturing}
      verdict={(() => {
        if (!hud) {
          // Flag off: the exact pre-rollout tree — the verdict sentence as the h1, with the
          // verdict-only DecryptedText moment (the adopt-list law).
          return reduced ? (
            verdict.headline
          ) : (
            <DecryptedText
              key={verdict.headline}
              text={verdict.headline}
              animateOn="view"
              sequential
              speed={22}
              useOriginalCharsOnly
            />
          );
        }
        // HUD header = title only (owner title-header law 2026-07-10 round 2). The last-session
        // answer lives in its context — Play's last-session hero + the session rows grade with
        // the SAME shortVerdict (one source, can't disagree). LED breathes ONLY while a capture
        // is actually recording (the room's one live state); otherwise no LED, never fabricated.
        return (
          <>
            <HudMasthead label={t("monitor.monitorV2.liveTelemetryLabel")} led={capturing ? "scan" : null} />
            {/* Room label — owned by the rail (common.json), not re-translated here (rule: reuse
                common.rail.<id> for any rendered rail/room label). */}
            <span className="hud-headline">{t("common.rail.play", "Monitor")}</span>
          </>
        );
      })()}
      sub={hud ? undefined : verdict.sub}
      quiet={
        !basic ? (
          <>
            {/* The advisory preset checklists are "more, not attention-needing" — the quiet
                slot's contract. The head names what's inside; TuningPresets renders verbatim
                (bare = its standalone title only, which this head replaces). */}
            <button
              type="button"
              className="v2-quiet"
              onClick={() => setPresetsOpen((o) => !o)}
              aria-expanded={presetsOpen}
              aria-controls="mv2-presets-body"
            >
              <span aria-hidden="true" className="v2-quiet-caret">
                ▸
              </span>
              {t("monitor.monitorV2.tuningPresetsLabel")}
              <span className="mv2-quiet-hint">
                {t("monitor.monitorV2.tuningPresetsHint")}
              </span>
            </button>
            <div id="mv2-presets-body" className="mv2-presets-body" hidden={!presetsOpen}>
              <TuningPresets vendor={props.vendor} bare />
            </div>
          </>
        ) : undefined
      }
    >
      <div className="mv2-bar">
        {/* Basic collapses Live/Sessions into the one glanceable face — segments only in
            Advanced, exactly the classic shell's rule. */}
        {!basic && (
          <SegmentedControl
            segments={SEGMENTS}
            value={segment}
            onChange={(id) => setSegment(id as Segment)}
            aria-label={t("monitor.monitorV2.monitorSectionsAria")}
          />
        )}
        <SegmentedControl
          segments={MODES}
          value={mode}
          onChange={(id) => chooseMode(id as ViewMode)}
          aria-label={t("monitor.monitorV2.detailLevelAria")}
        />
      </div>
      <div className="mv2-body">
        {basic ? (
          monitorConsole ? (
            <MonitorConsole
              active={props.active}
              vendor={props.vendor ?? "any"}
              mode="basic"
              sessions={props.sessions}
              onFpsActive={setCapturing}
              onOpenSessions={() => {
                chooseMode("advanced");
                setSegment("sessions");
              }}
            />
          ) : (
            <MonitorBasic
              active={props.active}
              vendor={props.vendor}
              sessions={props.sessions}
              onFpsActive={setCapturing}
              onOpenSessions={() => {
                chooseMode("advanced");
                setSegment("sessions");
              }}
            />
          )
        ) : segment === "live" && monitorConsole ? (
          <MonitorConsole
            active={props.active}
            vendor={props.vendor ?? "any"}
            mode="advanced"
            sessions={props.sessions}
            onFpsActive={setCapturing}
          />
        ) : (
          <Play {...props} view={segment} onFpsActive={setCapturing} v2 />
        )}
      </div>
    </RoomShell>
  );
}

export default MonitorV2;
