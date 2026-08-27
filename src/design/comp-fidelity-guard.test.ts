import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
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
  const shell = read("src", "design", "shell-v2.css");
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

  it("the shared primary action is GREEN — the violet it used to wear was overruled", () => {
    // Asserted on `.v2-primary` in the SHELL sheet, not on Health's own `.hc-front-door`: three
    // rooms draw this same control (Health's front door, History's "Review latest session",
    // Test's run action) and a colour ruling copied into three surface sheets is a ruling that
    // will drift in two of them. Health's button carries both classes; the class check below is
    // what keeps this guard pointed at the affordance the owner actually looked at.
    const b = body(shell, ':root[data-v2="on"] .v2-primary');
    expect(b, "the primary-action rule moved or was renamed").toContain("background");
    expect(b).toMatch(/background:\s*var\(--v2-cta\)/);
    expect(b, "the border must follow the fill, or the button gets a violet outline").toMatch(
      /border:\s*1px solid var\(--v2-cta\)/,
    );
    expect(
      read("src", "surfaces", "HomeConsole.tsx"),
      "Health's front door must wear the shared primary, or this ruling stops reaching it",
    ).toMatch(/className="hc-front-door v2-primary"/);
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
    // ONE rule since slice 7 (src/design/room-eyebrow.tsx carries the four-comp measurements).
    // Colour stays per-room because THERE it is information: Health and Test put the state in the
    // DOT — 01's sampled #ffd847 — while Live draws no dot at rest and tints the LABEL instead,
    // 02's glyphs sampled #8d73e9. Same element, two honest places to put one fact.
    const eyebrow = read("src", "design", "shell-v2.css");
    const b = body(eyebrow, ':root[data-v2="on"] .v2-eyebrow');
    expect(b, "the shared eyebrow rule went missing").not.toBe("");
    expect(b).toMatch(/color:\s*var\(--v2-muted\)/);
    expect(body(eyebrow, ':root[data-v2="on"] .v2-eyebrow[data-tone="accent"]')).toMatch(
      /color:\s*var\(--v2-accent-text, var\(--v2-accent\)\)/,
    );
    expect(body(eyebrow, ':root[data-v2="on"] .v2-eyebrow-dot-warn')).toMatch(
      /background:\s*var\(--v2-warn\)/,
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

describe("comp fidelity — Live, matched against 02-live-approved.png", () => {
  const monitor = read("src", "surfaces", "monitor-console.css");
  const en = JSON.parse(read("src", "i18n", "locales", "en", "monitor.json"));

  it("the cross-game caveat is quiet copy, not a fourth cell", () => {
    const b = body(monitor, ':root[data-v2="on"] .mc-delta-note');
    expect(b, "the cross-game caveat lost its rule").not.toBe("");
    expect(b).toMatch(/color:\s*var\(--v2-faint\)/);
    expect(b, "a pill here reads as another delta cell").not.toContain("border");
  });

  it("the honesty line keeps BOTH facts the comp's shorter wording could have cost", () => {
    // The comp draws "Watched from outside your game · no hooks or injected overlay." — that
    // phrasing is adopted. What is NOT adopted is dropping the rest: the no-driver fact (LOCKED
    // rule 1 — the current build ships no driver) and the anti-cheat promise (LOCKED rule 2) are
    // the reason this line exists at all, and a picture is not a reason to delete a claim a user
    // makes decisions on. Logged as a deviation; pinned here so it cannot be "tidied" later.
    const post: string = en.monitorConsole.etwHonestyPost;
    expect(post, "the comp's wording").toContain("no hooks or injected overlay");
    expect(post, "the no-driver fact").toMatch(/driver/i);
    expect(post, "the anti-cheat promise").toMatch(/anti-cheat/i);
  });
});

/* THE SHELL GEOMETRY ALL FOUR COMPS SHARE.
 *
 * Every number below is measured off the approved PNGs and divided by the calibrated scale. The
 * comps are 1550px-wide renders of a 1500px design — proven two independent ways: the rail measures
 * 223 comp px against our 216px token, and Live's headline cap measures 29 comp px against our
 * --type-verdict 40px face. Both ratios land on 1550/1500 = 1.0333, so a comp measurement is an app
 * measurement divided by that. Anything here quoting a comp px also quotes the app px it becomes.
 *
 * COLOUR IS DELIBERATELY NOT CHASED HERE. The PNGs are uniformly contrast-lifted (their page ground
 * samples #11161e against our --v2-bg #0a0c10, their headline pure #ffffff against --v2-text
 * #e8ebf2). Because the BACKGROUND is lifted along with the ink, that is a gamma difference in the
 * render, not a different palette — matching it would mean typing literals into token slots, which
 * tokens-v2-guard forbids for exactly this reason. Geometry is what the comps can be trusted on.
 */
describe("comp fidelity — the shell geometry all four comps share", () => {
  const shell = read("src", "design", "shell-v2.css");
  const tokens = read("src", "design", "tokens-v2.css");
  const scale = read("src", "design", "type-scale.css");

  it("the topbar still names the room — two of the four comps print it there", () => {
    // bug→guard, and the bug was mine: the 2026-08-22 pass deleted this element citing "all four
    // comps draw it empty", which is false. 01-health-approved.png prints "Health" in the topbar
    // and 04-test-approved.png prints "Test"; only Live's and History's are empty. A guard that
    // pins a misreading is worse than no guard, so this one pins the re-measured fact instead.
    expect(shell, "the room-title rule went missing again").toContain(".v2-room-title");
    expect(
      shell,
      "measured at a 12px cap = --type-card, not the --type-label it once carried",
    ).toMatch(/\.v2-room-title \{[^}]*font-size: var\(--type-card\)/);
  });

  it("the content box is the comps' box at 1500, and still a box on a wide display", () => {
    // All four comps put content between x=286 and x=1494 of 1550 — a 1208px box = 1169 app px,
    // re-measured 2026-08-27 off 04-test-approved.png's own panel border at 1161.
    //
    // This was `max-width: 1160px` until the 2026-08-27 review failed 1920x1080 outright: a fixed
    // cap reproduces the comps at the width they were drawn and strands every wider display in a
    // centred island with ~267px of dead margin each side. What the comps actually hold constant
    // is the gutter as a SHARE of what the rail leaves, so the cap is a percentage with a px
    // ceiling behind it — the ceiling still being the reason the cap exists at all, that a 1920
    // window may not stretch a 46-character sentence across 1600px.
    //
    // The arithmetic that this still lands the comps' box at 1500 and grows at 1920 lives in
    // src/design/content-width-guard.test.ts, which resolves the rule the way the browser does.
    // Here we only pin that it did not quietly go back to being a bare pixel width.
    expect(body(shell, ':root[data-v2="on"] .v2-content-wrap')).toMatch(
      /max-width:\s*min\([\d.]+%,\s*\d+px\)/,
    );
  });

  it("the topbar is the comps' 50px", () => {
    // Ruled at y=41..93 under a 41px window titlebar: 52 comp px = 50 app px. It was 46.
    expect(body(shell, ':root[data-v2="on"] .v2-top')).toMatch(/height:\s*50px/);
  });

  it("the evidence column is TWO families, not one number", () => {
    // Measured aside share: Health 55%, Test 58% — both PANELLED rooms, where the evidence sits in
    // a bordered box. Live 68%, History 70% — both WIDE rooms, where it runs on the page ground.
    // One token could not serve both without being wrong twice, and the split is a room family, not
    // a viewport width, so it is keyed off [data-room] and needs no breakpoint (the handoff forbids
    // breakpoints outright).
    expect(tokens, "the panelled default").toMatch(/--v2-aside:\s*min\(680px,\s*56\.5%\)/);
    expect(shell, "the wide pair").toMatch(
      /\[data-room="learn"\],\s*\n[^{]*\[data-room="play"\] \{\s*\n\s*--v2-aside: min\(830px, 69%\);/,
    );
  });

  it("the hero headline belongs to the panelled rooms, and only to them", () => {
    // Headline cap heights: Health 38–40 comp px and Test the same — a 52px face. Live and History
    // measure 29–30 — the 40px --type-verdict this shell already had. Same two families as the
    // aside above, for the same reason: a 460px story column can carry 52px, a 300px one cannot.
    expect(scale, "the seventh step").toMatch(/--type-hero:\s*52px/);
    expect(shell).toMatch(
      /\[data-room="home"\] > \.v2-verdict h1,\s*\n[^{]*\[data-room="lab"\] > \.v2-verdict h1 \{\s*\n\s*font-size: var\(--type-hero\);/,
    );
    expect(shell, "the wide pair must NOT be promoted with them").not.toMatch(
      /\[data-room="learn"\][^{]*\{[^}]*font-size: var\(--type-hero\)/,
    );
  });

  it("a column verdict may never wrap — the wrap that hid Health's subhead", () => {
    // bug→guard (self-review 2026-08-23, item 5 — the most severe finding of that round, and one
    // no green test could have caught: it is a LAYOUT fact, and jsdom has no layout engine).
    //
    // THE DEFECT. `.v2-verdict` is a baseline ROW in the linear rooms and carries `flex-wrap: wrap`
    // so a long headline cannot shove the action off the edge. The split rooms flip it to a COLUMN
    // and inherited that wrap, where it means something completely different: a wrapping column
    // flex container contributes the height of its TALLEST CHILD, not the sum of its children, so
    // the auto grid row sized itself to the h1 alone and every later child wrapped into a phantom
    // second COLUMN — off the story column, occluded behind the evidence panel. Health's subhead
    // measured x=749.6 w=158.6 on the installed build, outside its own parent's box of x=265..721.
    // It stayed invisible for four slices because it only bites once a headline passes two lines.
    //
    // THE GUARD IS THE CLASS, NOT THE INSTANCE. Any future rule that turns a wrap-carrying flex
    // element into a column has the same bug waiting in it, so this scans for the shape rather
    // than the one selector: collect every class this sheet declares `flex-wrap: wrap` on, then
    // require an explicit `nowrap` from every later rule that puts one of them in a column.
    const clean = shell.replace(/\/\*[\s\S]*?\*\//g, "");
    const blocks = clean
      .split("}")
      .map((b) => b.split("{"))
      .filter((p): p is [string, string] => p.length === 2)
      .map(([sel, decls]) => [sel.trim().replace(/\s+/g, " "), decls] as const);

    const wrapping = new Set<string>();
    for (const [sel, decls] of blocks) {
      if (!/flex-wrap:\s*wrap/.test(decls)) continue;
      for (const cls of sel.match(/\.[a-zA-Z0-9_-]+(?![^ ,>+~]*[({])/g) ?? []) wrapping.add(cls);
    }
    expect(wrapping.size, "the sheet stopped wrapping anything — re-read this guard").toBeGreaterThan(0);

    const unguarded = blocks
      .filter(([sel, decls]) => {
        if (!/flex-direction:\s*column/.test(decls)) return false;
        if (/flex-wrap:/.test(decls)) return false;
        // (index arithmetic, not `.at(-1)` — this repo's lib target predates it, and vitest
        // transpiles per file so only `npm run build` ever says so.)
        const classes = sel.match(/\.[a-zA-Z0-9_-]+/g) ?? [];
        const last = classes.length > 0 ? classes[classes.length - 1] : undefined;
        return last != null && wrapping.has(last);
      })
      .map(([sel]) => sel);

    expect(
      unguarded,
      "a column flex container inheriting `flex-wrap: wrap` contributes only its tallest child's " +
        "height, so the rest of its children wrap out of the layout. Declare `flex-wrap: nowrap`.",
    ).toEqual([]);

    // ...and the one it actually bit, named, so a rewrite of the scan above can never quietly
    // stop covering the case it was written for.
    // (`body()` cannot be used here: this selector is declared TWICE — once for its grid area and
    // once for its flex composition — and that helper returns the first match, which is the wrong
    // one. Read the column block specifically.)
    const columnVerdict = blocks.find(
      ([sel, decls]) =>
        sel === ':root[data-v2="on"] .v2-room[data-layout="split"] > .v2-verdict' &&
        /flex-direction:\s*column/.test(decls),
    );
    expect(columnVerdict, "the split verdict stopped being a column — re-read this guard").toBeDefined();
    expect(columnVerdict![1]).toMatch(/flex-wrap:\s*nowrap/);
  });

  it("the primary action stands off the sentence it answers", () => {
    // 29 app px of air under Health's sub before its button, 41 under History's. The flex gap
    // alone was 12, which is why the installed build had the button crowding its own sentence.
    expect(
      body(shell, ':root[data-v2="on"] .v2-room[data-layout="split"] > .v2-verdict .v2-verdict-action'),
    ).toMatch(/margin-top:\s*16px/);
  });
});

describe("comp fidelity — Test, matched against 04-test-approved.png", () => {
  const lab = read("src", "surfaces", "lab-console.css");
  const dock = read("src", "design", "console", "dock.css");
  const en = JSON.parse(read("src", "i18n", "locales", "en", "lab.json"));

  it("the bench is a PANEL, because Test is one of the two panelled rooms", () => {
    // Measured: the bench runs x=765.5..1439.4 of the 277..1439 content box -- 58% of it, against
    // Health's 55%, which is why --v2-aside is one token for the panelled pair and a second for
    // the wide pair rather than one number that is wrong twice. The panel's own edge is what tells
    // the eye where the story stops; Live and History get a hairline in the gutter instead.
    const bench = body(lab, ':root[data-v2="on"] .lc-bench');
    expect(bench).toMatch(/background: var\(--v2-panel\)/);
    expect(bench).toMatch(/border: 1px solid var\(--v2-line\)/);
    expect(bench).toMatch(/border-radius: var\(--v2-r\)/);
  });

  it("the readings are RULED apart, not spaced apart", () => {
    // The comp draws a dotted hairline between each pair of cells and no gutter at all. It is the
    // difference between four loose numbers and one instrument with four faces. A `gap` here would
    // also push every rule half a gutter off its own centre line, so the cells carry the padding.
    // Measured off the comp 2026-08-26: the rule is INSET, not full-height -- a bright pixel every
    // third row from y745 to y875 of a strip spanning y704..928. A border cannot be shortened, so
    // the hairline moved to a pseudo-element; the fact being pinned is unchanged.
    expect(body(lab, ':root[data-v2="on"] .lc-reading + .lc-reading::before')).toMatch(
      /border-left: 1px dotted var\(--v2-line\)/,
    );
    expect(body(lab, ':root[data-v2="on"] .lc-readings'), "a gutter would decentre the rules").toMatch(
      /gap: 0/,
    );
  });

  it("the primary action is shrink-to-fit at the comp's 44px, never a column-wide bar", () => {
    // 262 x 44 app px, measured. Fill, ink and focus ring all come from the shared `.v2-primary`
    // (the owner overruled the violet these buttons used to wear); only the box is local.
    expect(body(lab, ':root[data-v2="on"] .lc-start')).toMatch(/min-height: 44px/);
    expect(body(lab, ':root[data-v2="on"] .lc-start'), "shrink-to-fit means no width").not.toMatch(
      /(^|[^-])width:/,
    );
  });

  it("the stations are a ruled LIST here and a grid everywhere else", () => {
    // Six equal tiles read as "six things you have to choose between" -- the room's standing
    // intimidation complaint. Ruled rows read as a list you can scan, with one row marked as the
    // way in. Home passes no layout prop and must never enter this block.
    const list = body(dock, ':root[data-v2="on"] .dock[data-layout="list"] .dock-node');
    expect(list).toMatch(/border: 0/);
    expect(list).toMatch(/border-bottom: 1px solid/);
    expect(body(dock, ':root[data-v2="on"] .dock[data-layout="list"]')).toMatch(/display: block/);
  });

  it("the room's own copy is the comp's, and the safety line is the comp's padlocked sentence", () => {
    const n = en.labConsole.narrative;
    expect(n.eyebrow).toBe("Proving ground");
    expect(n.headline).toBe("Test one change at a time");
    expect(n.action).toBe("Start with Optimize");
    expect(n.safety).toContain("One reversible change");
    // ...and the room's h1 still carries no count, which is the half of the retired title-header
    // law that was protecting something real.
    expect(n.headline).not.toMatch(/\d/);
  });
});

describe("comp fidelity — History, matched against 03-history-approved.png", () => {
  const shell = read("src", "design", "shell-v2.css");
  const tape = read("src", "surfaces", "blackbook", "blackbook-console.css");
  const room = read("src", "surfaces", "blackbook-v2.css");

  it("the record is a DOCUMENT, not a wall of cards", () => {
    // The single biggest difference between the installed build and the comp. Every record used to
    // be a bordered, filled, rounded card; the comp draws bare rows separated by one hairline, the
    // way a bank statement is drawn. Cards say "twelve things to deal with"; ruled rows say "a
    // list you can scan" — which is the standing "Compy is overwhelming" complaint, in one room.
    const b = body(tape, ':root[data-v2="on"] .bc-row');
    expect(b, "the row rule went missing").not.toBe("");
    expect(b, "a row may not draw a box").toMatch(/border:\s*0/);
    expect(b, "one hairline is the whole separator").toMatch(
      /border-bottom:\s*1px solid var\(--ix-glass-border\)/,
    );
    expect(b, "a filled row is a card again").not.toMatch(/\bbackground:/);
  });

  it("the month head is a ruled label, not a card title", () => {
    const b = body(tape, ':root[data-v2="on"] .bc-month-h');
    expect(b).toMatch(/border-bottom:\s*1px solid var\(--ix-glass-border\)/);
    expect(b).toMatch(/text-transform:\s*uppercase/);
  });

  it("the divider beside the record is HISTORY's alone — Live draws a panel there", () => {
    // Both rooms show a vertical at the same place, and reading Live's as a divider is a mistake
    // this file already made once: 02-live-approved.png's x=672 line is the left EDGE of a
    // bordered, filled, rounded panel, while 03-history-approved.png's x=647 is a bare hairline in
    // the gutter with the tape starting 26px past it. Keying both off one rule drew Live a
    // duplicate border down the inside of its own panel.
    expect(shell).toMatch(
      /\[data-room="learn"\] > \.v2-room-aside \{\s*\n\s*border-left: 1px solid var\(--v2-line\);/,
    );
    expect(shell, "Live must not be given the hairline again").not.toMatch(
      /\[data-room="play"\] > \.v2-room-aside \{\s*\n\s*border-left:/,
    );
  });

  it("the narrative column opens on a dotted mono label", () => {
    // The rule converged into the shell in slice 7; what is History's OWN here is the violet
    // dot, which every other room draws in a different colour or not at all.
    const eyebrow = read("src", "design", "shell-v2.css");
    const b = body(eyebrow, ':root[data-v2="on"] .v2-eyebrow');
    expect(b, "the eyebrow rule went missing").not.toBe("");
    expect(b).toMatch(/font-family:\s*var\(--v2-font-mono\)/);
    expect(b).toMatch(/text-transform:\s*uppercase/);
    // The dot is the room accent — the one violet on a screen whose action is green.
    expect(body(eyebrow, ':root[data-v2="on"] .v2-eyebrow-dot-accent')).toMatch(
      /background:\s*var\(--v2-accent\)/,
    );
  });

  it("the quiet routes are text and a chevron, never a second button", () => {
    // The room has exactly ONE filled action. An outlined control under it reads as a choice
    // between two equals, which is precisely what the comp is not drawing.
    const b = body(room, ':root[data-v2="on"] .bbv2-route');
    expect(b, "the route rule went missing").not.toBe("");
    expect(b).toMatch(/border:\s*0/);
    expect(b).toMatch(/background:\s*transparent/);
    // ...and it still takes a visible focus mark, because it is still a button (focus-ring law).
    expect(room).toMatch(/\.bbv2-route:focus-visible \{[^}]*outline:\s*2px/);
  });
});

/* ══ CASCADE FIDELITY (self-review round 15, 2026-08-23) ══════════════════════════════════════
 *
 * Round 15 found two SEVERE regressions and neither was a missing declaration. Both were cascade
 * ties, which is precisely what a source-text guard cannot see:
 *
 *   1. shell-v2.css declared `flex-wrap: nowrap` on the split verdict. home-console.css declared
 *      `flex-wrap: wrap` on `[data-room="home"] .v2-verdict` at the SAME (0,5,0) specificity and
 *      loaded later, so it won. Health's because-line rendered at x=749.6 with its parent's box
 *      ending at x=721.6 — off the story column, clipped behind the rig. Round 14's guard read
 *      shell-v2.css's text, found "nowrap", and passed while the app stayed broken.
 *   2. hud-rooms.css's generic `:not([data-room="home"]):not([data-room="check"])` verdict rules
 *      were (0,7,1) against the shell's room-scoped (0,6,1). Test's h1 rendered 26px where its
 *      comp measures 52 — and Live's and History's did too, unmeasured, for two whole slices.
 *
 * So these read EVERY stylesheet in the tree and ask a different question: not "is the right
 * declaration written somewhere" but "can anything else reach this element and win". A rule that
 * is allowed to reach the four approved rooms has to say so out loud.
 */
const CSS_FILES: string[] = (() => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".css")) out.push(p);
    }
  };
  walk("src");
  return out;
})();

/** Every rule in a sheet as [selector, declarations], comments stripped, whitespace collapsed. */
function rulesOf(css: string): Array<[string, string]> {
  // Comments out, then at-rule PRELUDES out (`@media ... {`), so an at-rule's opening brace can
  // never be mistaken for a rule's. The stray closing brace it leaves behind splits into a
  // fragment with no "{" and is skipped below.
  const clean = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@[a-zA-Z-]+[^{}]*\{/g, "");
  const out: Array<[string, string]> = [];
  for (const block of clean.split("}")) {
    const i = block.indexOf("{");
    if (i < 0) continue;
    out.push([block.slice(0, i).trim().replace(/\s+/g, " "), block.slice(i + 1)]);
  }
  return out;
}

/** The four rooms the approved comps govern. `fix` and `check` still wear the HUD register. */
const APPROVED_ROOMS = ["home", "play", "learn", "lab"];

describe("cascade fidelity — the shell owns the four approved rooms' verdict", () => {
  it("nothing outside the shell may re-wrap a split verdict", () => {
    // The exact defect: a column flex container that wraps contributes the height of its TALLEST
    // CHILD instead of the sum, so the auto grid row sizes to the h1 alone and every later child
    // wraps into a phantom second column. It only bites once a headline passes two lines, which is
    // why four review rounds walked past it.
    const offenders: string[] = [];
    for (const file of CSS_FILES) {
      // shell-v2.css owns BOTH sides of this: the linear rooms' wrapping baseline row and the
      // split rooms' nowrap column, in that order, in one file where the order is visible.
      if (file.endsWith("shell-v2.css")) continue;
      for (const [sel, decls] of rulesOf(readFileSync(file, "utf8"))) {
        if (!/\.v2-verdict(?![\w-])/.test(sel)) continue;
        // `flex-flow: column wrap` is the SAME declaration in shorthand and was invisible here.
        // `wrap-reverse` wraps too, so the token match is deliberately `wrap` with a word boundary
        // on the left only — `nowrap` is excluded by requiring the value not to be preceded by "no".
        const wraps =
          /flex-wrap:\s*wrap\b/.test(decls) ||
          /flex-flow:\s*[^;}]*(?<!no)\bwrap\b/.test(decls);
        if (!wraps) continue;
        if (sel.includes(':not([data-layout="split"])')) continue;
        offenders.push(`${file}: ${sel}`);
      }
    }
    expect(
      offenders,
      "a rule outside shell-v2.css can wrap a split verdict — scope it :not([data-layout=\"split\"])",
    ).toEqual([]);
  });

  it("no rule outside the shell may size the four approved rooms' verdict type", () => {
    const offenders: string[] = [];
    for (const file of CSS_FILES) {
      if (file.endsWith("shell-v2.css") || file.endsWith("type-scale.css")) continue;
      for (const [sel, decls] of rulesOf(readFileSync(file, "utf8"))) {
        if (!/\.v2-verdict/.test(sel)) continue;
        // A room never had to write `font-size` to resize the headline: redeclaring the scale token
        // the shell reads — `--type-hero: 26px` on its own verdict — moves it just as far, and the
        // direct-declaration check never saw it. Both spellings are the same defect.
        const sizesType =
          /(^|[;{\s])font(-size)?:/.test(decls) || /(^|[;{\s])--type-[\w-]+\s*:/.test(decls);
        if (!sizesType) continue;
        // Saying "not the split composition" out loud is the whole ask.
        if (sel.includes(':not([data-layout="split"])')) continue;
        // A rule that positively names a room OUTSIDE the approved four is that room's own call.
        const positive = sel.replace(/:not\([^)]*\)/g, "");
        const named = [...positive.matchAll(/\[data-room="([a-z]+)"\]/g)].map((m) => m[1]);
        if (named.length > 0 && named.every((r) => !APPROVED_ROOMS.includes(r))) continue;
        offenders.push(`${file}: ${sel}`);
      }
    }
    expect(
      offenders,
      "the four rooms' verdict type is measured off the comps in shell-v2.css and belongs there",
    ).toEqual([]);
  });

  it("no room may grow its own eyebrow again (slice 7 convergence)", () => {
    // Four private copies of one element, three of them measurably off their own comp. The rule
    // that replaced them is `.v2-eyebrow` in shell-v2.css; the measurements are in
    // src/design/room-eyebrow.tsx. `.mc-eyebrow` in measurement-chrome.css is NOT one of these —
    // that is <SectionLabel>, a different element that only shares a word.
    const GONE = ["hc-masthead-eyebrow", "mc-masthead-eyebrow", "bbv2-eyebrow", "lc-eyebrow"];

    // Banning FOUR NAMES only bans four names: `.hc-room-eyebrow` re-grows the identical defect and
    // sails through. So the rule is inverted for the sheets that dress the four approved rooms —
    // ANY eyebrow class there must be one of the known-legitimate elements below, and a new one is a
    // failure until it is added here on purpose. The names stay pinned rather than pattern-matched
    // because "which element is this" is a judgement, and a regex would just re-open the hole.
    const ROOM_SHEET =
      /(?:home|monitor|lab|blackbook)-(?:console|v2)\.css$|hud-rooms\.css$|home-hud\.css$|[\\/]design[\\/]console[\\/]/;
    const ALLOWED_EYEBROWS = new Set([
      "v2-eyebrow", // THE room eyebrow — shell-v2.css owns it; rooms may only position it.
      "v2-eyebrow-date",
      "v2-eyebrow-dot",
      "v2-eyebrow-dot-accent",
      "v2-eyebrow-dot-ok",
      "v2-eyebrow-dot-rec",
      "v2-eyebrow-dot-scan",
      "v2-eyebrow-dot-warn",
      "v2-eyebrow-sep",
      "v2-nav-eyebrow",
      "mc-eyebrow", // <SectionLabel>. A different element that only shares the word.
      "hc-specs-eyebrow", // the specs block's own label, not the room's.
      "hud-eyebrow", // the HUD register (`fix`, `check`), which the comps do not govern.
      "hud-eyebrow-sep",
      "hud-masthead-eyebrow",
      "dock-eyebrow",
    ]);

    const offenders: string[] = [];
    for (const file of CSS_FILES) {
      const isRoomSheet = ROOM_SHEET.test(file) && !file.endsWith("shell-v2.css");
      for (const [sel] of rulesOf(readFileSync(file, "utf8"))) {
        for (const cls of GONE) {
          if (sel.includes(`.${cls}`)) offenders.push(`${file}: ${sel} (retired class .${cls})`);
        }
        if (!isRoomSheet) continue;
        for (const m of sel.matchAll(/\.([a-zA-Z0-9_-]*eyebrow[a-zA-Z0-9_-]*)/g)) {
          if (!ALLOWED_EYEBROWS.has(m[1])) {
            offenders.push(`${file}: ${sel} (room-private eyebrow .${m[1]})`);
          }
        }
      }
    }
    expect(offenders, "the room eyebrow is one element — see src/design/room-eyebrow.tsx").toEqual(
      [],
    );
  });
});

/* #213 B5 — A SEAM IS A BEVEL, AND THE APP SHIPPED HALF OF ONE.
 *
 * #213 filed the rail/content boundary as DIRECTION: "hard 1px lines with no softening ... what
 * produces the 'boxed in' feeling overall". Measuring the approved comps says otherwise — every
 * boundary in them is a light hairline with a DARK one immediately beside it, which is what reads
 * as an edge rather than as a line drawn on a flat plane.
 *
 * Scanning 01-health-approved.png horizontally at y=761, across the rail/content seam:
 *
 *     x=220  #0f1218   rail interior
 *     x=222  #171920   ramp
 *     x=223  #202227   THE LIGHT HALF  <- --v2-line over --v2-panel already computes to #202228
 *     x=224  #090b10   THE DARK HALF   <- nothing in this app drew this
 *     x=225  #0e1015   content ground
 *
 * The card edges do the same thing (y=426, x=824: #0d0e13 -> #090b0f -> #1a1d23 -> #0e1017), so
 * this is a system in the comps, not one seam's accident. Only the rail seam is implemented here;
 * the card-edge half is a wider pass and is logged with these numbers rather than guessed at.
 */
describe("#213 B5 — the rail seam carries the comp's dark half", () => {
  /** sRGB composite of a black-alpha line over a ground, the way the browser paints it. */
  function overBlack(ground: string, alpha: number): [number, number, number] {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(ground)!;
    return m.slice(1).map((c) => Math.round(parseInt(c, 16) * (1 - alpha))) as [number, number, number];
  }

  const tokens = read("src", "design", "tokens-v2.css");
  const shell = read("src", "design", "shell-v2.css");

  it("the chosen alpha really does reproduce the comp's sampled dark line", () => {
    // The comment above is a claim about a picture. This is the arithmetic that makes it checkable,
    // so a later "let's round this to 0.5" has to argue with the sample rather than with taste.
    const alpha = Number(/--v2-line-shadow:\s*rgba\(0,\s*0,\s*0,\s*([\d.]+)\)/.exec(tokens)?.[1]);
    expect(alpha, "--v2-line-shadow is gone or is no longer a black alpha").toBeGreaterThan(0);
    const got = overBlack("#0e1015", alpha); // the content ground beside the seam
    const want = [0x09, 0x0b, 0x10]; // x=224 in 01-health-approved.png at y=761
    for (const [i, ch] of got.entries()) {
      expect(
        Math.abs(ch - want[i]),
        `channel ${"rgb"[i]}: ${alpha} over #0e1015 gives ${ch}, the comp sampled ${want[i]}`,
      ).toBeLessThanOrEqual(2);
    }
  });

  it("the seam is drawn, at the rail's own width, in the shadow token", () => {
    const seam = body(shell, ':root[data-v2="on"] .v2-shell::before');
    expect(seam, "no .v2-shell::before — the seam lost its dark half again").toBeTruthy();
    expect(seam).toMatch(/width:\s*1px/);
    expect(seam).toMatch(/left:\s*var\(--v2-rail-w\)/);
    expect(seam).toMatch(/background:\s*var\(--v2-line-shadow\)/);
    expect(seam, "an unpositioned seam cannot clear .v2-top's panel fill").toMatch(/position:\s*absolute/);
  });

  it("the seam cannot desync from the column it marks", () => {
    // The grid used a bare 216px. Two literals for one edge is how a seam drifts a pixel off the
    // boundary and starts reading as a stray line.
    const shellRule = body(shell, ':root[data-v2="on"] .v2-shell');
    expect(shellRule).toMatch(/grid-template-columns:\s*var\(--v2-rail-w\)\s+1fr/);
    expect(tokens).toMatch(/--v2-rail-w:\s*216px/);
  });

  it("the LIGHT half is untouched — it already matched the comp", () => {
    const rail = body(shell, ':root[data-v2="on"] .v2-rail');
    expect(rail).toMatch(/border-right:\s*1px solid var\(--v2-line\)/);
  });
});
