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

/**
 * Split a comment-stripped block into declaration texts on TOP-LEVEL `;` only.
 *
 * `stripComments` above is quote-aware, and so is the `rulesFromCss` walker in both guards that
 * consume this file. The split that sat between them was not, and that mismatch is exactly why it
 * survived the #240 review: the hard part looked solved, so nobody re-read the easy part. This
 * codebase ships `content: "…"` beside real margin declarations (`dock.css`), so a `;` inside a
 * quoted value ended the declaration early and handed the rest of the string back as declarations
 * that were never written. It failed BOTH ways —
 *   `margin-left: auto; content: "; margin-left: 0;"`  lost a real push (the guard goes blind), and
 *   `content: "; margin-left: auto;"; margin-right: 0`  invented one (the guard fails valid CSS,
 * which is how a guard gets deleted — the same failure mode `marginShorthandLeft` above records for
 * the old `auto`-anywhere regex).
 *
 * Parens are counted for the same reason with no quotes involved: an unquoted `url()` token may
 * legally contain `;`, and `url(data:image/png;base64,…)` is ordinary shipped CSS. A stray `)`
 * clamps the depth at 0 rather than driving it negative, which would silently disable every later
 * split. Escapes consume the next character inside and outside strings, so `\;` is a character.
 *
 * One pass, no backtracking, bounded by `body.length`.
 */
function splitDeclarations(body: string): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "\\") {
      buf += body.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < body.length && body[j] !== ch) j += body[j] === "\\" ? 2 : 1;
      buf += body.slice(i, Math.min(j + 1, body.length));
      i = j + 1;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0) {
      out.push(buf);
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  out.push(buf);
  return out;
}

/**
 * The property/value `:` — the FIRST one outside quotes and parens, or -1 when there is none.
 *
 * Fixing one delimiter does not prove the other, so this is not assumed from the split above. Once
 * `;` splitting is correct no *valid* CSS reaches a different verdict through this function — a
 * property name cannot contain a quote or a paren, so its `:` is already top-level — but a naive
 * `indexOf(":")` still manufactures a declaration out of a fragment that is entirely protected
 * text (`"k:v"` parses as property `"k`), and a parser that invents declarations is one edit away
 * from inventing one the cascade below acts on.
 */
function topLevelColon(decl: string): number {
  let depth = 0;
  let i = 0;
  while (i < decl.length) {
    const ch = decl[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < decl.length && decl[j] !== ch) j += decl[j] === "\\" ? 2 : 1;
      i = j + 1;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ":" && depth === 0) return i;
    i++;
  }
  return -1;
}

/** `a: 1; b: 2 !important` -> declarations, in source order, `!important` split off. */
export function declarations(body: string): Decl[] {
  return splitDeclarations(stripComments(body))
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = topLevelColon(d);
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
