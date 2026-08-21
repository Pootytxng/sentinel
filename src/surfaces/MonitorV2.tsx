import { useEffect, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import Play from "./Play";
import { TuningPresets } from "./TuningPresets";
import { RoomShell } from "../design/room-shell";
import { SegmentedControl } from "../design/SegmentedControl";
import { useReducedMotion } from "../design/use-motion";
import { useDocumentVisible } from "../data/use-document-visible";
import { useHudFlag } from "../design/use-hud";
import { MonitorConsole } from "./MonitorConsole";
import { HudMasthead } from "./hud-masthead";
import { monitorVerdict } from "./monitor-v2-data";
import DecryptedText from "../design/vendor/DecryptedText/DecryptedText";
import "../i18n";
import "./monitor-v2.css";

// MonitorV2 (V2-5, spec 2026-07-02-v2-shell-sourcing-and-plan) — the Monitor room on the V2
// shell: verdict (last-session answer, honest empty state) → Live/Sessions faces → quiet
// Tuning-presets expander → forward door (RoomShell, from DOOR_MAP: play → learn, "See what
// changed"). No measured-line header strip (owner header-slop law 2026-07-10) — the session
// count is the visible Sessions list itself.
//
// ONE FACE PER SEGMENT (comprehensibility sweep 2026-08-20, issue #180): the Basic/Advanced
// mode fork and the compy_monitor_console rollout flag are retired. Live IS the console
// instrument cluster (MonitorConsole); Sessions IS the full debrief (Play). The owner's read
// was correct — the fork had one noticeable difference and split the room's identity for it
// (pinned by monitor-one-face-guard.test.tsx).
//
// Deliberately NO primaryAction: the room's real actions (capture toggle, overlay) live with
// their tiles/cards, and hoisting one would duplicate live state the tiles already own — the
// one-mention law outranks filling the optional slot.
//
// V2-8 (P6 §2 placement): the forward door is ABSENT during a live capture session — it belongs
// to the session-end state, not mid-game. The Live face already polls get_fps_status for its own
// tiles; it mirrors that state up via the additive onFpsActive callback (no second IPC).

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
  const reduced = useReducedMotion();
  const hud = useHudFlag();
  const [segment, setSegment] = useState<Segment>("live");
  const visible = useDocumentVisible();
  const [presetsOpen, setPresetsOpen] = useState(false);
  // Live capture state, mirrored up from the Live face's poll. While a session is being captured
  // the forward door closes (P6 §2 — the door belongs to the session-end state). Conservative on
  // purpose: the last reported value stands until a face polls again, so the door never opens
  // mid-capture just because the user changed segment.
  const [capturing, setCapturing] = useState(false);
  // (The classic shell's one-shot sensor pre-warm was removed 2026-07-16: every face this shell
  // mounts fires the same get_cpu_sensors + get_gpu_sensors on ITS mount, so the pre-warm had
  // become a duplicate IPC round-trip on every nav-in. Nav-mount follow-up, BACKLOG 2026-07-15d.)

  // Self-correcting capture poll — the shell's FALLBACK ownership of get_fps_status. Q7 §398 is a
  // runtime-ownership rule ("one owner supplies each sensor stream"): on Live, MonitorConsole owns
  // the 1 Hz poll and mirrors up through onFpsActive; on Sessions, Play stands its poll down, so
  // without this the `capturing` flag strands at true and the forward door never reopens when the
  // session actually ends.
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
    if (!capturing || segment === "live" || !visible) return;
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
  }, [capturing, segment, visible]);

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
      }
    >
      <div className="mv2-bar">
        <SegmentedControl
          segments={SEGMENTS}
          value={segment}
          onChange={(id) => setSegment(id as Segment)}
          aria-label={t("monitor.monitorV2.monitorSectionsAria")}
        />
      </div>
      <div className="mv2-body">
        {segment === "live" ? (
          <MonitorConsole
            active={props.active}
            vendor={props.vendor ?? "any"}
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
