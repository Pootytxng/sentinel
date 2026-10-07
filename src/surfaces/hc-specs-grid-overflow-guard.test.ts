import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { CLASS_WRITES, DATA_WRITES } from "../test/dom-mutation-pins";

// Bug → guard (#614, found by the self-reviewer during the #599 review, 2026-09-28). Health's
// Detected tile is the bento hero, 7 of 12 columns. Its spec cards (Graphics, Processor, Memory,
// Storage) sat in `repeat(auto-fit, minmax(230px, 1fr))`. auto-fit can drop to one column, but no
// further: the last track still demands 230px. Below a ~700px window the hero's content box is
// narrower than that, so the cards spilled out of the tile and ran under Findings. The window's
// minWidth is 380, so a user can reach it.
//
// The fix is the breakpoint-free clamp `minmax(min(230px, 100%), 1fr)`. It is identical wherever
// the container is at least 230px, and caps the track at the container below that. This file bans
// `@media`, so there is no breakpoint to add instead.
//
// jsdom does no layout, so this guard resolves each track minimum for real container widths. That
// catches the defect itself, not one spelling of it. It reads EVERY declaration that can set a
// guarded property, in every sheet under src/, not the first rule it finds: a later override wins
// the cascade, so one safe rule proves nothing (Codex review of PR 624, round 1).
//
// A rule reaches a card element when its subject names any class that element carries, read from
// HomeConsole.tsx, so `.hc-mono` counts for a value. The subject can name it directly, through
// :is() / :where() / `:nth-child(… of S)`, or through a class attribute selector. A bare type or
// universal subject that matches the element's tag reaches it too. The card's own tree is read from
// the markup, so a child combinator into a known parent can rule a rule out (`.bench > div` never
// reaches the grid). Anything above the tile is unknown, so it is assumed to match. Before this,
// `:is(.hc-specs-grid)` or `dd` slipped past the guard (Codex review of PR 624, round 2).
//
// Sheets are read after CSS escapes are resolved, so `grid-template-colum\6e s` is the guarded
// property and `.hc-specs\2d grid` is the guarded class, with the escape's terminating space
// consumed rather than read as a descendant combinator (Codex review of PR 624, round 3).
//
// Three more routes closed in round 4 (Codex): a sheet is preprocessed the way the CSS parser
// does (CR, CRLF and form feed become one newline) before escapes are read, so a backslash before
// a form feed is a string continuation; a <style> element or a runtime stylesheet anywhere in
// src/ is document-scoped, so the whole tree is scanned for one, not just the card's markup; and a
// keyframes block can animate a width onto a card, so a card may only animate paint properties.
//
// Round 5 (Codex) turned the keyframes rule from a reader into a pin: an animation value can carry
// a keyframes name in more ways than this file should learn to parse (`animation-name: linear`, an
// escaped `\31 widen`, a `var(--x, widen)` fallback, an `@property` initial value), so the animation
// declarations that reach a card must be exactly the pinned ones, byte for byte, and only the
// pinned names are looked up. A new card animation is a one-line change to the pin, made in review.
//
// Round 6 (Codex) closed three routes around the pin with prohibitions, not more reading: at-rule
// names are matched ASCII-case-insensitively (`@KEYFRAMES`); every spelling of the animation
// properties is held to the pin (`-webkit-animation`); and a pinned value may hold no var(), env()
// or attr(), so the one sheet value is the whole story (the tile's `--ease-out` is written out).
//
// Round 7 (Codex) closed three more the same way: the card declares its own wrapping
// (`white-space: normal`, `text-wrap: wrap` on `.hc-spec`), so nothing an ancestor sets is
// inherited into it and the guard reads no ancestor; no card element may be `display: contents`
// (which would hand its children to the grid as items) or carry a grid placement; and every inline
// style write under src/ is pinned by file and property, with the Web Animations API banned
// outright, so no runtime write can size a card.
//
// Round 8 (Codex) closed two more with pins, not reading: the spec grid's track value is pinned
// whole, so a second track inside the repeat() cannot ride beside the clamp; and the card markup
// carries no handler, id or class write, while every runtime class or id write under src/ is pinned
// by file and name and no rule naming a pinned class may size an element that could be a card.
//
// Round 9 (Codex) closed three more and bounded the claim. Keyword bans fold case, as CSS does.
// Every setProperty under src/ names a literal custom property. And the round-8 census became one
// rule for the whole of src/: every DOM class, attribute or id mutation token (classList, dataset,
// setAttribute and kin, .id =, .className =) must sit in an exact pinned shape with a literal name,
// so an alias, a computed name or a new call shape is a fault, not a miss; and for every pinned name
// the guard asks the reader what the browser would ask: which rules reach a card only once it
// carries that name, and holds those to paint.
//
// Round 10 (Codex) showed the regex census could be aliased around (`const inline = el.style`,
// `Object.assign(el, { className })`, a runtime sheet that never spells the class) and found two
// sheet routes the width proof ignored (`box-sizing: content-box; width: 100%`, and a column flow
// inherited into the grid with `grid-auto-columns`). The runtime half of the claim moved to
// src/dom-mutation-census.test.ts, which reads every expression under src/ by its TYPE through the
// TypeScript checker, so an alias, a destructuring, a reflection call or a laundering assertion is a
// fault, not a miss; its rows live in src/test/dom-mutation-pins.ts, and this file reads those pins
// to ask what each pinned name could activate. The sheet half gained pins: every card element is
// `box-sizing: border-box`, the grid flows by row with no auto columns, and no pinned animation
// value is dynamic.
//
// WHAT THIS GUARD CLAIMS. The sheets and the static markup that render the spec cards hold the
// clamp, and the runtime writes pinned in src/test/dom-mutation-pins.ts (proved complete by the
// census) cannot change a card's size, class set, attributes or id. It reads src/ and nothing else:
// a browser extension, devtools or code outside src/ are not in its claim.

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
/** The CSS parser's input preprocessing: CR, CRLF and form feed are each one newline. */
const preprocess = (s: string) => s.replace(/\r\n?|\f/g, "\n");
/** A sheet as the readers below take it: preprocessed, comment-free, escapes resolved. */
const prepare = (s: string) => decodeEscapes(stripComments(preprocess(s)));

/** The index just past the string that opens at `s[i]`; a `\` inside it escapes the next character. */
function skipString(s: string, i: number): number {
  const q = s[i];
  for (i++; i < s.length; i++) {
    if (s[i] === "\\") i++;
    else if (s[i] === q) return i + 1;
  }
  return s.length;
}

/** Drop the `\` from every escape left in a decoded token. */
const unescape = (s: string) => s.replace(/\\([\s\S])/g, "$1");

/** Resolve CSS escapes the way the tokenizer does: `\6e` is `n`, `\2d ` is `-` with its terminating
 *  space consumed, `\.` is a literal dot. A decoded character that would change the parse stays
 *  escaped (a delimiter outside a string, the quote or a backslash inside one); the readers below
 *  take such a `\x` as one literal character and `unescape` it where a name is compared. */
function decodeEscapes(text: string): string {
  let out = "";
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== "\\") {
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      out += c;
      continue;
    }
    const next = text[i + 1] ?? "";
    if (next === "" || next === "\n" || next === "\r") {
      // Inside a string, backslash-newline is a line continuation. Outside one it is no escape.
      if (quote && next) i += next === "\r" && text[i + 2] === "\n" ? 2 : 1;
      else out += c;
      continue;
    }
    const hex = /^[0-9a-fA-F]{1,6}/.exec(text.slice(i + 1, i + 7))?.[0];
    let ch: string;
    if (hex) {
      const cp = parseInt(hex, 16);
      ch = cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? "�" : String.fromCodePoint(cp);
      i += hex.length;
      const ws = text[i + 1];
      if (ws === "\r" && text[i + 2] === "\n") i += 2;
      else if (ws === " " || ws === "\t" || ws === "\n" || ws === "\r" || ws === "\f") i += 1;
    } else {
      ch = next;
      i += 1;
    }
    const keep = quote ? ch === quote || ch === "\\" : ch.charCodeAt(0) < 0x80 && !/^[\w-]$/.test(ch);
    out += keep ? `\\${ch}` : ch;
  }
  return out;
}

type Decl = { file: string; selector: string; prop: string; value: string };

/** Split `s` on `sep` wherever it sits outside (), [], quotes and escapes. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      cur += s.slice(i, i + 2);
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const j = skipString(s, i);
      cur += s.slice(i, j);
      i = j - 1;
      continue;
    }
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === sep && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** A nested rule's full selector: `&` stands for the parent, and a bare selector is its descendant. */
function nest(parent: string | null, sel: string): string {
  if (!parent) return sel;
  return splitTop(parent, ",")
    .flatMap((p) => splitTop(sel, ",").map((s) => (s.includes("&") ? s.split("&").join(p.trim()) : `${p.trim()} ${s.trim()}`)))
    .join(", ");
}

const KEYFRAMES = "@keyframes "; // a keyframe block's declarations sit under "@keyframes <name>"

/** Every declaration in one sheet, with the full selector of the style rule it sits in. At-rule
 *  blocks are descended, and nested rules are read (App.css nests under `:root[data-motion]`). */
function declarations(file: string, text: string): Decl[] {
  const out: Decl[] = [];
  const stack: (string | null)[] = []; // the style selector in force at each depth; null = none
  let buf = "";
  let parens = 0;
  const emit = () => {
    const selector = stack[stack.length - 1];
    const colon = buf.indexOf(":");
    if (selector && colon > 0) {
      const value = buf.slice(colon + 1).replace(/!important/i, "").trim();
      out.push({ file, selector, prop: unescape(buf.slice(0, colon).trim()).toLowerCase(), value });
    }
    buf = "";
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      buf += text.slice(i, i + 2);
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const j = skipString(text, i);
      buf += text.slice(i, j);
      i = j - 1;
      continue;
    }
    if (c === "(") parens++;
    else if (c === ")") parens--;
    else if (parens === 0 && c === "{") {
      const prelude = buf.trim();
      const parent = stack[stack.length - 1] ?? null;
      const kf = /^@(?:-\w+-)?keyframes\s+(\S+)/i.exec(prelude); // at-rule names are ASCII-case-insensitive
      if (parent?.startsWith(KEYFRAMES)) stack.push(parent);
      else if (kf) stack.push(KEYFRAMES + unescape(kf[1].replace(/^(["'])([\s\S]*)\1$/, "$2")));
      else stack.push(prelude.startsWith("@") ? parent : nest(parent, prelude));
      buf = "";
      continue;
    } else if (parens === 0 && (c === ";" || c === "}")) {
      emit();
      if (c === "}") stack.pop();
      continue;
    }
    buf += c;
  }
  return out;
}

/** An element of the spec card: its tag, classes, class attribute, attribute names and parent. A
 *  null parent is the page above the card, which the guard cannot see, so any selector may match it. */
type El = { tag: string; classes: string[]; classAttr: string; attrs: string[]; parent: El | null };

const TSX = readFileSync(join("src", "surfaces", "HomeConsole.tsx"), "utf8");
const SITE_AT = TSX.indexOf('<section className="hc-specs"');
const SITE = TSX.slice(SITE_AT, TSX.indexOf("</section>", SITE_AT) + "</section>".length);
const SPECBOX_AT = TSX.indexOf("function SpecBox(");
const SPECBOX = TSX.slice(SPECBOX_AT, TSX.indexOf("\n}\n", SPECBOX_AT));

/** The card's element tree, read from the Detected tile's markup and SpecBox's. A component tag
 *  renders markup the guard does not read, so what sits under it gets the unknown parent. */
const CARD_ELS: El[] = (() => {
  const els: El[] = [];
  let boxParent: El | null = null;
  const read = (src: string, stack: (El | null)[]) => {
    for (const [, close, tag, rest, self] of src.matchAll(/<(\/?)([A-Za-z][\w.]*)([^<>]*?)(\/?)>/g)) {
      if (close) {
        stack.pop();
        continue;
      }
      const parent = stack[stack.length - 1] ?? null;
      if (/^[A-Z]/.test(tag)) {
        if (tag === "SpecBox") boxParent = parent;
        if (!self) stack.push(null);
        continue;
      }
      const classAttr = /\bclassName="([^"]*)"/.exec(rest)?.[1] ?? "";
      const attrs = [...rest.matchAll(/([a-zA-Z][\w-]*)=/g)].map((a) => (a[1] === "className" ? "class" : a[1]));
      const el = { tag, classes: classAttr.split(/\s+/).filter(Boolean), classAttr, attrs: attrs.filter((a) => a !== "key"), parent };
      els.push(el);
      if (!self) stack.push(el);
    }
  };
  if (SITE_AT < 0 || SPECBOX_AT < 0) throw new Error("the Detected tile's markup moved — point the guard at it");
  read(SITE, []);
  read(SPECBOX, [boxParent]);
  return els;
})();

/** Every card element carrying `cls`. */
function elements(cls: string): El[] {
  const els = CARD_ELS.filter((el) => el.classes.includes(cls));
  if (els.length === 0) throw new Error(`no spec-card element carries .${cls} in a static className`);
  return els;
}

/** Whether a class attribute value satisfies `[class <op> "want"]`. */
function attrMatch(have: string, op: string, want: string, fold: boolean): boolean {
  const [h, w] = fold ? [have.toLowerCase(), want.toLowerCase()] : [have, want];
  if (op === "=") return h === w;
  if (op === "~=") return h.split(/\s+/).includes(w);
  if (op === "|=") return h === w || h.startsWith(`${w}-`);
  if (op === "^=") return w !== "" && h.startsWith(w);
  if (op === "$=") return w !== "" && h.endsWith(w);
  return w !== "" && h.includes(w); // *=
}

type Reach = "named" | "generic" | "no";

/** A complex selector's compounds, and the combinator before each one after the first. */
function compounds(sel: string): { cs: string[]; combs: string[] } {
  const cs: string[] = [];
  const combs: string[] = [];
  let cur = "";
  let comb = " ";
  let depth = 0;
  const t = sel.trim();
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    let piece = c;
    if (c === "\\") {
      piece = t.slice(i, i + 2);
      i++;
    } else if (c === '"' || c === "'") {
      const j = skipString(t, i);
      piece = t.slice(i, j);
      i = j - 1;
    } else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && /[\s>+~]/.test(c)) {
      if (cur) {
        cs.push(cur);
        cur = "";
        comb = " ";
      }
      if (c.trim()) comb = c;
      continue;
    }
    if (!cur && cs.length) combs.push(comb);
    cur += piece;
  }
  if (cur) cs.push(cur);
  return { cs, combs };
}

/** Whether what sits left of compound k can match, given that compound k matched `el`. Only a
 *  child combinator into a parent the guard knows can rule it out; the page above may match anything. */
function above(cs: string[], combs: string[], k: number, el: El): boolean {
  if (k === 0 || combs[k - 1] !== ">" || el.parent === null) return true;
  return compound(cs[k - 1], el.parent) !== "no" && above(cs, combs, k - 1, el.parent);
}

/** How a selector list can reach `el`. "named": a subject (last compound) names one of its classes.
 *  "generic": a bare type or universal subject that matches its tag. "no": neither. */
function reach(list: string, el: El): Reach {
  let best: Reach = "no";
  for (const sel of splitTop(list, ",")) {
    const { cs, combs } = compounds(sel);
    const r = cs.length ? compound(cs[cs.length - 1], el) : "no";
    if (r === "no" || !above(cs, combs, cs.length - 1, el)) continue;
    if (r === "named") return r;
    best = r;
  }
  return best;
}

/** Match one compound selector against `el`. It errs toward a match: a class `el` lacks rules the
 *  compound out unless another part names `el`. :not() and :has() never exclude, and a
 *  pseudo-element counts as its element. Forms it cannot read throw instead of passing. */
function compound(s: string, el: El): Reach {
  let named = false;
  let foreign = false;
  const type = /^(\*|[a-zA-Z][\w-]*)/.exec(s)?.[1];
  if (type && type !== "*" && type.toLowerCase() !== el.tag) return "no";
  let i = type?.length ?? 0;
  const ident = () => {
    const m = /^(?:[\w-]|[^\x00-\x7f]|\\[\s\S])+/.exec(s.slice(i))?.[0] ?? "";
    i += m.length;
    return unescape(m);
  };
  // s[i] is `open`. Returns what sits inside, and leaves i just past the matching `close`.
  const group = (open: string, close: string) => {
    const start = i + 1;
    let depth = 0;
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === "\\") i++;
      else if (c === '"' || c === "'") i = skipString(s, i) - 1;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) break;
    }
    return s.slice(start, i++);
  };
  const also = (r: Reach) => {
    if (r === "named") named = true;
    return r !== "no";
  };
  while (i < s.length) {
    const c = s[i];
    if (c === ".") {
      i++;
      if (el.classes.includes(ident())) named = true;
      else foreign = true;
    } else if (c === "#") {
      i++;
      ident();
      if (!el.attrs.includes("id")) return "no";
    } else if (c === "[") {
      const a =
        /^\s*((?:[\w-]|\\[\s\S])+)\s*(?:([~|^$*]?=)\s*("(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|(?:[^\s\]\\]|\\[\s\S])+)\s*([is])?)?\s*$/i.exec(
          group("[", "]"),
        );
      if (!a) throw new Error(`unreadable attribute selector in "${s}" — teach the guard its form`);
      const name = unescape(a[1]).toLowerCase();
      const want = a[3] === undefined ? "" : unescape(a[3].replace(/^(["'])([\s\S]*)\1$/, "$2"));
      if (name !== "class") {
        if (!el.attrs.includes(name)) return "no";
      } else if (!a[2] || attrMatch(el.classAttr, a[2], want, /i/i.test(a[4] ?? ""))) {
        named = true;
      } else return "no";
    } else if (c === ":") {
      const element = s[i + 1] === ":";
      i += element ? 2 : 1;
      const name = ident().toLowerCase();
      const arg = s[i] === "(" ? group("(", ")") : null;
      if (element) continue;
      if (name === "root") return "no"; // :scope stays open: inside @scope it can be a card element
      if (/^(is|where|matches|-webkit-any|-moz-any)$/.test(name) && arg !== null && !also(reach(arg, el))) return "no";
      const of = /^nth-(last-)?child$/.test(name) ? /\sof\s([\s\S]+)$/.exec(arg ?? "")?.[1] : undefined;
      if (of !== undefined && !also(reach(of, el))) return "no";
    } else throw new Error(`unreadable selector "${s}" — teach the guard its form`);
  }
  return named ? "named" : foreign ? "no" : "generic";
}

const SHEET = join("src", "surfaces", "home-console.css");
const ALL: Decl[] = (readdirSync("src", { recursive: true }) as string[])
  .filter((f) => f.endsWith(".css"))
  .flatMap((f) => declarations(join("src", f), prepare(readFileSync(join("src", f), "utf8"))));

/** The animation declarations a card element may carry, byte for byte after `prepare`, each with the
 *  keyframes name it runs. The value is pinned whole so no reading of the shorthand is needed: which
 *  token is the name, whether an escape hides a digit. A pinned value holds no var(), env() or attr()
 *  in any case (dynamic()), so nothing set at runtime can change what it runs. */
const ANIMATIONS = new Map<string, string>([
  ["v2-hc-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) backwards", "v2-hc-rise"], // the Detected tile's entrance
  ["v2-sheet-rise 0.26s cubic-bezier(0.2, 0.7, 0.3, 1) both", "v2-sheet-rise"], // a sheet's children, cards among them
]);
/** Every spelling of the two properties that choose a card's keyframes, vendor prefixes included. */
const ANIMATION_PROP = /^(-\w+-)?animation(-name)?$/;
/** Properties a card's keyframes may animate: paint, and transforms, which never move a grid track
 *  (the guard's contract is the tile's layout, not where a card is painted). */
const NO_LAYOUT = /^(opacity|transform|translate|scale|rotate|filter|backdrop-filter|color|background(-color|-position)?|box-shadow|text-shadow|border-color|outline(-color|-offset)?|offset-distance)$/;

/** A keyframes block can animate a width or a track onto a card, so every animation-choosing
 *  declaration that reaches a card must be a pinned value (ANIMATIONS); each pinned name must be
 *  declared, and every block of that name, in any sheet and any at-rule spelling, may animate
 *  NO_LAYOUT properties only. Returns one line per fault; an empty list is the proof (Codex review of
 *  PR 624, rounds 4 to 6). */
function animationFaults(all: Decl[], cards: El[]): string[] {
  const frames = new Map<string, Decl[]>();
  for (const d of all) {
    if (!d.selector.startsWith(KEYFRAMES)) continue;
    const name = d.selector.slice(KEYFRAMES.length);
    frames.set(name, [...(frames.get(name) ?? []), d]);
  }
  const faults: string[] = [];
  for (const d of all) {
    if (!ANIMATION_PROP.test(d.prop) || d.selector.startsWith(KEYFRAMES)) continue;
    if (!cards.some((el) => reach(d.selector, el) !== "no")) continue;
    const name = ANIMATIONS.get(d.value);
    if (!name) {
      faults.push(`${where(d)}: not a pinned card animation`);
      continue;
    }
    const block = frames.get(name);
    if (!block) {
      faults.push(`${where(d)}: "${name}" names no keyframes block in any sheet under src/`);
      continue;
    }
    for (const k of block) {
      if (!NO_LAYOUT.test(k.prop)) faults.push(`${where(d)}: @keyframes ${name} animates ${k.prop}, which changes layout`);
    }
  }
  return faults;
}

/** Every declaration of `props`, in every sheet, whose rule can reach an element carrying `.cls`. */
const on = (cls: string, props: string[]) => {
  const els = elements(cls);
  return ALL.filter(
    (d) => props.includes(d.prop) && !d.selector.startsWith(KEYFRAMES) && els.some((el) => reach(d.selector, el) !== "no"),
  );
};
const V2 = '[data-v2="on"]';

/** Every `repeat(auto-fit|auto-fill, minmax(<min>, <max>))` in a value: its keyword, its minimum,
 *  and where it starts and ends. */
function autoRepeats(value: string): { kind: string; min: string; start: number; end: number }[] {
  const out: { kind: string; min: string; start: number; end: number }[] = [];
  for (const m of value.matchAll(/repeat\(\s*auto-(fit|fill)\s*,\s*minmax\(/g)) {
    // Walk minmax's first argument to its comma, then on to the `)` that closes repeat.
    let i = m.index! + m[0].length;
    let depth = 0;
    let min = "";
    for (; i < value.length; i++) {
      const c = value[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "," && depth === 0) break;
      min += c;
    }
    for (depth = 2; i < value.length && depth > 0; i++) {
      if (value[i] === "(") depth++;
      else if (value[i] === ")") depth--;
    }
    out.push({ kind: m[1], min: min.trim(), start: m.index!, end: i });
  }
  return out;
}

/** The px a track minimum resolves to inside a container `w` px wide. Unknown forms throw. */
function resolveMin(min: string, w: number): number {
  const px = min.match(/^(\d+(?:\.\d+)?)px$/);
  if (px) return Number(px[1]);
  const clamp = min.match(/^min\(\s*([^,]+?)\s*,\s*([^,]+?)\s*\)$/);
  if (clamp) return Math.min(resolveMin(clamp[1], w), resolveMin(clamp[2], w));
  const pct = min.match(/^(\d+(?:\.\d+)?)%$/);
  if (pct) return (Number(pct[1]) / 100) * w;
  throw new Error(`unrecognised track minimum "${min}" — teach resolveMin its form`);
}

// Content-box widths the hero tile really takes, from the 380px minWidth up past the point where
// the clamp stops mattering. 1280x720 and wider sit far above the top of this range.
const WIDTHS = Array.from({ length: 74 }, (_, k) => 60 + k * 10);
/** The spec grid's one track list. Pinned whole: a second track inside the repeat() would pass every
 *  check on the first (Codex round 8), so the value itself is the guard. */
const TRACKS = "repeat(auto-fit, minmax(min(230px, 100%), 1fr))";
const GRID_PROPS = ["grid-template-columns", "grid-template", "grid"];
const CARD = ["hc-specs", "hc-specs-grid", "hc-spec", "hc-spec-title", "hc-spec-rows", "hc-spec-row", "hc-spec-k", "hc-spec-v"];
const where = (d: Decl) => `${d.file} "${d.selector}" { ${d.prop}: ${d.value} }`;
/** A value the guard cannot read statically: a banned keyword could arrive through it. */
const dynamic = (v: string) => /\b(var|env|attr)\(/i.test(v);
/** Wrapping values a card element may carry: each one wraps, and none is a cascade keyword. */
const WRAPS = /^(normal|pre-wrap|pre-line|break-spaces|wrap|balance|pretty|stable|wrap\s+(balance|pretty|stable)|(balance|pretty|stable)\s+wrap)$/i;

describe("Health's Detected tile — spec cards never overflow their tile (#614)", () => {
  it("every track list on .hc-specs-grid, in every sheet, is one auto-fit clamp that fits its container", () => {
    const decls = on("hc-specs-grid", GRID_PROPS);
    expect(decls.some((d) => d.selector.includes(V2) && d.prop === "grid-template-columns")).toBe(true);
    for (const d of decls) {
      // A shorthand or a fixed track list would override the clamp without this guard seeing it.
      expect(d.prop, `${where(d)}: set the spec grid's tracks with grid-template-columns`).toBe(
        "grid-template-columns",
      );
      expect(d.value.replace(/\s+/g, " ").trim(), `${where(d)}: the spec grid's tracks are pinned whole`).toBe(TRACKS);
      // What the pin holds, spelled out: one auto-fit repeat whose minimum never exceeds the container.
      const reps = autoRepeats(d.value);
      const whole = reps.length === 1 && reps[0].start === 0 && reps[0].end === d.value.length;
      expect(whole, `${where(d)}: must be exactly one repeat(auto-fit, minmax(...))`).toBe(true);
      // auto-fill keeps empty tracks, so the cards stop filling the tile's width.
      expect(reps[0].kind, `${where(d)}: the spec grid is auto-fit, not auto-fill`).toBe("fit");
      for (const w of WIDTHS) {
        expect(resolveMin(reps[0].min, w), `${where(d)}: wider than a ${w}px container`).toBeLessThanOrEqual(w);
      }
      // The clamp changes nothing where the tile is wide: the cards still ask for 230px there.
      for (const w of [230, 400, 700]) expect(resolveMin(reps[0].min, w), where(d)).toBe(230);
    }
    // Those tracks only exist while the spec grid is a grid.
    const displays = on("hc-specs-grid", ["display"]);
    expect(displays.some((d) => d.selector.includes(V2))).toBe(true);
    for (const d of displays) expect(d.value, `${where(d)}: the spec grid must stay a grid`).toBe("grid");
  });

  it("no auto-fit/auto-fill track in home-console.css asks for more width than its container has", () => {
    const tracks = ALL.filter((d) => d.file === SHEET && GRID_PROPS.includes(d.prop)).flatMap((d) =>
      autoRepeats(d.value).map((r) => ({ d, min: r.min })),
    );
    expect(tracks.length).toBeGreaterThan(0);
    for (const { d, min } of tracks) {
      for (const w of WIDTHS) {
        expect(resolveMin(min, w), `${where(d)}: track minimum "${min}" is wider than a ${w}px container`).toBeLessThanOrEqual(w);
      }
    }
  });

  // A card clamped to a 62px tile is only half the fix. Its title, keys and values must also yield
  // inside it, or they cross the card's frame and the defect moves one box inward. Measured on the
  // unfixed build at 504px: "PROCESSOR" alone is wider than the card's content box. Each property
  // must be set under v2 scope, and every declaration of it anywhere must agree, because a later one
  // wins.
  const pinned = (cls: string, props: string[], ok: (v: string) => boolean, why: string) => {
    const decls = on(cls, props);
    expect(decls.some((d) => d.selector.includes(V2)), `.${cls} needs its ${props[0]} under ${V2}`).toBe(true);
    for (const d of decls) expect(ok(d.value), `${where(d)}: ${why}`).toBe(true);
  };

  it("a spec card's own contents yield before they cross its frame", () => {
    const anywhere = (v: string) => v === "anywhere";
    pinned("hc-spec-title", ["overflow-wrap", "word-wrap"], anywhere, "a card title must break inside a narrow card");
    pinned("hc-spec-k", ["overflow-wrap", "word-wrap"], anywhere, "a key must break inside a narrow card");
    pinned("hc-spec-v", ["overflow-wrap", "word-wrap"], anywhere, "a value must break inside a narrow card");
    pinned("hc-spec-row", ["display"], (v) => v === "flex", "a row wraps only while it is a flex row");
    pinned("hc-spec-row", ["flex-wrap", "flex-flow"], (v) => /(^|\s)wrap(\s|$)/.test(v), "a row must wrap its value under its key");
    pinned("hc-spec-k", ["max-width"], (v) => /^(\d+(\.\d+)?)%$/.test(v) && parseFloat(v) <= 100, "a key must never outgrow its row");
    pinned("hc-spec-v", ["min-width"], (v) => /^0(px)?$/.test(v), "a value must be able to shrink");

    // Wrapping is inherited, so the card declares its own: `white-space: normal` and `text-wrap: wrap`
    // on .hc-spec beat anything an ancestor sets, and the guard reads no ancestor (Codex round 7).
    // Inside the card every wrapping value must be one that wraps; a cascade keyword (inherit, unset,
    // revert) would reopen the inheritance the pin closes. `all` resets every property at once, so no
    // card element may set it.
    pinned("hc-spec", ["white-space"], (v) => v === "normal", "the card declares its own wrapping");
    pinned("hc-spec", ["text-wrap"], (v) => v === "wrap", "the card declares its own wrapping");
    for (const cls of CARD) {
      for (const d of on(cls, ["white-space", "text-wrap", "text-wrap-mode"])) {
        expect(WRAPS.test(d.value), `${where(d)}: this stops a spec card's text from wrapping, or reopens inheritance`).toBe(true);
      }
      expect(on(cls, ["all"]).map(where), "`all` would reset the card's rules").toEqual([]);
    }
  });

  // The clamp keeps the tracks inside the tile. A fixed width, a card spanning a second column, or
  // a grid that flows into new columns would push past the tile anyway.
  it("nothing else in a spec card asks for more width than its tile has", () => {
    const fits = (v: string) => {
      if (v === "auto" || v === "0") return true;
      try {
        return WIDTHS.every((w) => resolveMin(v, w) <= w);
      } catch {
        return false; // a length the guard cannot resolve (20ch, 12rem) is not proven to fit
      }
    };
    for (const cls of CARD) {
      for (const d of on(cls, ["width", "min-width", "inline-size", "min-inline-size"])) {
        expect(fits(d.value), `${where(d)}: wider than a narrow tile`).toBe(true);
      }
    }
    // `display: contents` on a card element hands its children to the grid as items of their own, and
    // a placement on any of them could then open a second column (Codex round 7). So no card element
    // may be `contents` or take a cascade keyword that could become it, and nothing from the spec
    // grid inward carries a grid placement (the .hc-specs section is the bento grid's item, placed by it).
    for (const cls of CARD) {
      for (const d of on(cls, ["display"])) {
        const promotes = /contents|inherit|unset|revert|initial/i.test(d.value) || dynamic(d.value);
        expect(promotes, `${where(d)}: a card element keeps its own display`).toBe(false);
      }
      if (cls === "hc-specs") continue;
      const placement = ["grid-column", "grid-column-start", "grid-column-end", "grid-row", "grid-row-start", "grid-row-end", "grid-area"];
      expect(on(cls, placement).map(where), `.${cls} takes no grid placement`).toEqual([]);
    }
    expect(on("hc-specs-grid", ["grid-template-areas"]).map(where)).toEqual([]);
    // The grid flows by row, pinned to the spellings that do: a column flow, or one inherited from an
    // ancestor, would add implicit columns, and `grid-auto-columns` would size them (Codex round 10).
    for (const d of on("hc-specs-grid", ["grid-auto-flow"])) {
      expect(d.value.trim(), `${where(d)}: the spec grid flows by row`).toMatch(/^(row|row\s+dense|dense\s+row|dense)$/i);
    }
    expect(on("hc-specs-grid", ["grid-auto-columns"]).map(where), "no implicit column is sized").toEqual([]);
    // The width proof above measures the border box: `box-sizing: content-box` would add padding and
    // border to a `width: 100%` card and push past the track (Codex round 10). The sheet resets every
    // element to border-box, and no card element may set anything else, by keyword or through a var().
    const reset = ALL.find((d) => d.file.endsWith("App.css") && d.selector === "*" && d.prop === "box-sizing");
    expect(reset?.value.trim().toLowerCase(), "the universal border-box reset in src/App.css").toBe("border-box");
    for (const cls of CARD) {
      for (const d of on(cls, ["box-sizing"])) {
        expect(!dynamic(d.value) && d.value.trim().toLowerCase() === "border-box", `${where(d)}: a card element keeps its border box`).toBe(true);
      }
    }
  });

  // The wrap above must not change the approved wide layout (#225): at 1280 and 1500 every key and
  // value still share one line. So the three numbers that decide when a row wraps are pinned, in both
  // directions. The value's basis must stay 6ch. A 0 basis never wraps, and a narrow card crushes the
  // value into a letter-per-line column beside its key. A wide basis (auto, 100%) drops values under
  // their keys even in the wide tracks. The key stays unflexed, and the gap between them stays the
  // 12px the wide layout was approved with.
  it("the rules that decide when a row wraps keep the wide layout unchanged", () => {
    pinned("hc-spec-v", ["flex"], (v) => /^1\s+1\s+6ch$/.test(v), "the value's flex must stay `1 1 6ch`");
    expect(on("hc-spec-v", ["flex-grow", "flex-shrink", "flex-basis"]).map(where)).toEqual([]);
    pinned("hc-spec-k", ["flex"], (v) => v === "none", "the key must stay unflexed");
    expect(on("hc-spec-k", ["flex-grow", "flex-shrink", "flex-basis"]).map(where)).toEqual([]);
    pinned(
      "hc-spec-row",
      ["gap", "grid-gap", "column-gap", "grid-column-gap"],
      (v) => (v.trim().split(/\s+/).pop() ?? "") === "12px",
      "the key–value gap must stay 12px",
    );
    for (const d of on("hc-spec-row", ["flex-direction", "flex-flow"])) {
      const turns = /column|reverse/i.test(d.value) || dynamic(d.value);
      expect(turns, `${where(d)}: a row keeps its key on the left of its value`).toBe(false);
    }
  });

  // An inline style beats every sheet, so the component must not set one on a spec card, by any
  // spelling: a style prop, a spread that could carry one, a <style> element, raw HTML, a ref that
  // could style the node, or an element the guard does not read (Codex review of PR 624, round 3).
  // The guard reads each card element's classes from its static className, so a computed one would
  // hide a class from it.
  // A handler on a card element would hand it to code as currentTarget, and a class or id added
  // there at runtime could match a rule the guard reads as unreachable (Codex round 8). So the card
  // markup carries no handler, no id and no class or attribute write: its class set is the static one.
  it("SpecBox sets no inline style by any spelling, and no class the guard cannot read", () => {
    for (const src of [SITE, SPECBOX]) {
      expect(src).not.toMatch(/\bstyle\b/i);
      expect(src).not.toMatch(/\.\.\./);
      expect(src).not.toMatch(/createElement|dangerouslySetInnerHTML|\bref=|<link/i);
      expect(src).not.toMatch(/className=\{/);
      expect(src, "a handler on a card element would hand it to code").not.toMatch(/\bon[A-Z]\w*=/);
      expect(src, "a card element carries no id and no runtime class or attribute write").not.toMatch(
        /\bid=|classList|className\s*=[^"]|setAttribute/,
      );
    }
    expect(SPECBOX).toContain('className="hc-spec-v');
    // The tree it reads is the card as rendered: a value sits in a row, in the rows, in a card, in the grid.
    const path = (el: El | null): string => (el ? `${path(el.parent)} > ${el.tag}.${el.classes[0]}` : "…");
    expect(path(elements("hc-spec-v")[0])).toBe(
      "… > section.hc-specs > div.hc-specs-grid > div.hc-spec > dl.hc-spec-rows > div.hc-spec-row > dd.hc-spec-v",
    );
    for (const cls of CARD) expect(elements(cls).length, `.${cls}`).toBeGreaterThan(0);
  });

  // The readers above must see what a browser sees. Each spelling here passed the round-2 guard
  // while overriding the clamp.
  it("reads escaped spellings of a property or a class the way CSS does", () => {
    const sheet = prepare(
        '[data-v2="on"] .hc-specs\\2d grid { grid-template-colum\\6e s: 230px }\n' +
          '[class=hc\\2d spec] { wid\\74 h: 400px; content: "a\\"b" }\n' +
          ".hc-spec\\.x { width: 500px }\n" +
          ".hc-spec\\:x { width: 600px }\n" +
          ":is(.hc\\-specs-grid, .other) { grid-template-columns: 240px }",
    );
    const decls = declarations("fixture.css", sheet);
    expect(decls.map((d) => [d.selector, d.prop, d.value])).toEqual([
      ['[data-v2="on"] .hc-specs-grid', "grid-template-columns", "230px"],
      ["[class=hc-spec]", "width", "400px"],
      ["[class=hc-spec]", "content", '"a\\"b"'],
      [".hc-spec\\.x", "width", "500px"],
      [".hc-spec\\:x", "width", "600px"],
      [":is(.hc-specs-grid, .other)", "grid-template-columns", "240px"],
    ]);
    const grid = elements("hc-specs-grid")[0];
    const card = elements("hc-spec")[0];
    expect(reach(decls[0].selector, grid)).toBe("named");
    expect(reach(decls[1].selector, card)).toBe("named");
    // These two name the classes `hc-spec.x` and `hc-spec:x`, which no card carries.
    expect(reach(decls[3].selector, card)).toBe("no");
    expect(reach(decls[4].selector, card)).toBe("no");
    expect(reach(decls[5].selector, grid)).toBe("named");
  });

  // The CSS parser turns a form feed into a newline before tokenizing, so a backslash before one is a
  // string continuation and vanishes: `[class="hc-specs-grid\<FF>"]` matches the grid in a browser.
  it("reads a backslash before a form feed as the string continuation it is (Codex round 4)", () => {
    const decls = declarations("fixture.css", prepare('[class="hc-specs-grid\\\f"] { grid-template-columns: 230px }'));
    expect(decls.map((d) => [d.selector, d.prop, d.value])).toEqual([['[class="hc-specs-grid"]', "grid-template-columns", "230px"]]);
    expect(reach(decls[0].selector, elements("hc-specs-grid")[0])).toBe("named");
  });

  // A keyframes block is the one place a width can reach a card without a width declaration on a
  // rule that names it: `animation: widen 1ms forwards` leaves the card at the block's width. The
  // value is pinned whole, so the ways of smuggling a name past a reader (a name that is also a
  // timing keyword, an escaped leading digit, a var() fallback, a vendor-prefixed property) all read
  // as "not pinned"; a pinned value holds no function that could be redefined at runtime.
  it("a spec card runs only the pinned animations, and those move paint, never layout (Codex rounds 4 to 6)", () => {
    const cards = CARD.flatMap((cls) => elements(cls));
    expect(animationFaults(ALL, cards)).toEqual([]);
    expect(ANIMATIONS.size).toBe(2); // the pin is the whole allowance; widen it only in review
    for (const value of ANIMATIONS.keys()) expect(dynamic(value), `${value}: a pinned animation holds no var(), env() or attr()`).toBe(false);
    const fixture = (css: string) => declarations("fixture.css", prepare(css));
    const evasion = fixture(
      "@keyframes widen { to { width: 400px } }\n" +
        "@keyframes linear { to { width: 400px } }\n" +
        "@keyframes \\31 widen { to { width: 400px } }\n" +
        "@-webkit-keyframes slide { to { width: 400px } }\n" +
        "@keyframes fade { from { opacity: 0 } to { opacity: 1 } }\n" +
        ':root[data-v2="on"] .hc-spec { animation: widen 1ms forwards }\n' +
        ".hc-spec-row { animation-name: linear; animation-duration: 1ms; animation-fill-mode: forwards }\n" +
        ".hc-spec-v { animation-name: \\31 widen }\n" +
        ".not-card { --anim: none }\n" +
        ".hc-spec-k { animation-name: var(--anim, widen) }\n" +
        ".hc-spec-row { -webkit-animation: slide 1ms forwards }\n" +
        ".hc-spec-v { -WEBKIT-ANIMATION-NAME: slide }\n" +
        ".hc-spec-row { animation: fade 1s }\n",
    );
    expect(animationFaults(evasion, cards)).toEqual([
      'fixture.css ":root[data-v2="on"] .hc-spec" { animation: widen 1ms forwards }: not a pinned card animation',
      'fixture.css ".hc-spec-row" { animation-name: linear }: not a pinned card animation',
      'fixture.css ".hc-spec-v" { animation-name: 1widen }: not a pinned card animation',
      'fixture.css ".hc-spec-k" { animation-name: var(--anim, widen) }: not a pinned card animation',
      'fixture.css ".hc-spec-row" { -webkit-animation: slide 1ms forwards }: not a pinned card animation',
      'fixture.css ".hc-spec-v" { -webkit-animation-name: slide }: not a pinned card animation',
      'fixture.css ".hc-spec-row" { animation: fade 1s }: not a pinned card animation',
    ]);
    // The pinned value itself is only as safe as the blocks behind it: a second block under the
    // pinned name, in any at-rule spelling or nesting, and a missing block each fault.
    const pinned = ".hc-spec { animation: v2-hc-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) backwards }\n";
    const behind = fixture(
      "@keyframes v2-hc-rise { to { opacity: 1 } }\n" +
        "@keyframes v2\\-hc-rise { to { width: 400px } }\n" +
        "@media (max-width: 700px) { @KEYFRAMES v2-hc-rise { to { height: 400px } } }\n" +
        "@-WEBKIT-KEYFRAMES v2-hc-rise { to { min-width: 400px } }\n" +
        pinned,
    );
    expect(animationFaults(behind, cards)).toEqual([
      'fixture.css ".hc-spec" { animation: v2-hc-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) backwards }: @keyframes v2-hc-rise animates width, which changes layout',
      'fixture.css ".hc-spec" { animation: v2-hc-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) backwards }: @keyframes v2-hc-rise animates height, which changes layout',
      'fixture.css ".hc-spec" { animation: v2-hc-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) backwards }: @keyframes v2-hc-rise animates min-width, which changes layout',
    ]);
    expect(animationFaults(fixture(pinned), cards)).toEqual([
      'fixture.css ".hc-spec" { animation: v2-hc-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) backwards }: "v2-hc-rise" names no keyframes block in any sheet under src/',
    ]);
  });

  // A <style> element or a runtime stylesheet is document-scoped wherever it is written, so the
  // card's markup is not the only place one could reach the card from. Every TypeScript file under
  // src/ is read with its comments out: none may hold a <style> element; the one file allowed to
  // build a stylesheet at runtime (the per-room accent picks in theme.ts, pinned whole by the
  // census) must not know the card's classes; and only the file that renders the card may spell them
  // at all, so no other file can query for one (Codex rounds 4 and 7). The Web Animations API is
  // banned by type in the census; its two constructors are banned here by name as well.
  it("no TypeScript file under src/ injects a stylesheet or knows the spec card (Codex rounds 4 and 7)", () => {
    const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
    const SOURCES = (readdirSync("src", { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => join("src", f).replace(/\\/g, "/"));
    const RUNTIME_SHEET = new Set(["src/design/theme.ts"]);
    const RENDERS_CARD = "src/surfaces/HomeConsole.tsx";
    expect(SOURCES.length).toBeGreaterThan(100);
    let runtime = 0;
    for (const f of SOURCES) {
      const src = code(f);
      expect(src, `${f}: a <style> element is document-scoped and would beat the sheets`).not.toMatch(/<style[\s>\/]/i);
      expect(src, `${f}: the Web Animations API could size a card with no sheet`).not.toMatch(/KeyframeEffect|new Animation\(/);
      if (f !== RENDERS_CARD) expect(src, `${f}: only HomeConsole.tsx may know the spec card's classes`).not.toMatch(/hc-spec/);
      const builds = /createElement\(\s*["'`]style|insertRule|adoptedStyleSheets|<link[\s>\/]|dangerouslySetInnerHTML/.test(src);
      if (!builds) continue;
      runtime++;
      expect(RUNTIME_SHEET.has(f), `${f}: builds a stylesheet at runtime; the guard cannot read it`).toBe(true);
      expect(src, `${f}: a runtime stylesheet must not know the spec card`).not.toMatch(/hc-spec/);
    }
    expect(runtime, "the allowed runtime stylesheet still exists; retire it from RUNTIME_SHEET if not").toBe(RUNTIME_SHEET.size);
    // The file that renders the card holds no card element (no ref on one, above; no query or walk here).
    expect(code(RENDERS_CARD)).not.toMatch(/querySelector|getElementsBy|\.children\b|ElementChild|ElementSibling/);
    // The one id the census lets code write is the runtime stylesheet's own, and no rule uses it.
    expect(code("src/design/theme.ts")).toContain('const ROOM_ACCENTS_STYLE_ID = "compy-room-accents"');
    expect(ALL.filter((d) => unescape(d.selector).includes("#compy-room-accents")).map(where)).toEqual([]);
  });

  // A class or data attribute added to a card at runtime is the one way a rule the guard reads as
  // unreachable (its class or attribute is in no static markup) could reach a card (Codex rounds 8
  // to 10). The census proves the pins are the only such writes under src/; here, for every pinned
  // carries that name. Those rules may paint, set custom properties or run a layout-safe animation,
  // and nothing else.
  it("no pinned runtime class or data attribute can size a spec card (Codex rounds 8 to 10)", () => {
    expect(CLASS_WRITES.size + DATA_WRITES.size).toBeGreaterThan(0);
    const frames = new Map<string, Decl[]>();
    for (const d of ALL) {
      if (!d.selector.startsWith(KEYFRAMES)) continue;
      const name = d.selector.slice(KEYFRAMES.length);
      frames.set(name, [...(frames.get(name) ?? []), d]);
    }
    const PAINT = (p: string) => NO_LAYOUT.test(p) || p.startsWith("--") || /^(cursor|pointer-events|user-select|visibility|will-change|transition(-[a-z]+)?)$/.test(p);
    const safeAnimation = (d: Decl): boolean => {
      if (dynamic(d.value)) return false;
      if (/^none$/i.test(d.value.trim())) return true;
      const blocks = d.value.split(/[\s,]+/).filter((t) => frames.has(t));
      return blocks.length > 0 && blocks.every((b) => frames.get(b)!.every((k) => NO_LAYOUT.test(k.prop)));
    };
    const carrying = (el: El, cls: string | null, attr: string | null): El => ({
      ...el,
      classes: cls ? [...el.classes, cls] : el.classes,
      classAttr: cls ? `${el.classAttr} ${cls}`.trim() : el.classAttr,
      attrs: attr ? [...el.attrs, attr] : el.attrs,
    });
    const names: [string, string | null, string | null][] = [
      ...[...CLASS_WRITES.values()].flat().map((c): [string, string | null, string | null] => [c, c, null]),
      ...[...DATA_WRITES.values()].flat().map((n): [string, string | null, string | null] => {
        const attr = "data-" + n.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
        return [attr, null, attr];
      }),
    ];
    const rules = ALL.filter((d) => !d.selector.startsWith(KEYFRAMES));
    for (const [ident, cls, attr] of names) {
      for (const d of rules) {
        if (!unescape(d.selector).includes(ident)) continue;
        for (const el of CARD_ELS) {
          if (reach(d.selector, el) !== "no" || reach(d.selector, carrying(el, cls, attr)) === "no") continue;
          const ok = PAINT(d.prop) || (ANIMATION_PROP.test(d.prop) && safeAnimation(d));
          expect(ok, `${where(d)}: a runtime "${ident}" would let this size a <${el.tag} class="${el.classAttr}">`).toBe(true);
        }
      }
    }
  });
});
