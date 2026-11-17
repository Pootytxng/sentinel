import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// Button-legibility guard. The "Turn it back on" button shipped ILLEGIBLE — muted-gray text on an
// accent fill — because two `.btn` rules plus `.btn-small`'s `color: var(--muted)` collided in the
// cascade (owner-caught 2026-06-20; fixed by `.btn.btn-small { color: var(--ix-accent-ink) }`).
//
// HONEST SCOPE: a static vitest guard can't resolve a CROSS-rule cascade (the muted came from one
// rule, the fill from another) — that's what the `self-review` skill's computed-color check is for.
// What this guard DOES lock down:
//   (1) the `.btn.btn-small` ink fix can never silently regress, and
//   (2) no single rule pairs an accent/gradient fill with muted text (the same-rule footgun).

const css = readFileSync(join("src", "App.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// Flat { selector, body } rules — good enough for App.css's button declarations.
function rules(): { sel: string; body: string }[] {
  const out: { sel: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) out.push({ sel: m[1].trim(), body: m[2] });
  return out;
}

const FILL = /background[^;]*var\(\s*--accent/; // var(--accent), var(--accent-bright), or a gradient of them
const MUTED_TEXT = /color\s*:\s*var\(\s*--muted\s*\)/;
const INK = /var\(\s*--ix-accent-ink/;

describe("button legibility", () => {
  it("pins the .btn.btn-small ink fix (never regress to muted-on-accent)", () => {
    const fix = rules().find((r) => /\.btn\.btn-small/.test(r.sel) && INK.test(r.body));
    expect(
      fix,
      ".btn.btn-small must set color: var(--ix-accent-ink) (the legibility fix must not regress)",
    ).toBeTruthy();
  });

  it("never pairs an accent fill with muted text in the same rule (the footgun)", () => {
    const offenders = rules()
      .filter((r) => FILL.test(r.body) && MUTED_TEXT.test(r.body))
      .map((r) => r.sel);
    expect(offenders).toEqual([]);
  });

  // bug→guard (self-review computed-proof, T6c train 2026-07-10): a bare `.btn-small-on`
  // selector TIES with the base `.btn-small` rule declared later in the file, so the accent
  // ink was silently dead on every "-on" button app-wide (7 call sites), and the generic
  // `.btn-small:hover` painted the non-destructive primary DANGER RED. The fix is
  // specificity, not source order — pin both rules so neither can quietly regress.
  it("pins the .btn-small.btn-small-on accent ink (rest AND hover) — never a bare tie-losing selector", () => {
    const all = rules();
    const rest = all.find(
      (r) =>
        r.sel === ".btn-small.btn-small-on" &&
        /color\s*:\s*var\(\s*--accent\s*\)/.test(r.body) &&
        /border-color\s*:\s*var\(\s*--accent\s*\)/.test(r.body),
    );
    expect(
      rest,
      ".btn-small.btn-small-on must set accent color + border-color at double-class specificity",
    ).toBeTruthy();
    const hover = all.find(
      (r) =>
        /\.btn-small\.btn-small-on:hover/.test(r.sel) &&
        /color\s*:\s*var\(\s*--accent\s*\)/.test(r.body),
    );
    expect(
      hover,
      ".btn-small.btn-small-on:hover must hold accent (the generic .btn-small:hover flips to --danger)",
    ).toBeTruthy();
    // The regressed shape: a lone `.btn-small-on` rule that loses the cascade tie.
    const bare = all.filter((r) => r.sel === ".btn-small-on").map((r) => r.sel);
    expect(bare, "a bare .btn-small-on selector loses the tie to the later .btn-small base rule").toEqual([]);
  });
});

// ── FALSE-DANGER HOVER CENSUS (bug→guard, 2026-08-18) ────────────────────────────────────────
//
// THE BUG SHAPE, now caught three separate times by three separate self-reviews: `.btn-small:hover`
// paints --danger RED (App.css:1399). That is right for a ghost button that destroys something and
// WRONG for every other one — a red hover tells the user "this will break something" about a button
// that starts an app, exports a file or dismisses a toast. It is invisible to tsc, to vitest and to
// a screenshot nobody hovered. Fixed at the root for `.btn.btn-small` (App.css:1929), scoped for the
// gaming toast (App.css:2941), and scoped again for the CPU-temp offer (CpuTempOffer.css).
//
// A static guard cannot know whether a given button is destructive — only the author does. So this
// is a RATCHET, not a rule: the bare-`.btn-small` call sites that exist today are recorded, and a
// NEW one fails the build until whoever adds it makes the hover decision and records it here. That
// is the whole point — the decision has to be made once, in the open, rather than defaulted into.
describe("false-danger hover census (bare .btn-small)", () => {
  // Bare = `.btn-small` WITHOUT `.btn` (App.css:1929 already fixes that combination at the root)
  // and WITHOUT `.btn-small-on` (App.css:575 holds accent through hover).
  //
  // Recorded, NOT endorsed: most of these have never been hover-reviewed. Lowering a count is
  // progress; raising one needs a line in the fix column below.
  const BASELINE: Record<string, number> = {
    "src/App.tsx": 4, // overlay/gaming toasts — not reviewed
    "src/surfaces/CpuTempOffer.tsx": 2, // FIXED: scoped hover in CpuTempOffer.css
    "src/surfaces/GamingMode.tsx": 4, // FIXED for the toast subset by App.css:2941
    "src/surfaces/rig/RigViewer.tsx": 1, // rig nudge CTA — not reviewed
    // dismiss/export non-destructive, revert IS — not reviewed; +1 (s35): the no-undo "Dismiss"
    // (CR-debrief-no-undo-dismiss) is non-destructive: FIXED, scoped hover `.cmp-dismiss` in App.css.
    "src/surfaces/SessionDebrief.tsx": 4,
    "src/surfaces/setup/SetupTour.tsx": 1, // "Back" — not reviewed
  };

  function census(): Record<string, number> {
    const out: Record<string, number> = {};
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith(".tsx") && !name.endsWith(".test.tsx")) {
          const src = readFileSync(p, "utf8");
          let n = 0;
          for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
            const raw = m[1] ?? m[2] ?? "";
            // Token split, NOT a \b regex: `\bbtn\b` matches INSIDE "btn-small" (the hyphen is a
            // word boundary), which silently emptied the first draft of this census to zero.
            const tokens = raw.split(/[\s`${}?:'"]+/).filter(Boolean);
            if (!tokens.includes("btn-small")) continue;
            if (raw.includes("btn-small-on")) continue;
            if (tokens.includes("btn")) continue;
            n++;
          }
          if (n) out[p.split("\\").join("/")] = n;
        }
      }
    };
    walk("src");
    return out;
  }

  it("records every bare .btn-small call site — a new one must decide its hover first", () => {
    expect(
      census(),
      "bare `.btn-small` hovers RED (--danger). If the button is destructive, record it here. " +
        "If it is not, scope a non-danger hover the way CpuTempOffer.css and App.css:2941 do.",
    ).toEqual(BASELINE);
  });

  it("keeps the scoped non-destructive hovers that were already fixed", () => {
    const offer = readFileSync(join("src", "surfaces", "CpuTempOffer.css"), "utf8");
    for (const [label, sheet, scope] of [
      ["gaming toast", css, ".gaming-toast"],
      ["CPU-temp offer", offer.replace(/\/\*[\s\S]*?\*\//g, ""), ".cpu-temp-offer"],
    ] as const) {
      const hover = new RegExp(
        `\\${scope}\\s+(?:button)?\\.btn-small:hover:not\\(:disabled\\)\\s*\\{([^}]*)\\}`,
      ).exec(sheet);
      expect(hover, `${label} lost its non-destructive .btn-small hover override`).toBeTruthy();
      expect(hover?.[1], `${label}'s hover override went back to --danger`).not.toMatch(/--danger/);
    }
  });
});
