import { useId, useState, type ReactNode } from "react";
import { KNOWLEDGE_BY_ID } from "../data/knowledge";
import { useLibrary } from "../surfaces/library-context";
import "./Term.css";

// Inline glossary tooltip. <Term id="vrr">VRR</Term> renders a dotted-underline trigger; hover/tap/
// focus reveals the term's one-line "what" with a link into the full library entry. Keyboard-
// accessible. Fail-soft: an unknown id (or a non-term id) renders the children as plain text.
export function Term({ id, children }: { id: string; children: ReactNode }) {
  const entry = KNOWLEDGE_BY_ID.get(id);
  const { openLibrary } = useLibrary();
  const [open, setOpen] = useState(false);
  const tipId = useId();

  const what = entry && entry.type === "term" ? entry.what : null;
  if (!what) return <>{children}</>;

  // Focus/blur handled at the wrapper so tabbing from the trigger to the "more" link keeps it open.
  const onBlur = (e: React.FocusEvent<HTMLSpanElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
  };

  return (
    <span
      className="kl-term-wrap"
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
        className="kl-term"
        aria-describedby={open ? tipId : undefined}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {children}
      </button>
      {open && (
        <span className="kl-tip" role="tooltip" id={tipId}>
          <span className="kl-tip-what">{what}</span>
          <button
            type="button"
            className="kl-tip-more"
            onClick={() => {
              setOpen(false);
              openLibrary(id);
            }}
          >
            More in the library →
          </button>
        </span>
      )}
    </span>
  );
}
