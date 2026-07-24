import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
// Side-effect import: guarantees the i18next instance is initialized before this file's t() calls run.
import "../i18n";
import { knowledgeByIdForLanguage } from "../data/knowledge";
import { useLibrary } from "../surfaces/library-context";
import "./Term.css";

// Inline glossary tooltip. <Term id="vrr">VRR</Term> renders a dotted-underline trigger; hover/tap/
// focus reveals the term's one-line "what" with a link into the full library entry. Keyboard-
// accessible. Fail-soft: an unknown id (or a non-term id) renders the children as plain text.
export function Term({
  id,
  children,
  align = "start",
}: {
  id: string;
  children: ReactNode;
  /** Tooltip anchor edge — "end" (right-anchored) for triggers near the window's right side. */
  align?: "start" | "end";
}) {
  const { t, i18n } = useTranslation();
  const entry = knowledgeByIdForLanguage(i18n.language).get(id);
  const { openLibrary } = useLibrary();
  const [open, setOpen] = useState(false);
  const tipId = useId();
  // Mouse-leave closes on a short GRACE (not instantly): the tooltip sits 6px below the trigger,
  // and the pointer must cross that gap to reach the "More in the Blackbook →" link — an instant
  // close made the link unreachable by mouse (owner catch 2026-07-13). Re-entering the wrapper
  // (the tooltip is a wrapper child) cancels the pending close.
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

  const what = entry && entry.type === "term" ? entry.what : null;
  if (!what) return <>{children}</>;

  // Focus/blur handled at the wrapper so tabbing from the trigger to the "more" link keeps it open.
  const onBlur = (e: React.FocusEvent<HTMLSpanElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
  };

  return (
    <span
      className="kl-term-wrap"
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
        className="kl-term"
        aria-describedby={open ? tipId : undefined}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {children}
      </button>
      {open && (
        <span className={`kl-tip${align === "end" ? " kl-tip-end" : ""}`} role="tooltip" id={tipId}>
          <span className="kl-tip-what">{what}</span>
          <button
            type="button"
            className="kl-tip-more"
            onClick={() => {
              setOpen(false);
              openLibrary(id);
            }}
          >
            {t("common.term.moreInBlackbook")}
          </button>
        </span>
      )}
    </span>
  );
}

// Curated auto-glossary for backend-driven copy (e.g. readiness rows) where jargon can't be wrapped
// by hand. Each rule is an explicit allowlist of phrases → one term id; only the FIRST occurrence in
// a string is linked, so it stays tasteful (one tooltip per label, never carpet-bombed).
export type GlossRule = { id: string; match: string[] };

type GlossSeg = string | { id: string; text: string };

export function glossSegments(text: string, rules: GlossRule[]): GlossSeg[] {
  const lower = text.toLowerCase();
  if (lower.length !== text.length) return [text]; // case-fold changed length; don't risk mis-slicing
  let best: { start: number; len: number; id: string } | null = null;
  for (const rule of rules) {
    for (const phrase of rule.match) {
      const needle = phrase.toLowerCase();
      if (needle.length < 2) continue;
      const re = new RegExp(`(?<![a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`);
      const m = re.exec(lower);
      if (m && (!best || m.index < best.start || (m.index === best.start && m[0].length > best.len))) {
        best = { start: m.index, len: m[0].length, id: rule.id };
      }
    }
  }
  if (!best) return [text];
  return [
    text.slice(0, best.start),
    { id: best.id, text: text.slice(best.start, best.start + best.len) },
    text.slice(best.start + best.len),
  ].filter((s) => s !== "");
}

export function GlossText({ text, rules }: { text: string; rules: GlossRule[] }) {
  return (
    <>
      {glossSegments(text, rules).map((s, i) =>
        typeof s === "string" ? (
          s
        ) : (
          <Term key={i} id={s.id}>
            {s.text}
          </Term>
        ),
      )}
    </>
  );
}
