import type { ReactNode } from "react";
import "./bento.css";

// BENTO GRID + TILE — the shared layout primitive for the 2026-08-11 redesign (owner approval:
// "this is to be applied throughout every single possible location in the app").
//
// WHAT A BENTO IS, AND THE ONE WAY IT FAILS. A bento grid is a set of tiles of DELIBERATELY
// different sizes, so the eye is told where to start. It fails in exactly one way: twelve
// equally-sized tiles is the "overwhelming, hard to navigate" complaint in a nicer outfit. So the
// rule this system is built around is ONE HERO PER GRID — the biggest tile answers the question
// the user walked in with, and everything else is visibly secondary. That rule is mechanised in
// one-hero-guard.test.ts rather than stated in prose, per the toolchain-over-prose law.
//
// DEPTH GOES BEHIND THE POPOUT, NEVER ACROSS THE SURFACE. A tile shows the at-a-glance answer and
// nothing more. Everything a tile *could* say goes into its <Sheet> (Sheet.tsx), which comes
// forward over the dimmed room. That is the whole point of the pattern: the room stays scannable
// no matter how much a section actually contains.
//
// WHY THE TILE IS A <section> AND NOT A <button>. An openable card is usually written as one big
// button, which is wrong here for two reasons: a button may not legally contain other controls,
// and several Compy tiles genuinely need their own switch or link inline. Instead the tile is a
// plain section and the open affordance is a real <button> stretched over it by ::after — the
// standard overlay-link pattern. Semantics stay honest (doorknob-guard is satisfied by a real
// button element), inner controls stay clickable by sitting above the stretched layer, and
// keyboard focus lands on something with a visible ring.

export type BentoSpan = "hero" | "half" | "third" | "quarter" | "full";

/** Semantic weight of a tile's state — drives the severity stripe, never the accent hue. */
export type BentoTone = "neutral" | "ok" | "warn" | "info";

export function BentoGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className ? `v2-bento ${className}` : "v2-bento"}>{children}</div>;
}

export type BentoTileProps = {
  /** The tile's name. A room-name-style noun phrase, never a status sentence (title-header law). */
  title: string;
  span: BentoSpan;
  tone?: BentoTone;
  /** Status chip / measured value shown beside the title. */
  badge?: ReactNode;
  /**
   * Makes the whole tile openable. `label` is the verb the user reads on the knob ("See all 14"),
   * and `onOpen` receives the tile's on-screen rect so the Sheet can grow out of exactly this tile
   * instead of appearing from nowhere.
   */
  open?: { label: string; onOpen: (origin: DOMRect) => void };
  children?: ReactNode;
};

export function BentoTile({ title, span, tone = "neutral", badge, open, children }: BentoTileProps) {
  return (
    <section className={`v2-tile v2-tile-${span} v2-tone-${tone}`}>
      <header className="v2-tile-head">
        <h3 className="v2-tile-title">{title}</h3>
        {badge != null && <div className="v2-tile-badge">{badge}</div>}
      </header>
      {children != null && <div className="v2-tile-body">{children}</div>}
      {open && (
        <button
          type="button"
          className="v2-tile-open"
          // The tile's own box is the hit target (::after stretches this button over it), so the
          // rect we hand the Sheet is the tile's, not the knob's.
          onClick={(e) =>
            open.onOpen(
              (e.currentTarget.closest(".v2-tile") ?? e.currentTarget).getBoundingClientRect(),
            )
          }
        >
          <span className="v2-tile-knob">{open.label}</span>
        </button>
      )}
    </section>
  );
}
