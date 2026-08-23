import { useEffect, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import Play from "./Play";
import { TuningPresets } from "./TuningPresets";
import { RoomShell } from "../design/room-shell";
import { RoomEyebrow } from "../design/room-eyebrow";
import { SegmentedControl } from "../design/SegmentedControl";
import { useReducedMotion } from "../design/use-motion";
import { useDocumentVisible } from "../data/use-document-visible";
import { MonitorConsole } from "./MonitorConsole";
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
// PRIMARY ACTION, per face (issue #49 slice 4). Sessions still has none: hoisting one of the
// debrief's card actions would duplicate live state those cards already own, and the one-mention
// law outranks filling an optional slot. Live now has exactly one — the approved comp makes Start
// capture the dominant action — and it MOVED there out of the control row rather than being
// copied, so that screen still carries exactly one capture toggle. Live composes its own shell
// (below), so it fills that slot itself.
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

  // The segment bar and the advisory-presets expander belong to the ROOM, not to either face, so
  // they are built once here and handed to whichever face is composing the shell below.
  const bar = (
    <div className="mv2-bar">
      <SegmentedControl
        segments={SEGMENTS}
        value={segment}
        onChange={(id) => setSegment(id as Segment)}
        aria-label={t("monitor.monitorV2.monitorSectionsAria")}
      />
    </div>
  );

  const quiet = (
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
        <span className="mv2-quiet-hint">{t("monitor.monitorV2.tuningPresetsHint")}</span>
      </button>
      <div id="mv2-presets-body" className="mv2-presets-body" hidden={!presetsOpen}>
        <TuningPresets vendor={props.vendor} bare />
      </div>
    </>
  );

  // TWO FACES, TWO COMPOSITIONS (issue #49 slice 4). The approved Live comp is the four-room
  // SPLIT — a narrative column (Session monitor → one verdict → one sentence → Start capture)
  // beside an evidence column holding the last session. Both halves are built from state the
  // live face owns (the capture stream, the sensors, the session array), so the live face
  // renders its own RoomShell rather than having that ownership hoisted up here and the room's
  // one 1 Hz poll split in two. Sessions keeps the linear shell below: it has no evidence column,
  // so it is a different composition, not the same one with a slot left empty.
  if (segment === "live") {
    return (
      <MonitorConsole
        active={props.active}
        vendor={props.vendor ?? "any"}
        sessions={props.sessions}
        onFpsActive={setCapturing}
        quiet={quiet}
        bar={bar}
      />
    );
  }

  return (
    <RoomShell
      room="play"
      doorOpen={!capturing}
      /* ONE HEADER IDIOM PER ROOM (issue #49 slice 4). Live and Sessions are two faces of ONE
         room, so they cannot wear two different headers a tab apart — which is what shipping the
         approved narrative header on Live while Sessions kept the Instrument-HUD masthead would
         have done. The HUD masthead is therefore gone from Monitor, the same way UX-1 retired it
         from Home (docs/decisions/2026-08-11-design-foundation.md, decision 1: "the front door is
         a verdict"). The owner title-header law it served — a header is a NAME, never a status
         sentence — is not weakened by that: it was written against a *notification* standing in
         the header, and what replaces it here is the room's measured verdict, which is the one
         thing on this screen the user actually came for. The room label is redundant with the
         rail that navigated here; the verdict is redundant with nothing.
         Sessions keeps the verdict-only DecryptedText moment (the adopt-list law) because its
         headline IS a measured verdict landing. Live's is a state line ("Ready when you are"),
         which is not a measurement and so is not marked as one. */
      verdict={
        <>
          <RoomEyebrow
            tone="accent"
            /* NO DOT WHEN NOTHING IS RECORDING (owner ruling 2026-08-23 — match the comps
                exactly). 02-live-approved.png carries no dot beside this label at all, and
                its idle state is the state the app is in most of the time; the label itself
                is drawn in the accent instead. The dot survives ONLY as the recording light,
                which is the one moment this room has a live state to report — so the comp is
                matched where it speaks, and nothing honest is lost where it is silent. */
            dot={capturing ? "rec" : undefined}
            label={t("monitor.monitorConsole.narrative.eyebrow")}
          />
          <span className="mc-headline" key={verdict.headline}>
            {reduced ? (
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
            )}
          </span>
        </>
      }
      sub={verdict.sub}
      quiet={quiet}
    >
      {bar}
      <div className="mv2-body">
        <Play {...props} view={segment} onFpsActive={setCapturing} v2 />
      </div>
    </RoomShell>
  );
}

export default MonitorV2;
