import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
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
