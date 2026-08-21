import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — see sweep-guard for why sources are read from disk.)

// STATE-DRIFT GUARD — a flag's shipped default is what its reader RETURNS, never what a comment
// claims. The graduated-flag convention is mechanical: `getItem(KEY) !== "0"` = DEFAULT ON
// (graduated), `=== "1"` = DEFAULT OFF (opt-in). A flag that graduates flips one operator in
// theme.ts, and every "(DEFAULT OFF)" comment sitting next to a consuming surface silently
// becomes a lie — one that reads as "this branch is the dark experiment" when it is in fact the
// shipped face. That is the project's named #1 risk (state/doc drift) in its purest form.
//
// Written 2026-08-04 after a UI sweep found NINE such comments, including MonitorV2/BlackbookV2
// still describing their live console faces as "DEFAULT OFF" months after both flags graduated.
// The sweep found them by hand; this makes the class fail the build instead (bug → guard).
//
// WIDENED same day, after the first version's own SCOPE block exposed its blind spot: half the
// drifted comments in src/ never name a flag at all — they name the CSS attribute the flag sets
// ("scoped under [data-hud="on"], DEFAULT OFF"). Those were structurally invisible here, and they
// are the ones a UI reader actually meets. main.tsx binds attribute → flag in one uniform shape
// before first paint, so the map is DERIVED from that file rather than hard-coded: the guard's
// founding property — the READ is the truth, never a table someone maintains by hand — survives.
//
// SCOPE, stated so it cannot be misread as broader than it is:
//   • Boolean flags only — the enum/number readers (theme, refresh Hz, overlay density, room
//     accents, view mode, overlay backdrop) have no ON/OFF default to contradict.
//   • Claims are matched FORWARD only (token → "DEFAULT ON/OFF" within CLAIM_WINDOW chars).
//     Every real occurrence in the tree is written that way. A claim written BEFORE its token is
//     not checked — pairing backwards would mis-attribute "… DEFAULT ON. Meanwhile compy_x …".
//   • A window is truncated at the next token, so "compy_a (ON) and compy_b (OFF)" grades
//     each against its own truth.
//   • A data-* attribute with NO root assignment in main.tsx is not graded — there is nothing to
//     derive a truth from. `data-qpw` is the live example: no code ever sets it, so tokens-qpw.css
//     is permanently inert and its "DEFAULT OFF" is substantively true. If such an attribute is
//     later wired up, main.tsx is where it lands, and it starts being graded automatically.

const CLAIM_WINDOW = 90;
/** This file quotes drifted strings for its own disarm proof — scanning it would self-trip. */
const SELF = "flag-default-drift-guard.test.ts";
/** Flag keys and the CSS attributes they set. Kept in one regex so windows truncate on both. */
const TOKEN_SRC = "compy_[a-z0-9_]+|data-[a-z0-9-]+";

type Truth = "ON" | "OFF";

/** `!== "0"` = graduated/DEFAULT ON · `=== "1"` = opt-in/DEFAULT OFF. Anything else is unknown. */
function defaultFor(op: string, lit: string): Truth {
  if (op === "!==" && lit === "0") return "ON";
  if (op === "===" && lit === "1") return "OFF";
  throw new Error(`unrecognised flag idiom: getItem(...) ${op} "${lit}"`);
}

/** The ONE source of truth: what the readers actually return. */
function readFlagDefaults(): Map<string, Truth> {
  const truth = new Map<string, Truth>();

  // theme.ts — `const X_KEY = "compy_y"` then `getItem(X_KEY) <op> "<lit>"`, two hops.
  const theme = readFileSync(join("src", "design", "theme.ts"), "utf8");
  const keyByConst = new Map<string, string>();
  for (const m of theme.matchAll(/const\s+([A-Z0-9_]+_KEY)\s*=\s*"(compy_[a-z0-9_]+)"/g)) {
    keyByConst.set(m[1], m[2]);
  }
  for (const m of theme.matchAll(
    /localStorage\.getItem\(([A-Z0-9_]+_KEY)\)\s*(!==|===)\s*"([01])"/g,
  )) {
    const flag = keyByConst.get(m[1]);
    if (flag) truth.set(flag, defaultFor(m[2], m[3]));
  }

  // The one-hop hop (inlined key, `src/data/nav-flags.ts`) was REMOVED in the 2026-08-06 generation
  // prune: `compy_optimize` and `compy_monitor` were retired with the faces they switched, the file
  // that read them is deleted, and reading a deleted path here would throw at collection time rather
  // than fail a claim. theme.ts is the only reader shape left. If a future flag inlines its key
  // instead of using an X_KEY const, restore a hop for it — an ungraded flag is an ungraded comment.

  return truth;
}

/**
 * The second source of truth: which face a CSS attribute selects, derived from main.tsx — the
 * pre-first-paint authority the browser itself obeys. Its shape is uniform:
 *
 *     try {
 *       if (localStorage.getItem("compy_x") !== "0") {
 *         document.documentElement.dataset.x = "on";   // ← flag-bound: inherits that flag's truth
 *       }
 *     } catch {
 *       document.documentElement.dataset.x = "on";     // ← catch restatement of the same default
 *     }
 *
 * plus one unindented, unconditional assignment (`data-v2`, whose opt-in flag was removed when V2
 * became the build). theme.ts's applyLiving/applyHud/… are runtime TOGGLES, not defaults, so this
 * deliberately reads only main.tsx. An indented assignment that is neither directly under a flag
 * read nor already bound THROWS — a new binding shape must teach this parser, never slip past it.
 */
function readAttrDefaults(): Map<string, Truth> {
  const attrs = new Map<string, Truth>();
  const lines = readFileSync(join("src", "main.tsx"), "utf8").split("\n");
  let pending: { truth: Truth; line: number } | null = null;

  lines.forEach((raw, i) => {
    const read = /localStorage\.getItem\("compy_[a-z0-9_]+"\)\s*(!==|===)\s*"([01])"/.exec(raw);
    if (read) pending = { truth: defaultFor(read[1], read[2]), line: i };

    const set = /document\.documentElement\.dataset\.([A-Za-z0-9]+)\s*=\s*"on"/.exec(raw);
    if (!set) return;
    // dataset.dashV2 → data-dash-v2 (the form a stylesheet and a comment actually write).
    const attr = "data-" + set[1].replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

    const p = pending; // local const so TS keeps the narrowing across the closure
    if (p && i - p.line <= 1) {
      attrs.set(attr, p.truth);
      pending = null;
    } else if (/^\S/.test(raw)) {
      attrs.set(attr, "ON"); // top-level ⇒ unconditional ⇒ this face always ships
    } else if (!attrs.has(attr)) {
      throw new Error(`main.tsx sets ${attr} in an unrecognised shape (line ${i + 1})`);
    }
  });

  return attrs;
}

type Claim = { file: string; line: number; token: string; claimed: Truth; quote: string };

/**
 * Flatten a source file into one string so a claim split across wrapped comment lines
 * ("… (DEFAULT\n// OFF)" — exactly how MonitorV2 hid its drift from a line-wise grep) still
 * reads as contiguous text. Keeps a char→line map so offenders cite a real line.
 */
function flatten(src: string): { text: string; lineAt: number[] } {
  let text = "";
  const lineAt: number[] = [];
  src.split("\n").forEach((raw, i) => {
    const chunk = raw.replace(/^\s*(\/\/+|\/\*+|\*+\/?)\s?/, "").trimEnd() + " ";
    for (let k = 0; k < chunk.length; k++) lineAt.push(i + 1);
    text += chunk;
  });
  return { text, lineAt };
}

/** Every "<flag|attribute> … DEFAULT ON|OFF" assertion written anywhere in src/. */
function collectClaims(known: Set<string>, files: string[]): Claim[] {
  const claims: Claim[] = [];
  const TOKEN = new RegExp(TOKEN_SRC, "g");
  const NEXT = new RegExp(TOKEN_SRC);
  const CLAIM = /default[\s-]*(on|off)\b/i;

  for (const rel of files) {
    const { text, lineAt } = flatten(readFileSync(join("src", rel), "utf8"));
    for (const m of text.matchAll(TOKEN)) {
      const token = m[0];
      if (!known.has(token)) continue;
      const from = m.index! + token.length;
      let window = text.slice(from, from + CLAIM_WINDOW);
      // Stop at the next token so each one is graded against its own claim.
      const next = window.search(NEXT);
      if (next !== -1) window = window.slice(0, next);
      const hit = CLAIM.exec(window);
      if (!hit) continue;
      claims.push({
        file: rel.replace(/\\/g, "/"),
        line: lineAt[m.index!],
        token,
        claimed: hit[1].toUpperCase() as Truth,
        quote: `${token}${window.slice(0, hit.index + hit[0].length)}`.replace(/\s+/g, " ").trim(),
      });
    }
  }
  return claims;
}

function sourceFiles(): string[] {
  return (readdirSync("src", { recursive: true }) as string[]).filter(
    (f) => /\.(ts|tsx|css)$/.test(f) && !f.replace(/\\/g, "/").endsWith(SELF),
  );
}

describe("state-drift law: no comment may contradict a flag's real shipped default", () => {
  const flags = readFlagDefaults();
  const attrs = readAttrDefaults();
  const truth = new Map<string, Truth>([...flags, ...attrs]);
  const claims = collectClaims(new Set(truth.keys()), sourceFiles());

  it("parses a real default for every boolean flag reader", () => {
    // The reader must be found, or the guard is grading against an empty truth table.
    expect(flags.get("compy_editorial")).toBe("ON"); // theme.ts, two-hop
    // Floor was 20 with nav-flags.ts contributing two; the 2026-08-06 generation prune retired
    // compy_optimize + compy_monitor with their file, three Lab face flags out of theme.ts, and
    // compy_committed with the unreachable CompyHero it gated. The 2026-08-20 comprehensibility
    // sweep (issue #180) retired compy_monitor_console + compy_jarvis_motion — one Live face,
    // one motion switch.
    expect(flags.size).toBeGreaterThanOrEqual(17);
  });

  it("derives each shipped face's attribute from main.tsx, not from a hand-kept table", () => {
    expect(attrs.get("data-hud")).toBe("ON"); // bound to compy_editorial one line above it
    expect(attrs.get("data-dash-v2")).toBe("ON"); // camelCase dataset prop → kebab attribute
    expect(attrs.get("data-v2")).toBe("ON"); // unindented, unconditional — the shell always ships
    expect(attrs.size).toBeGreaterThanOrEqual(5);
    // data-qpw is the honest gap, stated in SCOPE: nothing assigns it, so nothing grades it.
    expect(attrs.has("data-qpw")).toBe(false);
  });

  it("actually finds the default claims written in the tree (guard is not vacuous)", () => {
    // If a refactor breaks the scanner, this fails LOUD instead of passing on zero work.
    expect(claims.length).toBeGreaterThanOrEqual(25);
    expect(new Set(claims.map((c) => c.file)).size).toBeGreaterThanOrEqual(15);
    // Both anchor styles must be represented — a widening that quietly stops finding one is a
    // regression that "0 drift" would otherwise hide.
    expect(claims.filter((c) => c.token.startsWith("compy_")).length).toBeGreaterThanOrEqual(20);
    expect(claims.filter((c) => c.token.startsWith("data-")).length).toBeGreaterThanOrEqual(4);
  });

  it("detects a contradiction when one is present (disarm proof)", () => {
    // Synthesised, not read from disk. Both anchors: compy_editorial and the data-hud attribute it
    // sets are DEFAULT ON, so an OFF claim against either must trip.
    const planted = collectClaims(new Set(truth.keys()), []).concat(
      {
        file: "planted.ts",
        line: 1,
        token: "compy_editorial",
        claimed: "OFF",
        quote: "compy_editorial (DEFAULT OFF)",
      },
      {
        file: "planted.css",
        line: 1,
        token: "data-hud",
        claimed: "OFF",
        quote: "scoped under [data-hud], DEFAULT OFF",
      },
    );
    expect(planted.filter((c) => c.claimed !== truth.get(c.token))).toHaveLength(2);
  });

  it("every claim matches what its reader returns", () => {
    const drift = claims
      .filter((c) => c.claimed !== truth.get(c.token))
      .map(
        (c) =>
          `${c.file}:${c.line} claims ${c.claimed}, reader says ${truth.get(c.token)} — "${c.quote}"`,
      );
    expect(drift).toEqual([]);
  });
});
