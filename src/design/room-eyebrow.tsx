import type { ReactNode } from "react";

/* THE ROOM EYEBROW — ONE implementation for all four rooms (issue #49 slice 7).

   Whole-app convergence found four private copies of the same element, and THREE of them did not
   match their own approved comp. Measured off the PNGs at the 1550/1500 comp scale (divide comp
   pixels by 1.0333 for app pixels):

     cap height       11 comp px on all four
     glyph advance    10.2-10.5 comp px = 9.9-10.2 app px on all four
                      -> 15px mono at 0.08em advances 0.6em + 0.08em = 10.2px. 13px advances 8.8.
     dot              7 / 9 / 8 comp px wide (Health / History / Test) — one 8px circle, drawn by
                      a generator that did not round the same way twice
     dot -> label     10-11 comp px on all three that draw a dot
     separator        Health x435-436, sampled (127,136,130) — dimmer than its label's ~(150,165,180),
                      i.e. --v2-faint under a --v2-muted label. NOT the accent, and NOT --v2-line
                      (0.07 alpha, which is invisible at this size).
     dateline         sampled ~(140,150,165) — also --v2-faint, one step under the label.

   So the shared spec is: mono · --type-body (15px) · 0.08em · uppercase · --v2-muted.

   What the four were doing instead, all of it now deleted:
     Health   .hc-masthead-eyebrow   sans 600 / 13px / 0.14em / faint    accent separator
     Live     .mc-masthead-eyebrow   sans 600 / 13px / 0.14em / accent
     Test     .lc-eyebrow            mono     / 13px / 0.08em / faint    --v2-line separator
     History  .bbv2-eyebrow          mono     / 15px / 0.06em / muted    (closest — 0.06em its drift)

   COLOUR AND DOT STAY PER-ROOM, because there they carry information: Health and Test print a live
   state LED, History a static violet mark, Live nothing at all until it is actually recording
   (owner ruling 2026-08-23 — 02-live-approved.png draws no dot, and idle is the state this app is
   in most of the time). Type is not information, so type converges. */

export type EyebrowDot = "ok" | "warn" | "scan" | "accent" | "rec";

export function RoomEyebrow({
  label,
  dot,
  tone,
  dateline,
}: {
  label: ReactNode;
  /* The state mark. Absent draws NO dot — an absent dot is a real answer here, and it must never
     be filled in with a grey placeholder that implies a reading nobody took. */
  dot?: EyebrowDot;
  /* "accent" tints the LABEL, which is how Live's comp carries the room with no dot at all. */
  tone?: "accent";
  /* The date this room is being read. Today, never fabricated, and only where a comp draws it. */
  dateline?: string;
}) {
  return (
    <span className="v2-eyebrow" data-tone={tone}>
      {dot != null && <span className={`v2-eyebrow-dot v2-eyebrow-dot-${dot}`} aria-hidden="true" />}
      {label}
      {dateline != null && (
        <>
          <span className="v2-eyebrow-sep" aria-hidden="true">
            ·
          </span>
          <span className="v2-eyebrow-date">{dateline}</span>
        </>
      )}
    </span>
  );
}

export default RoomEyebrow;
