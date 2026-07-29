// CURSOR CONSISTENCY GUARD — recovery items 7 + 8, validation test 21 (2026-07-28).
//
// Tester feedback 2026-07-23: "cursor behavior is inconsistent across the application" (the native
// pointer leaking through the reticle over the sidebar rail + Monitor's capture buttons), and
// separately "the square crosshair is a little weird." The train's instruction was to pick ONE
// cursor — native or reticle-everywhere — and never invent a third. The decision and its reasoning
// live in design/cursor.css and theme.ts readReticle; these are the tripwires that keep it true.
//
// Guard 1  a disabled control never disagrees with another disabled control (the split that made
//          the complaint literally true: 12 rules said not-allowed, 23 said default).
// Guard 2  `cursor: none` stays quarantined in the opt-in reticle. It is the one value that
//          removes information instead of carrying it — anywhere else it is the bug returning.
// Guard 3  the map is loaded, and is a FLOOR (`:where()`), so it can never fight a component.
// Guard 4  behavior: the reticle is opt-in, and while off it does not so much as touch the DOM.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — @types/node is not a project dependency.)

vi.mock("./use-motion", () => ({ useReducedMotion: () => false }));

import { ReticleCursor } from "./console/ReticleCursor";
import { readReticle } from "./theme";

const srcTree = (): string[] =>
  (readdirSync("src", { recursive: true }) as string[]).map((f) => f.replace(/\\/g, "/"));

const cssFiles = (): string[] => srcTree().filter((f) => f.endsWith(".css"));

// Split CSS into { selector, body } rules. Crude by design — the invariants below are lexical, and
// a real parser is not a dependency this repo carries. Nested at-rules fall out correctly because
// the selector is whatever follows the LAST `{` in the chunk. Comments are stripped FIRST: several
// of these files discuss `{ cursor: … }` in prose, and a brace inside a comment derails the split.
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  for (const chunk of css.replace(/\/\*[\s\S]*?\*\//g, "").split("}")) {
    const at = chunk.lastIndexOf("{");
    if (at < 0) continue;
    out.push({ selector: chunk.slice(0, at).trim(), body: chunk.slice(at + 1) });
  }
  return out;
}

const cursorOf = (body: string): string | null => {
  const m = body.match(/(?:^|[;{\s])cursor\s*:\s*([a-z-]+)/);
  return m ? m[1] : null;
};

// A selector that ends on a disabled control. `[data-*]` attribute soup and `.foo-disabled` naming
// are deliberately NOT matched: only the states the browser and assistive tech treat as disabled.
const DISABLED = /:disabled|\[disabled\]|\[aria-disabled="true"\]/;

// The two honest answers a disabled control can give. `not-allowed` is the default one: the control
// exists and cannot be used. `progress` is the narrow exception — a control disabled BECAUSE ITS OWN
// ACTION IS RUNNING (TrustSwitch is literally `disabled={busy}`; likewise Check's re-run and
// leftovers scan, Fix's startup toggle and ghost rollback, Play's capture button). That is a
// different fact about the same greyed-out button, and flattening it would lose information — the
// opposite of this guard's point. What is barred is a disabled control that says nothing meaningful
// (`default`, `auto`, `pointer`): those were the 23 rules that made the tester's complaint true.
const DISABLED_OK = new Set(["not-allowed", "progress"]);

describe("cursor map: one answer per state", () => {
  it("a disabled control says not-allowed, or progress when it is busy — never default", () => {
    const offenders: string[] = [];
    for (const rel of cssFiles()) {
      for (const r of rules(readFileSync(join("src", rel), "utf8"))) {
        if (!DISABLED.test(r.selector)) continue;
        const c = cursorOf(r.body);
        // A disabled rule that declares no cursor is fine — cursor.css's floor covers it.
        if (c && !DISABLED_OK.has(c)) offenders.push(`${rel}: ${r.selector} → ${c}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("`cursor: none` exists ONLY in the opt-in reticle — it removes meaning, never carries it", () => {
    const offenders: string[] = [];
    for (const rel of cssFiles()) {
      if (rel.endsWith("design/console/reticle.css")) continue;
      readFileSync(join("src", rel), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/^\s*(\*|\/\*|\/\/)/.test(line)) return; // prose: several files discuss the blackout
          if (/(?:^|[;{\s])cursor\s*:\s*none/.test(line)) offenders.push(`${rel}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("the blackout is gated on .lc-has-reticle, and exactly one component may add that class", () => {
    const css = readFileSync(join("src", "design", "console", "reticle.css"), "utf8");
    for (const r of rules(css)) {
      if (cursorOf(r.body) === "none") expect(r.selector).toContain(".lc-has-reticle");
    }
    const owners = srcTree()
      .filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))
      .filter((f) =>
        readFileSync(join("src", f), "utf8").includes('classList.add("lc-has-reticle")'),
      );
    expect(owners).toEqual(["design/console/ReticleCursor.tsx"]);
  });
});

describe("cursor map: loaded, and a floor rather than a fight", () => {
  const map = readFileSync(join("src", "design", "cursor.css"), "utf8");

  it("App loads it", () => {
    expect(readFileSync(join("src", "App.tsx"), "utf8")).toContain('import "./design/cursor.css"');
  });

  it("the activator row is zero-specificity, so any component can still overrule it", () => {
    const activator = rules(map).find((r) => cursorOf(r.body) === "pointer");
    expect(activator).toBeTruthy();
    // :where() is the whole mechanism — without it this file becomes an override war.
    expect(activator!.selector.startsWith(":where(")).toBe(true);
    for (const sel of ["button", "summary", "a[href]", '[role="button"]'])
      expect(activator!.selector).toContain(sel);
  });

  it("the disabled row carries specificity on purpose, and wins nothing by force", () => {
    const dis = rules(map).find((r) => cursorOf(r.body) === "not-allowed");
    expect(dis).toBeTruthy();
    expect(dis!.selector).toContain("button:disabled");
    expect(dis!.selector.includes(":where(")).toBe(false);
    expect(map).not.toContain("!important");
  });
});

describe("the reticle is opt-in (compy_reticle, DEFAULT OFF)", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  const mount = (scope: HTMLElement) =>
    render(<ReticleCursor scopeRef={{ current: scope }} appWide />);

  const scopeEl = () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    return el;
  };

  it("renders nothing by default — the native cursor is what a new user gets", () => {
    expect(readReticle()).toBe(false);
    const scope = scopeEl();
    const { container } = mount(scope);
    expect(container.querySelector(".lc-reticle")).toBeNull();
    // …and it never armed the blackout: no listeners were bound, so the scope stays untouched.
    scope.dispatchEvent(new Event("pointerenter"));
    expect(scope.classList.contains("lc-has-reticle")).toBe(false);
  });

  it('an explicit "1" brings it back whole — nothing was deleted', () => {
    localStorage.setItem("compy_reticle", "1");
    expect(readReticle()).toBe(true);
    const { container } = mount(scopeEl());
    const ret = container.querySelector(".lc-reticle");
    expect(ret).toBeTruthy();
    expect(ret!.querySelectorAll(".lc-ret-c").length).toBe(4);
    expect(ret!.getAttribute("aria-hidden")).toBe("true");
  });
});
