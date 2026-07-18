import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — same pattern as voice-guard.test.ts.)

// Consumer-language / anti-hype guard (Measurement Platform 2.0, Task H — the "consumer-UI
// plain-language" guard). Section 3 of the train names an AVOID list of hype/jargon framings that
// betray the measurement brand — either overclaiming ("AI-powered", "guaranteed faster"), asserting
// a certainty Compy hasn't earned ("exact cause", "perfect match"), or printing a made-up number
// where only a band is honest ("optimization score", a "%% bottleneck" figure).
//
// This is a PHRASE guard, not a word guard, and that distinction is deliberate. The honest doctrine
// voice USES several of these words in negations that must survive — "not benchmark-grade proof",
// "not a magic boost", the rollback "Guarantee", a hardware-"universal" entry. Banning the bare word
// would punish the correct copy. So only exact hype phrases with zero legitimate use are listed; each
// was verified absent from src/ when this guard was written. It mirrors voice-guard.test.ts (retired
// defensive phrases) and the Rust-side no_verdict_note_ever_carries_a_numeric_confidence guard, which
// bans the same numeric-confidence framing on the experiment note. Confidence is a BAND, never a
// number (docs/METHODOLOGY.md §10).
//
// If this fails: rewrite in measured voice — cite what was measured and its evidence band, never a
// fabricated certainty or score. Do not add your phrase here to pass; that defeats the guard.
const BANNED_PHRASES = [
  "ai-powered", // the measurement brand proves; it does not wave an "AI" flag
  "ai powered",
  "guaranteed faster", // no unqualified performance promise (flagged in friendly-labels.ts as the anti-pattern)
  "exact cause", // correlation is not causation — a candidate to check, never "the exact cause"
  "perfect match", // sessions are "comparable"/"limited", never a "perfect match"
  "optimization score", // no invented composite number
  "% bottleneck", // e.g. "92% bottleneck" — a bottleneck is a band/verdict, not a percentage
  "100% faster", // fabricated magnitude
];

// Scan rendered app copy. Vendor components (third-party class names like `magic-bento-card`) and the
// guard files themselves are excluded — they don't carry consumer-facing product claims.
const EXCLUDE = /(\.test\.tsx?$)|(-guard\.tsx?$)|(\/vendor\/)|(voice-guard)/;

// Strip code comments before scanning: the guard targets USER-FACING copy, and a comment that NAMES
// the anti-pattern to warn future devs off it (e.g. friendly-labels.ts documents `no "guaranteed
// faster"`) is exactly the copy we want to keep, not flag. `//` is only treated as a comment when it
// is NOT part of a `://` scheme, so a URL inside a string literal doesn't swallow the rest of a line.
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments (not the // in http://)
}

describe("plain-language guard: hype/jargon framings stay out of app copy", () => {
  it("no banned hype phrase appears in src/ rendered copy", () => {
    const files = (readdirSync("src", { recursive: true }) as string[]).filter(
      (f) => /\.(tsx?)$/.test(f) && !EXCLUDE.test(f.replace(/\\/g, "/")),
    );
    const offenders: string[] = [];
    for (const rel of files) {
      const text = stripComments(readFileSync(join("src", rel), "utf8")).toLowerCase();
      for (const phrase of BANNED_PHRASES) {
        if (text.includes(phrase)) offenders.push(`${rel}: "${phrase}"`);
      }
    }
    expect(offenders, `hype/jargon phrase found — rewrite in measured voice:\n${offenders.join("\n")}`).toEqual(
      [],
    );
  });
});
