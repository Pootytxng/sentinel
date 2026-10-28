import type { ReactNode } from "react";
import { Term } from "./Term";

/** Review 2026-10-28 (P7-jargon): engine sentences reach the screen as plain text ("1% lows fell
 *  15.5%", "noise floor ±3%"). Gloss the terms inside them the way hand-written copy does, so no bare
 *  term reaches the reader; everything else is the text exactly as given. */
const TERM_IDS: [RegExp, string][] = [
  [/^1% lows?$/i, "one-percent-lows"],
  [/^noise floor$/i, "noise-floor"],
];
const SPLIT = /(\b1% lows?\b|\bnoise floor\b)/i;

export function withTerms(text: string): ReactNode {
  const parts = text.split(new RegExp(SPLIT.source, "gi"));
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    const id = TERM_IDS.find(([re]) => re.test(part))?.[1];
    return id ? (
      <Term key={i} id={id}>
        {part}
      </Term>
    ) : (
      part
    );
  });
}
