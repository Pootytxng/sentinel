import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BentoGrid, BentoTile } from "../../design/bento/BentoGrid";
import type { GpuVendor } from "../walkthroughs";
import { startHereEntries, type LogbookRecord } from "./logbook";
import type { LogbookView } from "./logbook-view";
import type { InEffectCounts } from "../../data/machine-model";
import type { LedgerHealth } from "../../types";
import type { TFunction } from "i18next";
import "../../i18n";
import "./blackbook-console.css";

// BlackbookConsole — the Logbook's SUPPORTING surface (Console HUD Phase 4, plan
// 2026-07-12-console-hud-phase4-blackbook, direction A "The Logbook"; re-scoped by the approved
// four-room direction, issue #49). The receipts strip that names and counts what this room
// records, the cross-session patterns band above it, and the compact library strip that doors into
// the full field guide.
//
// WHAT MOVED, AND WHY. The record TAPE used to be this grid's hero tile. 03-history-approved.png
// makes the tape the room's evidence column and puts everything here full-width beneath both
// columns, so the tape is now its own sibling (`LogbookTape`) in RoomShell's `aside` slot. The two
// still share one state — the strip's filter drives the tape, and always has — which is why that
// state was hoisted into `useLogbookView` and both read the same object. Nothing was deleted to
// make the picture fit: every tile, count, filter and door on this surface is the same one.
//
// Honesty contract: every count here is a fold over the records buildLogbook already proved real —
// the strip cannot disagree with the tape. The one exception is how many changes are IN EFFECT now
// (#625): that is the Machine Model's number, handed in as `inEffect`, because a fold over the tape
// counted "Compy can't check this" as "still on" and disagreed with Health. Zero IPC, zero
// mutation. Undo
// is NOT triggered here: the Lab's Optimize station is the ONE audited undo home (owner decision
// 2026-07-10), so an active change routes there via a single jump.

// Human, plain-language type tags (never "autopsy"/"Black Box" — the naming rail): the record's
// kind, as a non-technical gamer reads it. Values resolved via t("blackbook.blackbookConsole.*")
// at each call site (typeLabel / kindTag / filterNoun keys), keyed by the same record-kind strings.

export function BlackbookConsole({
  view,
  vendor,
  onOpenLab,
  onOpenGuide,
  patterns = null,
  inEffect,
}: {
  /** The Logbook's shared view state (see `logbook-view.ts`) — the same object the tape reads. */
  view: LogbookView;
  /** How many Compy changes are in effect on this PC — the Machine Model's count, the one Health
   *  prints (#625). Handed in so this file stays zero-IPC. */
  inEffect: InEffectCounts;
  vendor: GpuVendor;
  /** Route to the Lab's Optimize station — the ONE audited undo home (owner decision 2026-07-10). */
  onOpenLab: () => void;
  /** Door into the field guide; a focusId deep-links to that entry. */
  onOpenGuide: (focusId?: string) => void;
  /** Optional full-width band ABOVE the strip (BlackbookV2 passes PatternsTile). It is handed in
   *  rather than imported so this file stays zero-IPC, and it must be a `<BentoTile span="full">`
   *  so its absence closes the row instead of leaving a hole (bento row-major law, no dense flow). */
  patterns?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const startHere = useMemo(
    () => startHereEntries(vendor, 4, i18n.language),
    [vendor, i18n.language],
  );
  const { filter, toggleFilter, counts, undoableChanges, incomplete } = view;

  const tileProps = (kind: LogbookRecord["kind"]) => ({
    type: "button" as const,
    className: "bc-tile",
    "data-kind": kind,
    "aria-pressed": filter === kind,
    onClick: () => toggleFilter(kind),
  });

  return (
    <div className="blackbook-console">
      <BentoGrid>
        {/* Intelligence Phase 2 — cross-session pattern synthesis stays ABOVE the record (§5E),
            handed in by BlackbookV2 rather than imported so this file stays zero-IPC. */}
        {patterns}
        {/* The Receipts Strip (owner pick 2026-07-13, concept A) — replaces the bare "N records ·
            since <date>" status line with the same facts made self-explanatory: three tappable tiles
            NAME the three things this room records, carry live counts, and filter the tape. The page
            teaches its own vocabulary through a summary you can touch — no explainer paragraph.
            UNCONDITIONAL since the bento conversion (it used to hide at zero records): its
            zero-state copy is already honest ("nothing changed yet"), every tile disables itself at
            zero, and a half tile that can vanish would leave the row as a visible hole — the grid is
            strict row-major with no dense flow, on purpose.

            FULL, not half, since the tape left this grid. `half` is span 5 of 12, and it filled
            its row only because the tape's hero (span 7) sat beside it. With the hero gone,
            half + half spans 10 columns and leaves a two-column dark gap on every render -- the
            exact hole the row-major law exists to make visible. Two full-width bands under a
            two-column room is also the honest shape: these are the room's foot, not tiles in a
            wall competing with the record above them. */}
        <BentoTile span="full" title={t("blackbook.blackbookConsole.stripAriaLabel")}>
          <div className="bc-strip">
            <button {...tileProps("change")} disabled={counts.change === 0}>
              <span className="bc-tile-k">{t("blackbook.blackbookConsole.tiles.changesTitle")}</span>
              {/* A count read off a ledger that would not open is not a count. An em dash says
                  "no number", where a 0 would say "nothing ever happened here". */}
              <span className="bc-tile-n bc-mono">{incomplete?.error ? "—" : counts.change}</span>
              <span className="bc-tile-d">
                {changesTileSub(t, counts.change, incomplete, inEffect)}
              </span>
            </button>
            <button {...tileProps("session")} disabled={counts.session === 0}>
              <span className="bc-tile-k">
                {t("blackbook.blackbookConsole.tiles.sessionsTitle")}
              </span>
              <span className="bc-tile-n bc-mono">{counts.session}</span>
              <span className="bc-tile-d">
                {counts.session === 0
                  ? t("blackbook.blackbookConsole.tiles.sessionsNone")
                  : t("blackbook.blackbookConsole.tiles.sessionsSome")}
              </span>
            </button>
            <button {...tileProps("autopsy")} disabled={counts.autopsy === 0}>
              <span className="bc-tile-k">{t("blackbook.blackbookConsole.tiles.autopsyTitle")}</span>
              <span className="bc-tile-n bc-mono">{counts.autopsy}</span>
              <span className="bc-tile-d">
                {counts.autopsy === 0
                  ? t("blackbook.blackbookConsole.tiles.autopsyNone")
                  : counts.scamFlags > 0
                    ? t("blackbook.blackbookConsole.scamFlagged", { count: counts.scamFlags })
                    : t("blackbook.blackbookConsole.tiles.autopsySome")}
              </span>
            </button>
            {/* Observed machine changes (Intelligence Phase 1) — the tile only mounts once such a
                record exists: three tiles stay the room's stable face until the fourth kind is real. */}
            {counts.observed > 0 && (
              <button {...tileProps("observed")}>
                <span className="bc-tile-k">
                  {t("blackbook.blackbookConsole.tiles.observedTitle")}
                </span>
                <span className="bc-tile-n bc-mono">{counts.observed}</span>
                <span className="bc-tile-d">
                  {t("blackbook.blackbookConsole.tiles.observedSub")}
                </span>
              </button>
            )}
          </div>
          {/* Undo lives in the Lab (the ONE audited undo home) — the Logbook is a read view, so an
              active change routes there rather than rolling back in-room (no second undo surface).
              It sits in the strip tile because it is a follow-on to the change COUNT above it. */}
          {undoableChanges > 0 && (
            <button type="button" className="bc-manage" onClick={onOpenLab}>
              <span>{t("blackbook.blackbookConsole.manageJump", { count: undoableChanges })}</span>
              <span className="bc-chevron" aria-hidden="true">
                ▸
              </span>
            </button>
          )}
        </BentoTile>
        {/* The compact library strip — doors into the full field guide. Rig-fit "start here" entries
            (real corpus only, hardware-aware) deep-link into the guide; the door browses all. The
            old ".bc-library-eyebrow" is gone: it said the same words the tile title now says, and a
            tile that names itself twice is duplication (self-review rubric 3). */}
        <BentoTile span="full" title={t("blackbook.blackbookConsole.library.eyebrow")}>
          <div className="bc-library">
            <span className="bc-library-scent">{t("blackbook.blackbookConsole.library.scent")}</span>
            {startHere.length > 0 && (
              <div className="bc-picks">
                {startHere.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className="bc-pick"
                    onClick={() => onOpenGuide(e.id)}
                  >
                    <span className="bc-pick-type">
                      {t(`blackbook.blackbookConsole.typeLabel.${e.type}`, { defaultValue: e.type })}
                    </span>
                    <span className="bc-pick-name">{e.name}</span>
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="bc-library-all" onClick={() => onOpenGuide()}>
              <span>{t("blackbook.blackbookConsole.library.openAll")}</span>
              <span className="bc-chevron" aria-hidden="true">
                ▸
              </span>
            </button>
          </div>
        </BentoTile>
      </BentoGrid>
    </div>
  );
}

// The "Changes to this PC" tile's sub-line. The record's own states come first — an unreadable
// ledger has no count at all, and an empty one has nothing to be in effect. Past those, the
// in-effect words are the Machine Model's (#625): the same numbers Health prints, never a fold over
// the tape, whose legacy flag read "Compy can't check this" as "still on". Not read yet ⇒ nothing,
// because a stand-in number is a claim. The empty-ledger words stay AHEAD of the model on purpose:
// they are the ledger's own claim, qualified by ledger health, and the model is never read while
// the Intelligence flag is off — ordering them after it would blank "nothing changed yet" for good.
function changesTileSub(
  t: TFunction,
  changes: number,
  incomplete: LedgerHealth | null,
  inEffect: InEffectCounts,
): string {
  if (incomplete?.error) return t("blackbook.blackbookConsole.tiles.changesUnknown");
  if (changes === 0) {
    return incomplete
      ? t("blackbook.blackbookConsole.tiles.changesNonePartial")
      : t("blackbook.blackbookConsole.tiles.changesNone");
  }
  if (inEffect.kind === "pending") return "";
  if (inEffect.kind === "unreadable") return t("blackbook.blackbookConsole.tiles.changesUnknown");
  const { activeNow, unknown } = inEffect;
  if (unknown > 0) {
    return incomplete
      ? t("blackbook.blackbookConsole.tiles.changesUnconfirmedPartial", { count: activeNow, unknown })
      : t("blackbook.blackbookConsole.tiles.changesUnconfirmed", { count: activeNow, unknown });
  }
  if (activeNow > 0) {
    return incomplete
      ? t("blackbook.blackbookConsole.tiles.changesActivePartial", { count: activeNow })
      : t("blackbook.blackbookConsole.tiles.changesActive", { count: activeNow });
  }
  return incomplete
    ? t("blackbook.blackbookConsole.tiles.changesInactivePartial")
    : t("blackbook.blackbookConsole.tiles.changesInactive");
}

export default BlackbookConsole;
