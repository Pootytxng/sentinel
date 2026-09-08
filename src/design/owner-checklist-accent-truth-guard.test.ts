import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { isSwatchHex, ROOM_ACCENT_SWATCHES, swatchKey } from "./room-identity";

// An owner decision may not describe a machine state the build cannot be in, or state a perishable
// reading as a durable fact.
//
// bug→guard, 2026-09-01. `docs/OWNER_ACTION_CHECKLIST.md` §D `D_health` asked the owner which accent
// the Health room should be judged at, on the premise that his desk ran theme `midnight` with Health
// at a bare Sky `#46a8ff`. Both halves were wrong, and the SAME pull request that filed the question
// had already made the second half impossible: `72f60387` froze the picker to five duo swatches, so
// every entry in `ROOM_ACCENT_SWATCHES` carries a `hex2`, `swatchKey()` returns `primary+secondary`,
// and a bare hex is no longer a key `isSwatchHex()` accepts — `readRoomAccents()` drops it and the
// room falls back to the default, which `room-identity.ts` says out loud in its own comment.
//
// The defect being guarded is NOT the stale sentence. It is that a decision could be put to the owner
// on a premise the build contradicts, with nothing mechanical to notice. A wrong decision costs more
// than no decision: he answers a question that does not exist, and the answer is then quoted as his
// ruling. Prose cannot fail a build, so the whitelist gets to check the prose.
//
// TWO RULES, and the second one is why this file exists at all rather than a one-line regex:
//
//   1. A sentence that names an accent AND a colour must name a colour the picker actually offers.
//   2. A sentence that asserts what the OWNER'S MACHINE is set to must carry a reading date.
//
// Rule 2 exists because the corrected row replaced one perishable claim with another. The accent is
// his to change; the moment he clicks a dot, any sentence stating it becomes false, and a checklist
// that reads as timeless truth will be quoted back months later as if it still held. Dating it makes
// the staleness visible to a reader instead of silent.
//
// WHAT THIS FILE DELIBERATELY DOES NOT PIN — raised by session `sentinel-21` reviewing the draft, and
// it was right: no measured VALUE appears in any assertion here. If the guard asserted `violet` or
// `#b6f24a+#35e0e8`, the owner clicking his own accent dot would turn the suite red on his machine,
// for a change he is entitled to make — a guard about honesty over accents, failing because someone
// used the accent picker. Shape is durable; the reading is not. Same principle as rule F's
// `commits === null` pin in `scripts/handoff-worktree-truth.test.mjs`: absence of measurement must
// never be able to manufacture a verdict.
//
// It also never reads `localStorage` or the WebView2 profile. A live reading is a reviewer's job over
// CDP; a vitest file cannot do it deterministically and must not pretend to.
const CHECKLIST = join("docs", "OWNER_ACTION_CHECKLIST.md");

// The escape hatch, greppable on purpose. A sentence may name a colour the picker no longer offers,
// or a state the machine is no longer in, as long as it SAYS so — which is the whole point: the
// reader learns the value is historical at the moment they read it, not three documents later.
//
// The past-tense half was added on a cross-session finding from `sentinel-21` working the same
// negation gap in the handoff guard (#295/#296): "an explanation that mentions a retired value looks
// identical to a filed decision that uses one." A doc has to be able to say what a colour USED to be
// — that is how the next reader understands why the decision changed — and a rule that forbade the
// past tense would push authors to delete the history instead of recording it.
//
// It stays narrow on purpose. The sentence this guard was written for — "your desk runs theme
// `midnight` with the Health accent set to Sky `#46a8ff`" — is present-tense and asserting, and
// matches none of these. If it ever does, the hatch has been widened too far, and the pin below is
// what says so.
const HISTORICAL =
  /no longer|not (?:a )?selectable|cannot be selected|before the freeze|pre-freeze|\bretired\b|\bdropped\b|\bwas\b|\bused to\b|\bfalls? back\b|\bfell back\b/i;

// A reading of the owner's machine, and when it was taken. Both are required together: a date with no
// reading verb is just a row's filing date, and a reading verb with no date is exactly the timeless
// assertion this rule exists to stop.
const READING = /\bmeasured\b|\bobserved\b|\breading\b|\bread (?:from|at|on|by)\b|\bas of\b|\bat the time\b/i;
const DATE = /\b20\d{2}-\d{2}-\d{2}\b/;

// A claim about the owner's own machine, as opposed to a statement about the product in general. The
// distinction matters: "the five swatches are …" is a catalogue and ages fine; "your desk runs …" is
// a measurement wearing a catalogue's clothes.
const MACHINE = /\byour\s+(?:desk|machine|pc|build|app|install)\b|\bhis\s+(?:desk|machine)\b|\bthe live app\b/i;
const ACCENT_SUBJECT = /\baccent\b|\btheme\b/i;

const HEX = /#[0-9a-f]{6}(?:\+#[0-9a-f]{6})*/gi;

/**
 * Sentences, bounded by markdown block edges as well as terminators, so a claim can never borrow its
 * excuse from a neighbouring bullet or the heading above it.
 */
export function sentences(markdown: string): string[] {
  return markdown
    .split(/\r?\n(?=\s*(?:[-*+]\s|#{1,6}\s))|\r?\n\s*\r?\n/)
    .flatMap((block) => block.split(/(?<=[.!?:])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Sentences that make a claim about an accent AND name a colour. Both halves, or it is not our business. */
export function accentColourClaims(markdown: string): { sentence: string; hexes: string[] }[] {
  return sentences(markdown)
    .map((sentence) => ({ sentence, hexes: [...(sentence.match(HEX) ?? [])].map((h) => h.toLowerCase()) }))
    .filter(({ sentence, hexes }) => hexes.length > 0 && ACCENT_SUBJECT.test(sentence));
}

/**
 * Rule 1. A named colour is honest when the whitelist accepts it as a persisted key, or when the
 * sentence admits it is historical. Anything else is a colour the owner is being asked to reason
 * about while the build would refuse it — the exact shape of the D_health defect.
 */
export function unofferedAccentColours(markdown: string): { sentence: string; hex: string }[] {
  const findings: { sentence: string; hex: string }[] = [];
  for (const { sentence, hexes } of accentColourClaims(markdown)) {
    if (HISTORICAL.test(sentence)) continue;
    for (const hex of hexes) if (!isSwatchHex(hex)) findings.push({ sentence, hex });
  }
  return findings;
}

/**
 * Rule 2. A sentence that says what the owner's machine is set to is a reading with a shelf life. It
 * must carry the date it was taken, or admit it is historical. No value is checked — only that the
 * claim says when it was true.
 */
export function undatedMachineClaims(markdown: string): string[] {
  return sentences(markdown).filter(
    (s) =>
      MACHINE.test(s) &&
      ACCENT_SUBJECT.test(s) &&
      !HISTORICAL.test(s) &&
      !(READING.test(s) && DATE.test(s)),
  );
}

describe("an owner decision may not name an accent the build would refuse", () => {
  // Every swatch carries a hex2 under the 2026-08 freeze, so a BARE primary is never a persisted key.
  // Deriving the fixture instead of hardcoding `#46a8ff` keeps the test true to the code: if singles
  // ever return, this goes red, and that is the correct signal — the guard's premise changed.
  const duo = ROOM_ACCENT_SWATCHES.find((s) => s.hex2);

  it("still catches the claim it was written for", () => {
    expect(duo, "the freeze put a hex2 on every swatch — if that ends, revisit this guard").toBeTruthy();
    const bare = duo!.hex;

    const filed = `Your desk runs the Health accent set to \`${bare}\`.`;
    expect(unofferedAccentColours(filed)).toHaveLength(1);
    expect(unofferedAccentColours(filed)[0].hex).toBe(bare.toLowerCase());

    const asKey = `Your desk runs the Health accent \`${swatchKey(duo!)}\` (measured 2026-09-01).`;
    expect(unofferedAccentColours(asKey)).toEqual([]);

    const admitted = `The Health accent \`${bare}\` is no longer selectable — the picker is frozen to five duos.`;
    expect(unofferedAccentColours(admitted)).toEqual([]);
  });

  it("lets a doc explain a retired colour without letting it file a decision in one", () => {
    // `sentinel-21`'s #296 finding, ported: history and instruction are the same shape to a regex, so
    // the rule separates them by framing rather than by whether a retired colour appears at all.
    const bare = duo!.hex;
    expect(unofferedAccentColours(`The Health accent was \`${bare}\` before the freeze.`)).toEqual([]);
    expect(unofferedAccentColours(`That accent used to be \`${bare}\`; the picker dropped it.`)).toEqual([]);

    // ...and the present-tense assertion this guard exists for is still caught. If this pin ever goes
    // green, the hatch above has been widened past the defect.
    expect(unofferedAccentColours(`Judge it at the Health accent \`${bare}\`.`)).toHaveLength(1);
  });

  it("minds only sentences that are actually about an accent", () => {
    // A colour named for any other reason is none of this guard's business. Without this the rule
    // would start failing on brand colours and screenshot notes, and a guard that cries wolf gets
    // muted rather than fixed.
    expect(unofferedAccentColours("The wordmark is drawn in `#a78bfa` on the download page.")).toEqual([]);
    expect(unofferedAccentColours("No colour is named in this sentence about the accent picker.")).toEqual([]);
  });

  it("reads composite keys, so the honest form always passes", () => {
    // Every swatch that ships must survive being quoted into the checklist by its real key. This is
    // what keeps the guard true as the palette changes, rather than pinned to today's five.
    for (const s of ROOM_ACCENT_SWATCHES) {
      expect(unofferedAccentColours(`Health accent \`${swatchKey(s)}\` — ${s.name}, measured 2026-09-01.`)).toEqual([]);
    }
  });
});

describe("a reading of the owner's machine must say when it was read", () => {
  it("catches the timeless assertion, and clears the same claim once it is dated", () => {
    expect(undatedMachineClaims("Your desk runs theme `midnight` with the Health accent set to Sky.")).toHaveLength(1);

    // Neither half alone is enough — a bare date is a filing date, a bare verb is still timeless.
    expect(undatedMachineClaims("Your desk runs theme `midnight`, measured on a Tuesday.")).toHaveLength(1);
    expect(undatedMachineClaims("Your desk runs theme `midnight` (2026-09-01).")).toHaveLength(1);

    expect(
      undatedMachineClaims("Measured 2026-09-01 by an independent session reading the live app — theme `violet`."),
    ).toEqual([]);
  });

  it("leaves alone statements about the product rather than about his machine", () => {
    // The catalogue ages fine; only a reading of one particular PC goes stale on a click.
    expect(undatedMachineClaims("The accent picker offers five duo swatches.")).toEqual([]);
    expect(undatedMachineClaims("Health defaults to its own accent when no pick is stored.")).toEqual([]);
    // A machine claim about something other than colour is some other guard's problem, not this one's.
    expect(undatedMachineClaims("The v0.9.9 build previously ran on your machine.")).toEqual([]);
  });

  it("does not let a neighbouring sentence supply the date", () => {
    // The block-aware split is the point: an excuse has to live in the claim it excuses, or every
    // dated row in the file would launder every undated claim beneath it.
    const twoBullets = "- Measured 2026-09-01 across the rooms.\n- Your desk runs the Health accent at Sky.";
    expect(undatedMachineClaims(twoBullets)).toHaveLength(1);
  });
});

describe("the live owner checklist", () => {
  const markdown = readFileSync(CHECKLIST, "utf8");

  it("names no accent colour the picker would refuse", () => {
    const findings = unofferedAccentColours(markdown);
    expect(
      findings,
      `${CHECKLIST} asks the owner about an accent this build would drop:\n` +
        findings.map((f) => `  - ${f.hex} in: ${f.sentence}`).join("\n") +
        "\nName it by its persisted key (primary+secondary), or say in the same sentence that it is no longer offered.",
    ).toEqual([]);
  });

  it("states no machine accent or theme without the date it was read", () => {
    const findings = undatedMachineClaims(markdown);
    expect(
      findings,
      `${CHECKLIST} states what the owner's machine is set to as if it were permanent:\n` +
        findings.map((s) => `  - ${s}`).join("\n") +
        "\nHis accent is his to change. Carry the reading date in the same sentence, or frame it as historical.",
    ).toEqual([]);
  });
});
