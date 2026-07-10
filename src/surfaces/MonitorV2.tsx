import { useEffect, useState, type ComponentProps } from "react";
import { invoke } from "@tauri-apps/api/core";
import Play from "./Play";
import { MonitorBasic } from "./MonitorBasic";
import { TuningPresets } from "./Monitor";
import { RoomShell } from "../design/room-shell";
import { SegmentedControl } from "../design/SegmentedControl";
import { useReducedMotion } from "../design/use-motion";
import { useHudFlag } from "../design/use-hud";
import { HudMasthead } from "./hud-masthead";
import { readViewMode, applyViewMode, type ViewMode } from "../design/theme";
import { monitorVerdict } from "./monitor-v2-data";
import DecryptedText from "../design/vendor/DecryptedText/DecryptedText";
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

type Segment = "sessions" | "live";

// Live first + default — same owner ruling (2026-06-26) the classic Monitor pins.
const SEGMENTS: { id: Segment; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "sessions", label: "Sessions" },
];

const MODES: { id: ViewMode; label: string }[] = [
  { id: "basic", label: "Basic" },
  { id: "advanced", label: "Advanced" },
];

// Same props App passes to <Play> / <Monitor>, minus `view`/`onFpsActive`/`v2` (this shell drives them).
type Props = Omit<ComponentProps<typeof Play>, "view" | "onFpsActive" | "v2">;

export function MonitorV2(props: Props) {
  const reduced = useReducedMotion();
  const hud = useHudFlag();
  const [segment, setSegment] = useState<Segment>("live");
  const [mode, setMode] = useState<ViewMode>(readViewMode);
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
  // Same one-shot sensor pre-warm as the classic Monitor shell (read-only, zero new IPC).
  useEffect(() => {
    invoke("get_cpu_sensors").catch(() => {});
    invoke("get_gpu_sensors").catch(() => {});
  }, []);

  const basic = mode === "basic";
  const verdict = monitorVerdict(props.sessions);

  return (
    <RoomShell
      room="play"
      doorOpen={!capturing}
      verdict={(() => {
        // Verdict-only DecryptedText (the adopt-list law) — the text is the pure helper's
        // real output; the animation never alters what is claimed.
        const headline = reduced ? (
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
        if (!hud) return headline; // flag off: the exact pre-rollout tree
        // HUD masthead (four-room rollout) — the LED breathes ONLY while a capture is
        // actually recording (the room's one live state); otherwise no LED, never fabricated.
        return (
          <>
            <HudMasthead label="Live telemetry" led={capturing ? "scan" : null} />
            <span className="hud-headline">{headline}</span>
          </>
        );
      })()}
      sub={verdict.sub}
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
              <span aria-hidden="true">{presetsOpen ? "▾" : "▸"}</span>
              Tuning presets
              <span className="mv2-quiet-hint">
                by-hand checklists · advisory — Compy never changes these for you
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
            aria-label="Monitor sections"
          />
        )}
        <SegmentedControl
          segments={MODES}
          value={mode}
          onChange={(id) => chooseMode(id as ViewMode)}
          aria-label="Detail level"
        />
      </div>
      <div className="mv2-body">
        {basic ? (
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
        ) : (
          <Play {...props} view={segment} onFpsActive={setCapturing} v2 />
        )}
      </div>
    </RoomShell>
  );
}

export default MonitorV2;
