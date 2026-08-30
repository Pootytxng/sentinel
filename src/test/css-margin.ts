// Shared by the layout reachability guards (issue #236): "does this declaration block give its
// subject an automatic LEFT margin?" — the property that pushes an element away from the content
// grid's left edge, which is the defect those guards exist to catch.
//
// It lives here rather than inline in each guard because BOTH of them asked the same question and
// both got it wrong the same way, and a shared answer can be tested directly. `css-margin.test.ts`
// is that test: it feeds this function the shorthand forms a stylesheet actually contains, so the
// guards can never quietly become a gate that fails valid CSS.
//
// LTR only, which is what Compy ships. `margin-inline-start` is therefore read as the left margin.

/** Split a value on TOP-LEVEL whitespace: `calc(1px + 2px)` and `var(--a, 1px)` are ONE token. */
export function valueTokens(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth === 0 && /\s/.test(ch)) {
      if (buf) out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * The LEFT component of a `margin` shorthand, per CSS box-model expansion:
 *   1 value  -> all four sides            -> left = v[0]
 *   2 values -> vertical | horizontal     -> left = v[1]
 *   3 values -> top | horizontal | bottom -> left = v[1]
 *   4 values -> top | right | bottom | left -> left = v[3]
 * This is the whole bug the guards had: they searched the shorthand for the WORD `auto` anywhere,
 * so `margin: auto 0` (vertical auto, horizontal 0) and `margin: 0 auto 0 0` (RIGHT auto) both read
 * as a left push. Neither moves an element right, and failing them would make the guard a false gate.
 */
export function marginShorthandLeft(value: string): string | null {
  const v = valueTokens(value);
  if (v.length === 1) return v[0];
  if (v.length === 2 || v.length === 3) return v[1];
  if (v.length === 4) return v[3];
  return null;
}

/** The START component of `margin-inline: <start> [<end>]`. */
export function marginInlineStart(value: string): string | null {
  const v = valueTokens(value);
  if (v.length === 1 || v.length === 2) return v[0];
  return null;
}

type Decl = { prop: string; value: string; important: boolean };

/**
 * Strip CSS block comments before any `;`/`:` splitting sees them — a `:` or `;` inside a comment
 * must never split or rename a declaration, and a comment fused directly against a token must not
 * fuse that token with its neighbor once removed. Replacing with a single space (not "") satisfies
 * both: it destroys the comment's own punctuation while still separating what it stood between.
 *
 * Quoted strings (`"..."` / `'...'`, `\"`/`\'` escapes respected) are skipped as ATOMIC spans
 * first: a `content: "/*"` value sits next to real declarations in this codebase's own CSS
 * (`dock.css`'s `content: "·"; margin-right: 8px;`), so a `/*`-lookalike inside a quoted string is
 * one edit away from being read as a real comment start and swallowing everything after it —
 * independent review, PR #268. `url(...)` stays out of scope: margin declarations never carry a
 * `url()` value, and this codebase's own `url()` calls are quoted where they'd need to be.
 */
function stripComments(body: string): string {
  let out = "";
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < body.length && body[j] !== ch) j += body[j] === "\\" ? 2 : 1;
      out += body.slice(i, Math.min(j + 1, body.length));
      i = j + 1;
      continue;
    }
    if (ch === "/" && body[i + 1] === "*") {
      const end = body.indexOf("*/", i + 2);
      i = end === -1 ? body.length : end + 2;
      out += " ";
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** `a: 1; b: 2 !important` -> declarations, in source order, `!important` split off. */
export function declarations(body: string): Decl[] {
  return stripComments(body)
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(":");
      if (i < 0) return null;
      const prop = d.slice(0, i).trim().toLowerCase();
      let value = d.slice(i + 1).trim();
      const important = /!\s*important$/i.test(value);
      if (important) value = value.replace(/!\s*important$/i, "").trim();
      return prop && value ? { prop, value, important } : null;
    })
    .filter((d): d is Decl => d !== null);
}

/**
 * Does this block leave its subject with `margin-left: auto`?
 *
 * Resolved by walking the block in source order, exactly as the cascade does within one rule: a
 * later declaration wins over an earlier one, `!important` wins over a following normal one, and a
 * SHORTHAND resets the side it covers (`margin-left: auto; margin: 0` leaves no push at all).
 *
 * `inherit`/`initial`/`unset`/`revert` and `var(--x)` are NOT auto here. They cannot be resolved
 * from the stylesheet text, and a guard that guessed "maybe auto" would fail rules it never proved
 * anything about — the false-positive direction this function exists to close.
 */
export function leftMarginIsAuto(body: string): { auto: boolean; source: string | null } {
  let auto = false;
  let source: string | null = null;
  let lockedImportant = false;

  const set = (isAuto: boolean, decl: Decl) => {
    if (lockedImportant && !decl.important) return;
    auto = isAuto;
    source = `${decl.prop}: ${decl.value}${decl.important ? " !important" : ""}`;
    if (decl.important) lockedImportant = true;
  };

  for (const decl of declarations(body)) {
    const isAuto = (v: string | null) => v !== null && v.trim().toLowerCase() === "auto";
    switch (decl.prop) {
      case "margin":
        set(isAuto(marginShorthandLeft(decl.value)), decl);
        break;
      case "margin-inline":
        set(isAuto(marginInlineStart(decl.value)), decl);
        break;
      case "margin-left":
      case "margin-inline-start":
        set(isAuto(decl.value), decl);
        break;
      default:
        break; // margin-top/right/bottom/block/inline-end cannot produce a LEFT push
    }
  }
  return { auto, source: auto ? source : null };
}
