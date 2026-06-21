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
});
