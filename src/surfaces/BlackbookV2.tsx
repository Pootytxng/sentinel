import { useState } from "react";
import Learn from "./Learn";
import { RoomShell } from "../design/room-shell";
import { useReducedMotion } from "../design/use-motion";
import { readAutopsyLedger } from "../data/autopsy-ledger";
import { blackbookVerdict, blackbookMeasuredLine } from "./blackbook-v2-data";
import type { GpuVendor } from "./walkthroughs";
import { useEditorialFlag } from "../design/use-editorial";
import DecryptedText from "../design/vendor/DecryptedText/DecryptedText";
import "./blackbook-v2.css";

// BlackbookV2 (V2-6, spec 2026-07-02-v2-shell-sourcing-and-plan) — the Blackbook room on the
// V2 shell: verdict (the reader's own autopsy record, honest no-record state) → measured line
// (corpus size + where answers come from) → the room's working face → forward door (RoomShell,
// from DOOR_MAP: learn → lab, "Open the instruments").
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

export function BlackbookV2({
  focusId,
  vendor,
  onClose,
}: {
  focusId: string | null;
  vendor: GpuVendor;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const editorial = useEditorialFlag();
  // Seeded from the persisted ledger; Learn reports each new grading up so the room verdict
  // updates the moment a guide is fact-checked (same data, no second read of the panel).
  const [ledger, setLedger] = useState(readAutopsyLedger);
  const verdict = blackbookVerdict(ledger);

  return (
    <RoomShell
      room="learn"
      verdict={
        editorial ? (
          // Editorial masthead (rollout, spec 2026-07-05): eyebrow + the composed serif
          // verdict — a serif headline lands whole, not decoded. Same pure-helper text.
          <>
            <span className="edh-masthead-eyebrow">Claims, graded</span>
            {verdict.headline}
          </>
        ) : reduced ? (
          verdict.headline
        ) : (
          // Verdict-only DecryptedText (the adopt-list law) — the text is the pure helper's
          // real output; the animation never alters what is claimed.
          <DecryptedText
            key={verdict.headline}
            text={verdict.headline}
            animateOn="view"
            sequential
            speed={22}
            useOriginalCharsOnly
          />
        )
      }
      sub={verdict.sub}
      measured={blackbookMeasuredLine()}
    >
      <Learn
        asPanel
        v2
        focusId={focusId}
        vendor={vendor}
        onClose={onClose}
        onAutopsyRecorded={setLedger}
      />
    </RoomShell>
  );
}

export default BlackbookV2;
