import { describe, it, expect } from "vitest";

// Doorknob guard (Doorknob Pass — CI-enforced affordance-honesty). A "raw clickable div" is a lie:
// an interactive element that doesn't look interactive. So interactivity on a NON-SEMANTIC element
// must ship through a sanctioned primitive — the .cmp-door grammar (visible knob), or the overlay
// patterns (a backdrop/modal whose onClick only dismisses or stops propagation, not a "door").
// <button>/<a>/<Component> are interactive by semantics and are fine. A future surface that wires a
// knobless <div onClick> now fails the build, named.

const SANCTIONED = /(cmp-door|backdrop|modal|change-action-area)/;
const NON_SEMANTIC = new Set([
  "div", "li", "span", "section", "header", "footer", "p", "article", "aside", "main", "nav",
  "ul", "ol", "tr", "td", "figure", "label",
]);

// All app .tsx sources as raw text, at test time (Vite-native — no fs typing quirks). Tests excluded.
const sources = import.meta.glob("../**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("doorknob guard — every door shows its knob", () => {
  it("no non-semantic element carries onClick without a sanctioned interactivity class", () => {
    const violations: string[] = [];
    for (const [path, src] of Object.entries(sources)) {
      if (path.endsWith(".test.tsx")) continue;
      const re = /onClick=/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const i = m.index;
        // The element owning this onClick is the nearest opening tag before it (attributes follow the
        // tag name, before any child) — `=>` in arrow handlers makes matching to `>` unreliable, so we
        // scan backward for the tag instead.
        const back = src.slice(Math.max(0, i - 1000), i);
        const tag = [...back.matchAll(/<([A-Za-z][\w]*)/g)].pop()?.[1];
        if (!tag || !NON_SEMANTIC.has(tag)) continue; // <button>/<a>/<Component> are sanctioned
        const windowText = src.slice(Math.max(0, i - 1000), i + 200);
        if (!SANCTIONED.test(windowText)) {
          const line = src.slice(0, i).split("\n").length;
          violations.push(`${path}:${line} — <${tag}> with onClick lacks a sanctioned class`);
        }
      }
    }
    expect(
      violations,
      `Knobless door(s) found — make it a <button>, or wrap it in the .cmp-door grammar (visible knob):\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});
