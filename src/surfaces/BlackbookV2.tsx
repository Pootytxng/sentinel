import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import Learn from "./Learn";
import { RoomShell } from "../design/room-shell";
import { SegmentedControl } from "../design/SegmentedControl";
import { useReducedMotion } from "../design/use-motion";
import { useHudFlag, useBlackbookConsoleFlag, useIntelligenceFlag } from "../design/use-hud";
import { HudMasthead } from "./hud-masthead";
import { readAutopsyLedger } from "../data/autopsy-ledger";
import { blackbookVerdict } from "./blackbook-v2-data";
import { BlackbookConsole } from "./blackbook/BlackbookConsole";
import { PatternsTile } from "./blackbook/PatternsTile";
import { buildLogbook } from "./blackbook/logbook";
import type { AppliedChange, SessionSummary, IntelEvent, IntelligenceTimeline } from "../types";
import type { GpuVendor } from "./walkthroughs";
import DecryptedText from "../design/vendor/DecryptedText/DecryptedText";
import "../i18n";
import "./blackbook-v2.css";

// BlackbookV2 (V2-6, spec 2026-07-02-v2-shell-sourcing-and-plan) — the Blackbook room on the
// V2 shell: verdict (the reader's own autopsy record, honest no-record state) → the room's
// working face → forward door (RoomShell, from DOOR_MAP: learn → lab, "Open the instruments").
// No measured-line header strip (owner header-slop law 2026-07-10) — the corpus size and the
// never-the-internet promise live in the body's own copy.
//
// This is the classic Blackbook (Learn) composed VERBATIM with the same props and the same
// locked read-only cores (searchKnowledge / autopsyScan / KNOWLEDGE — zero IPC, zero network,
// nothing mutated). The v2 prop only trims Learn's standalone head + in-panel autopsy record
// (one-mention law: RoomShell's verdict is the ONE summary); classic renders are byte-identical
// without it (test-pinned). The re-skin is the token re-point in blackbook-v2.css — the same
// mechanism the five themes, OptimizeV2 and MonitorV2 use; classic CSS/DOM untouched.
//
// Deliberately NO primaryAction — the P6 spec names Blackbook the room that may have none: its
// work (search, filters, grading a pasted guide) lives in the body, and hoisting one mode
// would demote the other.
//
// Phase 4 (plan 2026-07-12-console-hud-phase4-blackbook, direction A "The Logbook"): behind
// compy_blackbook_console (DEFAULT ON), the room gains a flight-recorder LOGBOOK face — one
// reverse-chronological tape unifying the user's real changes, sessions and guide checks
// (buildLogbook, a PURE view over data App already holds). Phase 4 itself added zero IPC;
// Intelligence Phase 1 adds exactly ONE read-only fetch here (get_intelligence_timeline) so the
// tape can also carry the machine changes Compy merely OBSERVED — still zero mutation, zero
// network. The field guide (this file's Learn tree) stays reachable via the mode toggle. Flag
// off renders EXACTLY today's Learn tree, byte-identical for both compy_editorial states
// (test-pinned).

type Face = "logbook" | "guide";
const FACE_IDS: Face[] = ["logbook", "guide"];

export function BlackbookV2({
  focusId,
  vendor,
  onClose,
  changes = [],
  sessions = [],
  onOpenLab,
}: {
  focusId: string | null;
  vendor: GpuVendor;
  onClose: () => void;
  /** The Trust Ledger's applied changes — the tape's Change records (mirrored, never moved). */
  changes?: AppliedChange[];
  /** Recorded gaming sessions — the tape's Session records. */
  sessions?: SessionSummary[];
  /** Route to the Lab's Optimize station — the Logbook's read view sends undo there, not in-room. */
  onOpenLab?: () => void;
}) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const hud = useHudFlag();
  const consoleOn = useBlackbookConsoleFlag();
  // Seeded from the persisted ledger; Learn reports each new grading up so the room verdict AND
  // the Logbook tape update the moment a guide is fact-checked (same data, no second read).
  const [ledger, setLedger] = useState(readAutopsyLedger);
  const verdict = blackbookVerdict(ledger, t);

  // The Logbook face + which field-guide entry a library-strip pick deep-links to. Flag off, none
  // of this is reachable (the classic Learn tree renders directly).
  const [face, setFace] = useState<Face>("logbook");
  const [guideFocus, setGuideFocus] = useState<string | null>(null);

  // Observed machine changes for the tape (Intelligence Phase 1): the ONE read-only IPC this room
  // makes, and only while BOTH the console face and the intelligence flag are on — classic mode
  // never fetches. Scope-filtered here AND in buildLogbook (defense in depth: the builder is the
  // tested honesty spine). A failed fetch ⇒ no observed rows — the tape never fabricates.
  const intelOn = useIntelligenceFlag();
  const [observed, setObserved] = useState<IntelEvent[]>([]);
  useEffect(() => {
    if (!intelOn || !consoleOn) {
      setObserved([]);
      return;
    }
    let alive = true;
    invoke<IntelligenceTimeline>("get_intelligence_timeline")
      .then((t) => {
        if (alive) setObserved(t.events.filter((e) => e.scope === "observed"));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [intelOn, consoleOn]);

  const records = useMemo(
    () => buildLogbook({ changes, sessions, autopsy: ledger, observed }),
    [changes, sessions, ledger, observed],
  );

  return (
    <RoomShell
      room="learn"
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
        // HUD header = title only (owner title-header law 2026-07-10 round 2). The autopsy
        // record moves back into its context — the Autopsy panel's own record rollup (Learn's
        // keepRecord below un-trims it) and, under the console, the Logbook's own status line.
        // No LED: a record count is not a health state, and this room computes no live status.
        return (
          <>
            <HudMasthead label={t("blackbook.blackbookV2.fieldRecordsLabel")} />
            {/* "Blackbook" is the rail's own label for this room (id "learn", see homeRail.ts) —
                sourced from the shared common.rail.* keys (owned alongside the rest of the rail
                copy) rather than re-translated here. The English literal is a defaultValue so this
                still renders correctly before that namespace is populated. */}
            <span className="hud-headline">{t("common.rail.learn", "Blackbook")}</span>
          </>
        );
      })()}
      sub={hud ? undefined : verdict.sub}
    >
      {consoleOn ? (
        <>
          {/* The room's face toggle — the Logbook tape or the full field guide. */}
          <div className="bbv2-bar">
            <SegmentedControl
              segments={FACE_IDS.map((id) => ({
                id,
                label: t(`blackbook.blackbookV2.faces.${id}`),
              }))}
              value={face}
              onChange={(id) => setFace(id as Face)}
              aria-label={t("blackbook.blackbookV2.faceToggleAriaLabel")}
            />
          </div>
          {/* The Field Guide introduces ITSELF on its own tab (tester Matthew 2026-07-22: he first
              met the term inside the Logbook and was confused — the description belongs where the
              guide lives, and in the intro's Blackbook blurb, not buried in a sibling tab). */}
          {face === "guide" && (
            <p className="bbv2-guide-lede">{t("blackbook.blackbookV2.guideLede")}</p>
          )}
          {face === "logbook" ? (
            <>
              {/* Intelligence Phase 2 — cross-session pattern synthesis sits above the record tape
                  (§5E: Blackbook holds the historical record). Self-contained fetch so the console
                  stays zero-IPC; renders nothing until there's something honest to say. */}
              <PatternsTile />
              <BlackbookConsole
                records={records}
                vendor={vendor}
                onOpenLab={() => onOpenLab?.()}
                onOpenGuide={(fid) => {
                  setGuideFocus(fid ?? null);
                  setFace("guide");
                }}
              />
            </>
          ) : (
            <Learn
              asPanel
              v2
              keepRecord
              focusId={guideFocus ?? focusId}
              vendor={vendor}
              onClose={onClose}
              onAutopsyRecorded={setLedger}
            />
          )}
        </>
      ) : (
        <Learn
          asPanel
          v2
          keepRecord={hud}
          focusId={focusId}
          vendor={vendor}
          onClose={onClose}
          onAutopsyRecorded={setLedger}
        />
      )}
    </RoomShell>
  );
}

export default BlackbookV2;
