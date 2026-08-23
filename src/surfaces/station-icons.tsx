import type { ReactNode } from "react";
import type { LabStationKey } from "./lab-guided-data";

/* THE TEST ROOM'S STATION MARKS (issue #49, self-review round 15 finding 3).
 *
 * These were raw platform emoji — ⛭ 📋 📈 ⚡ 🌡 🗃 — which Windows renders in its own colours
 * (orange, blue, grey) on a screen the handoff says carries no gamer-RGB, and which change shape
 * on every OS besides. 04-test-approved.png draws six MONOCHROME LINE MARKS instead, and every
 * shape and colour below was read out of that PNG rather than chosen here:
 *
 *   row 1  y471-502  w31 h32  peak (178,149,249)  two concentric rings  → optimize    (target)
 *   row 2  y537-566  w23 h30  peak (211,222,236)  clipboard + 3 lines   → diagnostics
 *   row 3  y603-629  w29 h27  peak (205,223,237)  framed zigzag trace   → benchmark
 *   row 4  y667-696  w21 h30  peak (199,210,223)  bolt outline          → latency
 *   row 5  y732-759  w27 h28  peak (206,224,243)  three rails + knobs   → tuning
 *   row 6  y795-824  w31 h30  peak (215,224,242)  life ring + spokes    → blackbox
 *
 * TWO facts in that table are the ones a later pass must not flatten:
 *
 * 1. ONLY THE PRIMARY ROW IS VIOLET. Row 1's peak is the accent — the same (178,137,242) the
 *    comp's "Add a part" row wears — and rows 2-6 are the neutral text colour. The self-review
 *    called for six violet marks; the comp draws one, and one is the honest number, because on
 *    this screen the accent is what says "this is the door to start with". Six of them would say
 *    it six times and therefore not at all.
 * 2. THE SIZE IS ~29 APP PX. The comps are 1550px renders of a 1500px design, so every measurement
 *    above divides by 1.0333: h 30 comp px → 29 app px. Drawn at 28 in a 24 viewBox with a 1.6
 *    stroke, which is the 2-comp-px stroke the PNG actually has.
 *
 * Presentation only — nothing here gates behaviour, and `currentColor` means the colour decision
 * stays in CSS where the token layer can see it.
 */

const S = {
  width: 28,
  height: 28,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export const STATION_ICON: Record<LabStationKey, ReactNode> = {
  // Two rings, no crosshair — the comp's inner ring measures 0.53 of the outer.
  optimize: (
    <svg {...S}>
      <circle cx="12" cy="12" r="10.6" />
      <circle cx="12" cy="12" r="5.6" />
    </svg>
  ),
  // The report you read: body, clip, and three ruled lines — the last one short, as the comp
  // draws it (a half-length line is what makes a stack of rules read as writing).
  diagnostics: (
    <svg {...S}>
      <rect x="4.4" y="4.4" width="15.2" height="17.4" rx="2.4" />
      <path d="M9.4 4.4V3.7a2.6 2.6 0 0 1 5.2 0v.7" />
      <path d="M9 11h7" />
      <path d="M9 15h7" />
      <path d="M9 19h3.6" />
    </svg>
  ),
  // A trace inside a frame: two peaks, not a rising line. Benchmark measures a SHAPE over time,
  // and a line that only goes up would be a claim about the result.
  benchmark: (
    <svg {...S}>
      <rect x="4.2" y="4.2" width="15.6" height="15.6" rx="1.6" />
      <path d="M7 15.5 10.3 11.4 13.2 15.5 16.6 11.4" />
    </svg>
  ),
  // The bolt is an OUTLINE in the comp, not a filled glyph — top point, right notch, bottom
  // point, left notch.
  latency: (
    <svg {...S}>
      <path d="M13.2 2.4 4 14.2h7.4L10.8 21.6 20 9.8h-7.4z" />
    </svg>
  ),
  // Three rails, one knob each, at three different heights — the comp's knobs sit low, high and
  // middle, which is the whole point of drawing sliders rather than three plain lines.
  tuning: (
    <svg {...S}>
      <path d="M5.6 3v18M12 3v18M18.4 3v18" />
      <rect x="3.2" y="14.2" width="4.8" height="4.8" rx="1" />
      <rect x="9.6" y="6.2" width="4.8" height="4.8" rx="1" />
      <rect x="16" y="10.2" width="4.8" height="4.8" rx="1" />
    </svg>
  ),
  // A life ring. The black box is the room you reach for after something went wrong, and the comp
  // picked the one mark on this screen that says "recovery" instead of "storage".
  blackbox: (
    <svg {...S}>
      <circle cx="12" cy="12" r="10.4" />
      <circle cx="12" cy="12" r="4.4" />
      <path d="m4.6 4.6 4.3 4.3M15.1 15.1l4.3 4.3M19.4 4.6l-4.3 4.3M8.9 15.1l-4.3 4.3" />
    </svg>
  ),
};

export default STATION_ICON;
