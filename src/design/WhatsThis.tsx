import { useId, useState } from "react";
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
  if (!entry) return null;

  // Focus/blur handled at the wrapper so tabbing from the trigger into "More" keeps the tip open.
  const onBlur = (e: React.FocusEvent<HTMLSpanElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
  };

  return (
    <span
      className="whats-this-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
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
