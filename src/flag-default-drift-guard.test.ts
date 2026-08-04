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
// SCOPE, stated so it cannot be misread as broader than it is:
//   • Boolean flags only — the enum/number readers (theme, refresh Hz, overlay density, room
//     accents, view mode, overlay backdrop) have no ON/OFF default to contradict.
//   • Claims are matched FORWARD only (flag token → "DEFAULT ON/OFF" within CLAIM_WINDOW chars).
//     Every real occurrence in the tree is written that way. A claim written BEFORE its flag is
//     not checked — pairing backwards would mis-attribute "… DEFAULT ON. Meanwhile compy_x …".
//   • A window is truncated at the next flag token, so "compy_a (ON) and compy_b (OFF)" grades
//     each against its own truth.

const CLAIM_WINDOW = 90;
/** This file quotes drifted strings for its own disarm proof — scanning it would self-trip. */
const SELF = "flag-default-drift-guard.test.ts";

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

  // nav-flags.ts — the key is inlined, one hop.
  const nav = readFileSync(join("src", "data", "nav-flags.ts"), "utf8");
  for (const m of nav.matchAll(
    /localStorage\.getItem\("(compy_[a-z0-9_]+)"\)\s*(!==|===)\s*"([01])"/g,
  )) {
    truth.set(m[1], defaultFor(m[2], m[3]));
  }

  return truth;
}

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

type Claim = { file: string; line: number; flag: string; claimed: Truth; quote: string };

/** Every "<flag> … DEFAULT ON|OFF" assertion written anywhere in src/. */
function collectClaims(known: Set<string>, files: string[]): Claim[] {
  const claims: Claim[] = [];
  const TOKEN = /compy_[a-z0-9_]+/g;
  const CLAIM = /default[\s-]*(on|off)\b/i;

  for (const rel of files) {
    const { text, lineAt } = flatten(readFileSync(join("src", rel), "utf8"));
    for (const m of text.matchAll(TOKEN)) {
      const flag = m[0];
      if (!known.has(flag)) continue;
      const from = m.index! + flag.length;
      let window = text.slice(from, from + CLAIM_WINDOW);
      // Stop at the next flag token so each flag is graded against its own claim.
      const next = window.search(/compy_[a-z0-9_]+/);
      if (next !== -1) window = window.slice(0, next);
      const hit = CLAIM.exec(window);
      if (!hit) continue;
      claims.push({
        file: rel.replace(/\\/g, "/"),
        line: lineAt[m.index!],
        flag,
        claimed: hit[1].toUpperCase() as Truth,
        quote: `${flag}${window.slice(0, hit.index + hit[0].length)}`.replace(/\s+/g, " ").trim(),
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
  const truth = readFlagDefaults();
  const claims = collectClaims(new Set(truth.keys()), sourceFiles());

  it("parses a real default for every boolean flag reader", () => {
    // Both readers must be found, or the guard is grading against an empty truth table.
    expect(truth.get("compy_editorial")).toBe("ON"); // theme.ts, two-hop
    expect(truth.get("compy_monitor")).toBe("ON"); // nav-flags.ts, one-hop
    expect(truth.size).toBeGreaterThanOrEqual(20);
  });

  it("actually finds the default claims written in the tree (guard is not vacuous)", () => {
    // If a refactor breaks the scanner, this fails LOUD instead of passing on zero work.
    expect(claims.length).toBeGreaterThanOrEqual(25);
    expect(new Set(claims.map((c) => c.file)).size).toBeGreaterThanOrEqual(15);
  });

  it("detects a contradiction when one is present (disarm proof)", () => {
    // Synthesised, not read from disk: compy_editorial is DEFAULT ON, so an OFF claim must trip.
    const planted = collectClaims(new Set(truth.keys()), []).concat({
      file: "planted.ts",
      line: 1,
      flag: "compy_editorial",
      claimed: "OFF",
      quote: "compy_editorial (DEFAULT OFF)",
    });
    expect(planted.filter((c) => c.claimed !== truth.get(c.flag))).toHaveLength(1);
  });

  it("every claim matches what its reader returns", () => {
    const drift = claims
      .filter((c) => c.claimed !== truth.get(c.flag))
      .map((c) => `${c.file}:${c.line} claims ${c.claimed}, reader says ${truth.get(c.flag)} — "${c.quote}"`);
    expect(drift).toEqual([]);
  });
});
