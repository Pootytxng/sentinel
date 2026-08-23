import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import Learn from "./Learn";
import { RoomShell } from "../design/room-shell";
import { RoomEyebrow } from "../design/room-eyebrow";
import { useV2Nav } from "../design/ShellV2";
import { SegmentedControl } from "../design/SegmentedControl";
import { useReducedMotion } from "../design/use-motion";
import { useHudFlag, useBlackbookConsoleFlag, useIntelligenceFlag } from "../design/use-hud";
import { readAutopsyLedger } from "../data/autopsy-ledger";
import { blackbookVerdict } from "./blackbook-v2-data";
import { BlackbookConsole } from "./blackbook/BlackbookConsole";
import { LogbookTape } from "./blackbook/LogbookTape";
import { useLogbookView } from "./blackbook/logbook-view";
import { LedgerHealthNotice, useLedgerHealth } from "../design/LedgerHealthNotice";
import { PatternsTile } from "./blackbook/PatternsTile";
import { buildLogbook } from "./blackbook/logbook";
import type { AppliedChange, SessionSummary, IntelEvent, IntelligenceTimeline } from "../types";
import type { GpuVendor } from "./walkthroughs";
import DecryptedText from "../design/vendor/DecryptedText/DecryptedText";
import "../i18n";
import "./blackbook-v2.css";

// BlackbookV2 (V2-6, spec 2026-07-02-v2-shell-sourcing-and-plan) — the History room on the V2
// shell. Since the approved four-room direction (03-history-approved.png, issue #49) it is the
// SPLIT composition: a narrative column (eyebrow → verdict → one sentence → one primary action →
// quiet routes) beside the record tape, with the receipts strip, the patterns band and the library
// full-width beneath both. Nothing was removed to fit the picture — the supporting surfaces moved
// down, the face switch moved into the routes, and every filter, count and door is the same one.
//
// This is the classic Blackbook (Learn) composed VERBATIM with the same props and the same
// locked read-only cores (searchKnowledge / autopsyScan / KNOWLEDGE — zero IPC, zero network,
// nothing mutated). The v2 prop only trims Learn's standalone head + in-panel autopsy record
// (one-mention law: RoomShell's verdict is the ONE summary); classic renders are byte-identical
// without it (test-pinned). The re-skin is the token re-point in blackbook-v2.css — the same
// mechanism the five themes, OptimizeV2 and MonitorV2 use; classic CSS/DOM untouched.
//
// Phase 4 (plan 2026-07-12-console-hud-phase4-blackbook, direction A "The Logbook"): behind
// compy_blackbook_console (DEFAULT ON), the room's working face is a flight-recorder LOGBOOK —
// one reverse-chronological tape unifying the user's real changes, sessions and guide checks
// (buildLogbook, a PURE view over data App already holds). Phase 4 itself added zero IPC;
// Intelligence Phase 1 adds exactly ONE read-only fetch here (get_intelligence_timeline) so the
// tape can also carry the machine changes Compy merely OBSERVED — still zero mutation, zero
// network. The field guide (this file's Learn tree) stays reachable from the narrative column, and
// the face toggle returns from it. Flag off renders EXACTLY today's Learn tree, byte-identical for
// both compy_editorial states (test-pinned).

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
  const nav = useV2Nav();
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

  // Whether the Trust Ledger behind the tape's Change records is the WHOLE story. `get_applied_changes`
  // degrades a ledger it cannot READ to an empty array, and the tape renders that emptiness as a
  // claim about the machine ("since <date>", "nothing changed yet") — the same defect the Optimize
  // ledger fixed, on the same file. Keyed on `changes` so health is read on the same tick as the rows
  // it qualifies, and only while the console face can render the disclosure (classic mode makes no
  // IPC). UNKNOWN leaves every line below exactly as it was — see `design/LedgerHealthNotice.tsx`.
  const health = useLedgerHealth(changes, consoleOn);
  // The tape's and the strip's ONE shared state — see `blackbook/logbook-view.ts`. Hooks may not be
  // called conditionally, so this runs on every path; it reads nothing and costs a fold over
  // records that the disabled paths simply never render.
  const view = useLogbookView(records, health);

  // THE SPLIT is the logbook face only. The field guide is a library — a search field, a category
  // tree and a grading panel — and it has no evidence column to sit beside, so it stays the linear
  // composition it has always been (`aside` absent ⇒ RoomShell renders exactly the old DOM).
  const split = hud && consoleOn && face === "logbook";
  const openGuide = (fid?: string) => {
    setGuideFocus(fid ?? null);
    setFace("guide");
  };
  // "Review latest session" opens the session where its full readout already lives — Live, which
  // draws the last session's deck. Through the rail's OWN handler (useV2Nav), so navigation still
  // never teleports, and only when a session actually exists: a button promising a reading Compy
  // does not have is a fabricated claim in control form. With no session, the room's one dominant
  // action becomes the door that is always real — the field guide.
  const reviewLatest = view.latestSession ? () => nav.navigate("play") : null;

  return (
    <RoomShell
      room="learn"
      /* UX-1: the caveat that qualifies every claim in this room outranks them, so it prints above
         the verdict. It used to sit inside the console body, one scroll below the sentence it
         qualifies. Self-nulls when the ledger is healthy. */
      notice={consoleOn ? <LedgerHealthNotice health={health} /> : undefined}
      verdict={(() => {
        // The narrative belongs to the LOGBOOK face. With the console flag off this room is the
        // field-guide library, and "What changed, and when" would be a headline for a screen that
        // is not showing changes -- so the classic verdict sentence stays the h1 there.
        if (!hud || !consoleOn) {
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
        // THE ROOM'S OWN SENTENCE (03-history-approved.png). It replaces the bare title "Blackbook"
        // that the 2026-07-10 title-header law put here — the same correction Health took in UX-1,
        // for the same reason: the rail already says which room this is, so the biggest words on
        // the screen were a label nobody came to read. What this room IS — the local record of what
        // changed and when — is not redundant with anything.
        return (
          <>
            <RoomEyebrow dot="accent" label={t("blackbook.blackbookV2.narrative.eyebrow")} />
            <span className="bbv2-headline">{t("blackbook.blackbookV2.narrative.headline")}</span>
          </>
        );
      })()}
      sub={hud && consoleOn ? t("blackbook.blackbookV2.narrative.sub") : verdict.sub}
      primaryAction={
        hud && consoleOn ? (
          <button
            type="button"
            className="v2-primary"
            onClick={reviewLatest ?? (() => openGuide())}
          >
            {reviewLatest
              ? t("blackbook.blackbookV2.reviewLatest")
              : t("blackbook.blackbookConsole.library.openAll")}
          </button>
        ) : undefined
      }
      aside={
        split ? (
          <LogbookTape view={view} reduced={reduced} onReviewSession={reviewLatest ?? undefined} />
        ) : undefined
      }
      below={
        split ? (
          <BlackbookConsole
            view={view}
            vendor={vendor}
            /* Intelligence Phase 2 — cross-session pattern synthesis sits with the supporting
               surfaces (§5E: Blackbook holds the historical record). Self-contained fetch so the
               console stays zero-IPC; renders nothing until there's something honest to say.
               Handed IN rather than rendered beside the console so it lands inside the same bento
               grid as its own full-width tile. */
            patterns={<PatternsTile />}
            onOpenLab={() => onOpenLab?.()}
            onOpenGuide={openGuide}
          />
        ) : undefined
      }
    >
      {consoleOn ? (
        face === "logbook" ? (
          !split ? (
            /* THE CLASSIC COMPOSITION -- `compy_editorial` off, the devtools failsafe. The two
               flags are independent and always have been: `compy_blackbook_console` chooses the
               room's FACE (logbook vs field guide), `compy_editorial` chooses the SHELL it wears.
               Gating the tape and the strip on the shell flag deleted the whole logbook face from
               the failsafe, which is the one composition that exists to still work. Linear, in the
               room body, with the face toggle it has always had. */
            <>
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
              <LogbookTape
                view={view}
                reduced={reduced}
                onReviewSession={reviewLatest ?? undefined}
              />
              <BlackbookConsole
                view={view}
                vendor={vendor}
                patterns={<PatternsTile />}
                onOpenLab={() => onOpenLab?.()}
                onOpenGuide={openGuide}
              />
            </>
          ) : (
          /* THE QUIET ROUTES (03-history-approved.png): the story column's foot. They are the
             room's two secondary doors — undo, which lives in the Lab, and the field guide, which
             is this room's other face. The segmented control that used to carry the face switch is
             gone from THIS face only: the comp draws a route here, and a toggle whose second
             option is a whole other library reads as a tab when it is really a door. The toggle
             still renders on the guide face, which is where a way back is what you need. */
          <div className="bbv2-routes">
            {view.activeChanges > 0 && (
              <button type="button" className="bbv2-route" onClick={() => onOpenLab?.()}>
                <span>
                  {t("blackbook.blackbookConsole.manageJump", { count: view.activeChanges })}
                </span>
                <span className="bbv2-route-chev" aria-hidden="true">
                  ›
                </span>
              </button>
            )}
            {/* Suppressed when the guide IS the primary action above (no sessions recorded yet) —
                one affordance per destination, never the same door twice in one column. */}
            {reviewLatest && (
              <button type="button" className="bbv2-route" onClick={() => openGuide()}>
                <span>{t("blackbook.blackbookConsole.library.openAll")}</span>
                <span className="bbv2-route-chev" aria-hidden="true">
                  ›
                </span>
              </button>
            )}
          </div>
          )
        ) : (
          <>
            {/* The way back to the record. */}
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
            {/* The Field Guide introduces ITSELF on its own tab (tester Matthew 2026-07-22: he
                first met the term inside the Logbook and was confused — the description belongs
                where the guide lives, and in the intro's Blackbook blurb, not buried in a sibling
                tab). */}
            <p className="bbv2-guide-lede">{t("blackbook.blackbookV2.guideLede")}</p>
            <Learn
              asPanel
              v2
              keepRecord
              focusId={guideFocus ?? focusId}
              vendor={vendor}
              onClose={onClose}
              onAutopsyRecorded={setLedger}
            />
          </>
        )
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
