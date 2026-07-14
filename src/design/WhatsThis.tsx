import { useEffect, useId, useRef, useState } from "react";
import { KNOWLEDGE_BY_ID, type KnowledgeEntry } from "../data/knowledge";
import "./WhatsThis.css";

// "What's this?" (wayfinding §3) — an in-place hover/focus tooltip on a rec/toggle/graded row. Instead
// of yanking the user out of the section to the Library (the old click-navigates behavior), it reveals
// a SHORT plain-language blurb right where they are; the full Blackbook entry stays one tap away via
// "More in the Blackbook →" (doctrine: measured detail one tap away — access is preserved, not removed).
// Renders nothing when no entry resolves by that id — we never show a dead affordance. onOpen is the
// existing libraryApi.openLibrary(focusId); it now fires from the "More" link, not the trigger.

// The tooltip can't hold a full entry, so it shows the entry's own short "what it is" line, per type.
function blurbFor(entry: KnowledgeEntry): string {
  switch (entry.type) {
    case "tweak":
    case "term":
      return entry.what;
    case "trick":
      return entry.pattern;
    case "guide":
      return entry.goal;
  }
}

export function WhatsThis({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  const entry = KNOWLEDGE_BY_ID.get(id);
  const [open, setOpen] = useState(false);
  const tipId = useId();
  // Mouse-leave closes on a short GRACE (not instantly), mirroring Term.tsx: the tip sits below the
  // trigger and the pointer must cross that gap to reach the "More in the Blackbook →" link — an
  // instant close made the link unreachable by mouse (same class as the owner's 2026-07-13 Term
  // catch; this sibling was missed by that sweep). Re-entering the wrapper cancels the pending close.
  const closeTimer = useRef<number | null>(null);
  const cancelClose = () => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 160);
  };
  useEffect(() => cancelClose, []); // never fire a close after unmount
  if (!entry) return null;

  // Focus/blur handled at the wrapper so tabbing from the trigger into "More" keeps the tip open.
  const onBlur = (e: React.FocusEvent<HTMLSpanElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
  };

  return (
    <span
      className="whats-this-wrap"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
      onFocus={() => {
        cancelClose();
        setOpen(true);
      }}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          cancelClose();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="whats-this"
        aria-describedby={open ? tipId : undefined}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        What's this?
      </button>
      {open && (
        <span className="whats-this-tip" role="tooltip" id={tipId}>
          <span className="whats-this-what">{blurbFor(entry)}</span>
          <button
            type="button"
            className="whats-this-more"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onOpen(id);
            }}
          >
            More in the Blackbook →
          </button>
        </span>
      )}
    </span>
  );
}
