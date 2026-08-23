import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/* COMP FIDELITY — the owner's 2026-08-23 ruling, mechanised.
 *
 * He put the four approved four-room comps back on the table beside the installed build and said,
 * verbatim: "this is exactly how its supposed to look and it still isnt quite there ... what should
 * remain is the color coded system we have for alert levels such as green yellow red for optimal
 * metrics and notifications".
 *
 * Two things follow, and this file holds both.
 *
 * 1. THE COMPS ARE THE SPEC. Where a room's picture and my taste disagreed, I lost. The values
 *    below are SAMPLED out of the approved PNGs, not designed here and not guessed — the sampling
 *    numbers are in each test's comment so the next session can re-derive them instead of trusting
 *    a hex someone typed.
 * 2. THE LADDER SURVIVES. Green = good, amber = attention, violet = the room's accent. A later
 *    "let's make this consistent" pass must not quietly flatten one of those back to grey, and a
 *    later "let's unify the two rooms" pass must not erase a difference the comps draw on purpose.
 *
 * These are STATIC sheet reads on purpose: jsdom never loads these stylesheets, so no rendering
 * test can see a colour regression here — only the picture can, and the picture costs a build, an
 * install and a review round. This file is the cheap half of that loop.
 */

const read = (...p: string[]) => readFileSync(join(...p), "utf8");

/** Strip comments, then return the body of the first rule whose selector matches. */
function body(css: string, selector: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of clean.split("}")) {
    const [sel, decls] = block.split("{");
    if (sel == null || decls == null) continue;
    if (sel.trim().replace(/\s+/g, " ") === selector) return decls;
  }
  return "";
}

describe("comp fidelity — the primary action wears the ladder's good end (owner ruling 2026-08-23)", () => {
  const tokens = read("src", "design", "tokens-v2.css");
  const home = read("src", "surfaces", "home-console.css");
  const monitor = read("src", "surfaces", "monitor-console.css");

  it("--v2-cta is defined in the TOKEN layer, and is the green the comps actually use", () => {
    // Sampled from the approved PNGs with PIL: Health #2ecf86-#2fd087, History #28d582,
    // Test #2fcd82. One value, three renders — so the token is their centre, not a fourth guess.
    const m = tokens.match(/--v2-cta:\s*(#[0-9a-fA-F]{6})/);
    expect(m, "--v2-cta must live in tokens-v2.css — surface sheets may not carry a literal").not
      .toBeNull();
    const [, hex] = m!;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    // Green-dominant, and within a visible step of the sampled comps rather than "some green".
    expect(g, `${hex} must be green-dominant`).toBeGreaterThan(r + 60);
    expect(g).toBeGreaterThan(b + 40);
    expect(Math.abs(g - 0xd0), `${hex} is not the comps' green`).toBeLessThanOrEqual(0x12);
    expect(Math.abs(r - 0x2e)).toBeLessThanOrEqual(0x12);
  });

  it("Health's front door is GREEN — the violet it used to wear was overruled", () => {
    const b = body(home, ':root[data-v2="on"] .hc-front-door');
    expect(b, "the front-door rule moved or was renamed").toContain("background");
    expect(b).toMatch(/background:\s*var\(--v2-cta\)/);
    expect(b, "the border must follow the fill, or the button gets a violet outline").toMatch(
      /border:\s*1px solid var\(--v2-cta\)/,
    );
  });

  it("Live's Start capture stays VIOLET — the comps differ here ON PURPOSE", () => {
    // 02-live-approved.png fills this one button #a37ef9 while the other three rooms' actions are
    // green. That asymmetry is the owner's approved picture, not drift: a room whose action starts
    // a MEASUREMENT is not making the same promise as a room whose action offers help. Pinned so a
    // future consistency sweep has to argue with the comp instead of quietly unifying them.
    const b = body(monitor, ':root[data-v2="on"] .mc-start');
    expect(b).toMatch(/background:\s*var\(--v2-accent\)/);
    expect(b, "Live's action must NOT be greened along with the others").not.toContain("--v2-cta");
  });
});

describe("comp fidelity — the colour-coded alert ladder the owner asked to keep", () => {
  const monitor = read("src", "surfaces", "monitor-console.css");
  const reading = read("src", "design", "console", "reading.css");
  const home = read("src", "surfaces", "home-console.css");

  it("Live draws a missing sensor as the comp's AMBER pill", () => {
    // 02-live-approved.png: an amber outlined NO READING pill (sampled #ffd110) sitting beside four
    // green MEASURED pills. --v2-warn is the ladder's amber; the literal stays out of the sheet.
    const b = body(monitor, ':root[data-v2="on"] .mc-ev-sensors .rd-none');
    expect(b, "Live's no-reading cell lost its pill").not.toBe("");
    expect(b).toMatch(/border:\s*1px solid var\(--v2-warn\)/);
    expect(b).toMatch(/color:\s*var\(--v2-warn\)/);
    expect(b, "a pill is uppercase, like the MEASURED one it replaces").toMatch(
      /text-transform:\s*uppercase/,
    );
  });

  it("…and the KIT's own no-reading stays quiet, so Health keeps its treatment", () => {
    // The two approved comps genuinely disagree about this one cell, and the owner ruled that both
    // pictures are right. So the override is room-scoped and the shared instrument is untouched —
    // if this test ever fails, the amber leaked out of Live and into every room that places a
    // Reading, which is a change no comp asked for.
    const b = body(reading, ':root[data-v2="on"] .rd-none');
    expect(b, "the kit's quiet no-reading line is gone").not.toBe("");
    expect(b, "the shared instrument must not grow a border").not.toContain("border");
    expect(b).toMatch(/color:\s*var\(--v2-faint\)/);
  });

  it("the room eyebrows are colour-coded, each the way its own comp draws it", () => {
    // Health: grey label + a DOT that carries the state (amber on attention) — 01's dot sampled
    // #ffd847. Live: no dot at rest, and the LABEL itself in the accent — 02's glyphs sampled
    // #8d73e9. Both are "colour is information"; they just put the information in different places.
    expect(body(home, ':root[data-v2="on"] .hc-masthead-eyebrow')).toMatch(
      /color:\s*var\(--v2-faint\)/,
    );
    expect(body(home, ':root[data-v2="on"] .hc-led-warn')).toMatch(/background:\s*var\(--v2-warn\)/);
    expect(body(monitor, ':root[data-v2="on"] .mc-masthead-eyebrow')).toMatch(
      /color:\s*var\(--v2-accent-text, var\(--v2-accent\)\)/,
    );
  });
});

describe("comp fidelity — Health, matched against 01-health-approved.png", () => {
  const tokens = read("src", "design", "tokens-v2.css");
  const home = read("src", "surfaces", "home-console.css");
  const reading = read("src", "design", "console", "reading.css");
  const arc = read("src", "design", "console", "arc-gauge.css");

  it("the ladder is complete: green, amber AND red, each its own token", () => {
    // The owner's words were "green yellow red". The v2 layer had the first two and stopped, so a
    // genuinely bad reading had to borrow amber and read as merely noteworthy. --v2-bad is not a
    // new colour — it is --ix-danger (#f3716f), the red this app has always used, given a v2 name.
    const m = tokens.match(/--v2-bad:\s*(#[0-9a-fA-F]{6})/);
    expect(m, "--v2-bad must live in the token layer").not.toBeNull();
    const [, hex] = m!;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    expect(r, `${hex} must be red-dominant`).toBeGreaterThan(g + 60);
    expect(r).toBeGreaterThan(b + 60);
    // …and each grade tier resolves to its OWN rung. A future "simplify the tones" pass that
    // collapses two of these into one has flattened the thing the owner explicitly asked to keep.
    expect(body(arc, ':root[data-v2="on"] .ag-grade-good')).toMatch(/color:\s*var\(--v2-ok\)/);
    expect(body(arc, ':root[data-v2="on"] .ag-grade-warn')).toMatch(/color:\s*var\(--v2-warn\)/);
    expect(body(arc, ':root[data-v2="on"] .ag-grade-bad')).toMatch(/color:\s*var\(--v2-bad\)/);
  });

  it("the attention verdict is WHITE — the eyebrow dot carries the state, not the sentence", () => {
    // Sampled: the comp's "One thing needs your attention" is rgb(229,234,240), and the only amber
    // on that screen is the 6px dot beside RIG DIAGNOSTIC. An amber HEADLINE at 40px is the room
    // shouting; a dot is the room pointing. Both say the same thing and only one of them is calm.
    const b = body(home, ':root[data-v2="on"] .v2-verdict h1:has(.hc-verdict-attention)');
    expect(b, "the attention headline rule moved or was renamed").not.toBe("");
    expect(b).toMatch(/-webkit-text-fill-color:\s*var\(--v2-text\)/);
    expect(b, "the headline must not wear the warn token").not.toContain("--v2-warn");
  });

  it("Health's one action sits under its own sentence, not out at the far margin", () => {
    // `margin-left: auto` pushed the button to the right edge of the narrative column, where it
    // read as a dismissal ("OK") instead of an offer. The comp puts it flush left under the count.
    const b = body(home, ':root[data-v2="on"] .v2-room[data-room="home"] .v2-verdict-action');
    expect(b, "the Home action-placement rule is gone").not.toBe("");
    expect(b, "no auto margin — the action is left-aligned under the sub-line").not.toMatch(
      /margin-left:\s*auto/,
    );
  });

  it("a healthy number is WHITE with a green stamp beside it, never tinted", () => {
    // The comp draws 191 / 152 / 49°c in plain white and puts the colour in the MEASURED pill. The
    // accent tint on .rd-v made every good reading violet, which is the room's ACCENT — so a
    // healthy number and a linked control wore the same ink and neither meant anything.
    expect(reading, "the accent tint on a reading's value must stay deleted").not.toMatch(
      /\.rd-accent\s+\.rd-v\s*\{[^}]*color:/,
    );
    expect(body(reading, ':root[data-v2="on"] .rd-warn .rd-v')).toMatch(/color:\s*var\(--v2-warn\)/);
  });

  it("the rescue row's name is plain — the accent is on the ring and on Open", () => {
    // It used to be accent-coloured mono, which made a door out of Windows' crash log look like a
    // code identifier. The comp sets the name in white sans and colours the two parts that say
    // "this is a door": the life ring and the word Open.
    const label = body(home, ':root[data-v2="on"] .hc-care-label');
    expect(label).toMatch(/color:\s*var\(--v2-text\)/);
    expect(label, "a rescue door is not an identifier").not.toContain("mono");
    expect(body(home, ':root[data-v2="on"] .hc-care-open')).toMatch(
      /color:\s*var\(--v2-accent-text, var\(--v2-accent\)\)/,
    );
    expect(body(home, ':root[data-v2="on"] .hc-care-ico')).toMatch(
      /color:\s*var\(--v2-accent-text, var\(--v2-accent\)\)/,
    );
    // And the row is not a card: a border around it made it read as a fourth answer to the
    // question above, which it is not. A rule above it says "different thing" instead.
    expect(body(home, ':root[data-v2="on"] .hc-care')).toMatch(
      /border-top:\s*1px solid var\(--v2-line\)/,
    );
  });

  it("each symptom card carries its glyph in the room's accent", () => {
    expect(body(home, ':root[data-v2="on"] .hc-happening-ico')).toMatch(
      /color:\s*var\(--v2-accent-text, var\(--v2-accent\)\)/,
    );
    // The grey second line is body copy, not another instrument label — no tracking, no caps.
    const sub = body(home, ':root[data-v2="on"] .hc-happening-sub');
    expect(sub, "the card's description line is missing").not.toBe("");
    expect(sub).toMatch(/color:\s*var\(--v2-muted\)/);
    expect(sub).not.toContain("text-transform");
  });
});
