import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync } from "fs";
import { join } from "path";
import ts from "typescript";
import { CLASS_WRITES, DATA_WRITES, DOM_WRITES, JSX_CARDS, JSX_STYLED } from "./test/dom-mutation-pins";
import { PICKABLE_ROOMS, ROOM_ACCENT_SWATCHES, isSwatchHex, splitSwatchKey, swatchInk, swatchKey, swatchText } from "./design/room-identity";

// Every runtime DOM write under src/, found by type, not by spelling (Codex review of PR 624,
// round 10). The overflow guard (src/surfaces/hc-specs-grid-overflow-guard.test.ts) proves from
// the sheets and the static markup that Health's spec cards cannot outgrow their tile. Code can
// beat a sheet at runtime: an inline style, a class, a data attribute, an id, an attribute, a
// stylesheet it builds. Rounds 7 to 9 pinned those writes by regex, and round 10 showed the regex
// could be aliased around: `const inline = el.style; inline.minWidth = …`, `Object.assign(el,
// { className })`, a runtime stylesheet that never spells the card's class.
//
// This census asks the TypeScript checker instead. Every expression in every non-test file under
// src/ is typed, and its type is read back to the lib.dom interface it derives from, through
// unions, base types and type-parameter constraints. An expression typed as an element, a
// document, or a styling surface (CSSStyleDeclaration, DOMTokenList, DOMStringMap, NamedNodeMap,
// StylePropertyMap, a stylesheet) is then held to a shape: a styling surface may only be the
// receiver of a property access (no alias, argument, destructuring, index or spread, so there is
// nothing to alias around); a write through one is a row in the census; a call on one is either a
// read, a pinned class literal, or a custom-property setProperty; an element may be written,
// called or indexed only in the pinned ways; and a DOM value may not be laundered into `any`,
// `unknown`, `object`, an in-repo structural type that exposes a styling member, or an untyped
// function, by assertion, argument, initializer, return, JSX prop or callback annotation.
//
// WHAT THIS FILE CLAIMS. The rows in src/test/dom-mutation-pins.ts are the only runtime DOM writes
// under src/; a new one, however spelled, is a visible change to that file. The one runtime
// stylesheet (theme.ts's per-room accent picks) is pinned whole and can only set custom
// properties to whitelisted colours. The program under census is the type-checked one: a type
// error would let an expression escape its type, so the census fails on any diagnostic. It reads
// src/ and nothing else.

const SOURCES = (readdirSync("src", { recursive: true }) as string[])
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => join("src", f).replace(/\\/g, "/"));

/** lib.dom interfaces through which an element's styling is written. Any occurrence of one outside
 *  the shapes below is a fault. */
const STYLING = new Set([
  "CSSStyleDeclaration", "DOMTokenList", "DOMStringMap", "NamedNodeMap", "Attr",
  "StylePropertyMap", "StylePropertyMapReadOnly", "CSSStyleValue",
  "StyleSheet", "CSSStyleSheet", "StyleSheetList", "CSSRule", "CSSRuleList",
  "ShadowRoot", "DOMParser",
  // The Web Animations API sizes an element with no sheet, and a Range or Selection rewrites the
  // tree around one. None is used; none may be.
  "Animation", "AnimationEffect", "KeyframeEffect", "AnimationTimeline", "DocumentTimeline",
  "Range", "StaticRange", "Selection",
]);
/** Members of an element (or document) that style it, name it for a rule, or build markup. An
 *  `any`-typed receiver may not access one; an element may write or call one only as pinned. */
const SURFACE = new Set([
  "style", "classList", "className", "dataset", "attributes", "attributeStyleMap", "id", "part", "slot",
  "innerHTML", "outerHTML", "insertAdjacentHTML", "setHTMLUnsafe",
  "setAttribute", "setAttributeNS", "setAttributeNode", "setAttributeNodeNS", "toggleAttribute",
  "removeAttribute", "removeAttributeNS", "removeAttributeNode", "animate", "attachShadow",
  "createElement", "createElementNS", "adoptedStyleSheets", "styleSheets", "insertRule",
  "cssText", "setProperty", "removeProperty", "write", "writeln", "execCommand",
]);
/** Element methods that write an attribute, markup or an animation: banned outright. */
const ELEMENT_BANNED = new Set([
  "setAttribute", "setAttributeNS", "setAttributeNode", "setAttributeNodeNS", "toggleAttribute",
  "removeAttribute", "removeAttributeNS", "removeAttributeNode", "insertAdjacentHTML", "setHTMLUnsafe",
  "animate", "attachShadow", "getAttributeNode", "getAttributeNodeNS",
]);
/** Element (or node) methods that rewrite the tree: each call is a census row. */
const TREE_CALLS = new Set([
  "append", "appendChild", "prepend", "insertBefore", "replaceChild", "replaceWith", "replaceChildren",
  "before", "after", "insertAdjacentElement", "insertAdjacentText", "remove", "cloneNode", "requestFullscreen",
]);
const DOCUMENT_BANNED = new Set(["createElementNS", "write", "writeln", "execCommand", "open", "importNode", "adoptNode", "createRange", "createDocumentFragment"]);
/** Element properties no row may name: a class set, markup, a styling map, a shadow part, a slot. */
const ELEMENT_NEVER_WRITTEN = /^(className|innerHTML|outerHTML|attributeStyleMap|part|slot|innerText)$/;
/** Inline style properties a pinned write may set: paint only. */
const PAINT = /^(opacity|transform|transition|cursor)$/;
/** Library APIs, by the symbol a call resolves to (see libApi), never by spelling, so
 *  `globalThis.Object.assign`, `const assign = Object.assign` and `Object["assign"]` are all the same API.
 *  REFLECT_API reaches into an object past the checker: with a DOM-typed (or laundered) target it writes
 *  what the census cannot see, so its first argument must be a plain in-repo record and no argument may
 *  be a DOM value. INVOKE_API rebinds a function's receiver. CODE_API runs code from a string or proxies. */
const REFLECT_API = /^(ObjectConstructor\.(assign|defineProperty|defineProperties|setPrototypeOf)|Reflect\.(set|defineProperty|setPrototypeOf|apply|construct))$/;
const INVOKE_API = /^(CallableFunction|NewableFunction|Function)\.(call|apply|bind)$/;
const CODE_API = /^(\.eval|FunctionConstructor\.|ProxyConstructor\.)$/;
/** A class-name token the overflow guard owns: the spec card, its parts and its grid. */
const GUARDED = /^hc-spec/;
const GUARDED_TEXT = /hc-spec/;
/** The pins module spells guarded names in its JSX_CARDS rows; the overflow guard proves each row is a card element. */
const PINS = "src/test/dom-mutation-pins.ts";

type Category = "element" | "document" | "styling" | null;
type Found = {
  rows: string[];
  classes: Map<string, Set<string>>;
  data: Map<string, Set<string>>;
  /** JSX elements whose literal class names carry a guarded token: `file JSX <tag> class=... attrs=...`. */
  jsx: string[];
  /** JSX elements the checker cannot read the class names of that carry a style, id, markup or spread prop: tags per file. */
  styled: Map<string, Set<string>>;
  faults: string[];
};

let program: ts.Program;
let checker: ts.TypeChecker;
let found: Found;

const DOM_LIB = /lib\.dom(\.\w+)?\.d\.ts$/;
const isDomLibDecl = (d: ts.Node) => DOM_LIB.test(d.getSourceFile().fileName);
const isLibDecl = (d: ts.Node) => {
  const sf = d.getSourceFile();
  return program.isSourceFileDefaultLibrary(sf) || /[\\/]node_modules[\\/]/.test(sf.fileName);
};
/** The library API a call or construction resolves to, as `<owner>.<member>`: an interface member
 *  (`ObjectConstructor.assign`, `CallableFunction.call`), a namespace function (`Reflect.set`), a global
 *  function (`.eval`) or an interface's own call/construct signature (`FunctionConstructor.`,
 *  `ProxyConstructor.`). Null when the signature is not from a library or did not resolve. */
const libApi = (n: ts.CallExpression | ts.NewExpression): string | null => {
  const d = checker.getResolvedSignature(n)?.declaration;
  if (!d || ts.isJSDocSignature(d) || !isLibDecl(d)) return null;
  const owner = ts.isInterfaceDeclaration(d.parent) || ts.isClassDeclaration(d.parent) ? (d.parent.name?.text ?? "")
    : ts.isModuleBlock(d.parent) ? d.parent.parent.name.getText() : "";
  const member = d.name && !ts.isComputedPropertyName(d.name) ? d.name.getText() : "";
  return `${owner}.${member}`;
};
const decls = (t: ts.Type) => t.getSymbol()?.declarations ?? [];
const parts = (t: ts.Type): ts.Type[] => (t.isUnionOrIntersection() ? t.types.flatMap(parts) : [t]);
const isArrayish = (t: ts.Type) => checker.isArrayType(t) || checker.isTupleType(t);
const typeArgs = (t: ts.Type): readonly ts.Type[] =>
  t.flags & ts.TypeFlags.Object && (t as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference ? checker.getTypeArguments(t as ts.TypeReference) : [];

/** The names of the lib.dom interfaces a type derives from: its own symbol, its base types, and the
 *  constraint of a type parameter, through unions and intersections. */
const chainCache = new Map<ts.Type, Set<string>>();
function chain(t: ts.Type): Set<string> {
  const hit = chainCache.get(t);
  if (hit) return hit;
  const out = new Set<string>();
  chainCache.set(t, out);
  for (const p of parts(t)) {
    if (p.flags & ts.TypeFlags.Instantiable) {
      const c = checker.getBaseConstraintOfType(p);
      if (c) for (const n of chain(c)) out.add(n);
      continue;
    }
    if (!(p.flags & ts.TypeFlags.Object)) continue;
    const sym = p.getSymbol();
    const decl = decls(p)[0];
    if (sym && decl && isDomLibDecl(decl)) out.add(sym.name);
    const o = p as ts.ObjectType;
    if (o.objectFlags & (ts.ObjectFlags.Class | ts.ObjectFlags.Interface | ts.ObjectFlags.Reference)) {
      const target = (o.objectFlags & ts.ObjectFlags.Reference ? (o as ts.TypeReference).target : o) as ts.InterfaceType;
      let bases: ts.BaseType[] = [];
      try {
        bases = checker.getBaseTypes(target);
      } catch {
        bases = [];
      }
      for (const b of bases) for (const n of chain(b)) out.add(n);
    }
  }
  return out;
}
function category(t: ts.Type): Category {
  const names = chain(t);
  for (const n of names) if (STYLING.has(n)) return "styling";
  if (names.has("Document")) return "document";
  if (names.has("Element") || names.has("Node")) return "element"; // a text node or fragment is held to the same shape
  return null;
}
/** Does a type mention lib.dom anywhere: itself, a constituent, an element type, a type argument? */
function mentionsDom(t: ts.Type, depth = 0, seen = new Set<ts.Type>()): boolean {
  if (seen.has(t) || depth > 3) return false;
  seen.add(t);
  for (const p of parts(t)) {
    if (p.flags & ts.TypeFlags.Instantiable) {
      const c = checker.getBaseConstraintOfType(p);
      if (c && mentionsDom(c, depth + 1, seen)) return true;
      continue;
    }
    if (!(p.flags & ts.TypeFlags.Object)) continue;
    const decl = decls(p)[0];
    if (decl && isDomLibDecl(decl)) return true;
    for (const a of typeArgs(p)) if (mentionsDom(a, depth + 1, seen)) return true;
  }
  return false;
}
const isAny = (t: ts.Type) => !!(t.flags & ts.TypeFlags.Any);
const isUnknown = (t: ts.Type) => !!(t.flags & ts.TypeFlags.Unknown);
const isObjectKeyword = (t: ts.Type) => !!(t.flags & ts.TypeFlags.NonPrimitive);
const isEmptyObject = (t: ts.Type) =>
  !!(t.flags & ts.TypeFlags.Object) && checker.getPropertiesOfType(t).length === 0 && checker.getIndexInfosOfType(t).length === 0 &&
  checker.getSignaturesOfType(t, ts.SignatureKind.Call).length === 0 && checker.getSignaturesOfType(t, ts.SignatureKind.Construct).length === 0;

/** An index-signature value a styling surface could hide behind: `any`, or an in-repo object (also
 *  as an array element) whose members would then be writable under any name. */
function hostile(v: ts.Type, depth = 0): boolean {
  if (depth > 3) return false;
  return parts(v).some((p) => {
    if (isAny(p)) return true;
    if (!(p.flags & ts.TypeFlags.Object)) return false;
    if (mentionsDom(p)) return false;
    if (isArrayish(p)) return typeArgs(p).some((a) => hostile(a, depth + 1));
    return true;
  });
}
/** Does a non-DOM type expose a styling member whose type is not the real DOM surface, at any depth,
 *  or index into one? A DOM value assigned to such a type can be written through without the
 *  checker seeing a DOM write. `strict` is set when the value being typed could be a DOM value (a
 *  DOM-typed or opaque source): then `id` counts too, and a string index over an in-repo object does
 *  (`Record<string, { width: string }>` reads `x.style.width`). Data records name ids and index
 *  objects everywhere, so neither counts for a value that is already typed as data. */
function exposes(t: ts.Type, strict: boolean, depth = 0, seen = new Set<ts.Type>()): string | null {
  if (seen.has(t) || depth > 3) return null;
  seen.add(t);
  for (const p of parts(t)) {
    if (p.flags & ts.TypeFlags.Instantiable) {
      const c = checker.getBaseConstraintOfType(p);
      const r = c ? exposes(c, strict, depth + 1, seen) : null;
      if (r) return r;
      continue;
    }
    if (!(p.flags & ts.TypeFlags.Object)) continue;
    const sym = p.getSymbol();
    if (sym && (sym.flags & (ts.SymbolFlags.ValueModule | ts.SymbolFlags.NamespaceModule) || sym.name === "globalThis")) continue; // a namespace, not a value shape
    const decl = decls(p)[0];
    if (decl && isDomLibDecl(decl)) continue; // the real surface: a write through it is a census row
    if (isArrayish(p)) {
      for (const a of typeArgs(p)) {
        const r = exposes(a, strict, depth + 1, seen);
        if (r) return r;
      }
      continue;
    }
    for (const info of checker.getIndexInfosOfType(p)) {
      if (isAny(info.type)) return "an index signature over any";
      if (strict && info.keyType.flags & ts.TypeFlags.String && hostile(info.type)) return "a string index whose values could stand in for a styling surface";
    }
    for (const prop of checker.getPropertiesOfType(p)) {
      const name = prop.getName();
      const pt = checker.getTypeOfSymbol(prop);
      if (SURFACE.has(name) && (strict || name !== "id")) {
        if (isAny(pt) || !mentionsDom(pt)) return `a structural "${name}"`;
        continue;
      }
      const r = exposes(pt, strict, depth + 1, seen);
      if (r) return r;
    }
  }
  return null;
}
/** May a DOM value flow into a slot of this type? `lib`: the slot is declared by library code, whose
 *  body cannot be edited here; an `any`, `unknown` or unconstrained slot there is closed at the write
 *  end instead (SURFACE on `any`, assertion targets, reflection). */
function judge(t: ts.Type, lib: boolean): string | null {
  for (const p of parts(t)) {
    if (isAny(p)) return lib ? null : "any";
    if (isUnknown(p)) return lib ? null : "unknown";
    if (isObjectKeyword(p) || isEmptyObject(p)) return lib ? null : "object";
    if (p.flags & ts.TypeFlags.Instantiable) {
      const c = checker.getBaseConstraintOfType(p);
      if (!c) {
        if (lib) continue;
        return "an unconstrained type parameter";
      }
      const r = judge(c, lib);
      if (r) return r;
      continue;
    }
    if (p.flags & ts.TypeFlags.Object) {
      const r = exposes(p, true);
      if (r) return r;
    }
  }
  return null;
}

const text = (n: ts.Node) => n.getText().replace(/\s+/g, " ").trim();
const at = (f: string, n: ts.Node) => `${f}:${n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
const literal = (n: ts.Node): string | null =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : null;
const isAssignOp = (k: ts.SyntaxKind) => k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment;
/** Is `n` written by its context: an assignment target (also through a destructuring pattern or a
 *  for-of/for-in head), or an increment? */
function isWriteTarget(n: ts.Node): boolean {
  let cur: ts.Node = n;
  for (;;) {
    const p = cur.parent;
    if (ts.isParenthesizedExpression(p) || ts.isArrayLiteralExpression(p) || ts.isSpreadElement(p) || ts.isSpreadAssignment(p)) cur = p;
    else if (ts.isPropertyAssignment(p) && p.initializer === cur) cur = p;
    else if (ts.isObjectLiteralExpression(p)) cur = p;
    else break;
  }
  const p = cur.parent;
  if (ts.isBinaryExpression(p) && p.left === cur && isAssignOp(p.operatorToken.kind)) return true;
  if ((ts.isForOfStatement(p) || ts.isForInStatement(p)) && p.initializer === cur) return true;
  if (ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) {
    return p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken;
  }
  return false;
}
/** A wrapper that keeps the value and its type: the census judges the outermost one. */
const transparent = (n: ts.Node) =>
  (ts.isParenthesizedExpression(n.parent) || ts.isNonNullExpression(n.parent)) ||
  ((ts.isAsExpression(n.parent) || ts.isSatisfiesExpression(n.parent) || ts.isTypeAssertionExpression(n.parent)) &&
    category(checker.getTypeAtLocation(n.parent)) === category(checker.getTypeAtLocation(n)));
/** The identifier is bound by a declaration, not a value reference. */
function isDeclarationName(n: ts.Node): boolean {
  const p = n.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === n) return true;
  if (ts.isJsxAttribute(p) || ts.isJsxOpeningLikeElement(p) || ts.isJsxClosingElement(p)) return true;
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isExportSpecifier(p)) return true;
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return true;
  if (ts.isPropertyAssignment(p) && p.name === n) return true;
  if ((ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p) || ts.isEnumMember(p)) && p.name === n) return true;
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p) || ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassExpression(p)) && p.name === n) return true;
  if (ts.isBindingElement(p) && p.propertyName === n) return true;
  if (ts.isQualifiedName(p) || ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p)) return true;
  return false;
}
function inTypePosition(n: ts.Node): boolean {
  for (let u: ts.Node | undefined = n; u; u = u.parent) {
    if (ts.isTypeNode(u) || ts.isTypeAliasDeclaration(u) || ts.isInterfaceDeclaration(u) || ts.isImportDeclaration(u) || ts.isExportDeclaration(u)) return true;
  }
  return false;
}
/** `getComputedStyle(...)`, or an identifier declared from one: a read-only surface. */
function isComputedStyle(n: ts.Node): boolean {
  let e: ts.Node = n;
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  if (ts.isCallExpression(e)) return /^(window\.|globalThis\.)?getComputedStyle$/.test(text(e.expression));
  if (ts.isIdentifier(e)) {
    const d = checker.getSymbolAtLocation(e)?.valueDeclaration;
    return !!d && ts.isVariableDeclaration(d) && !!d.initializer && isComputedStyle(d.initializer);
  }
  return false;
}

function censusFile(f: string, out: Found) {
  const sf = program.getSourceFile(f);
  if (!sf) throw new Error(`${f}: not in the program`);
  const fault = (n: ts.Node, why: string) => out.faults.push(`${at(f, n)}: ${why}: \`${text(n).slice(0, 90)}\``);
  const row = (kind: string, name: string, receiver: ts.Node) => out.rows.push(`${f} ${kind} ${name} on ${text(receiver)}`);
  const add = (m: Map<string, Set<string>>, v: string) => (m.get(f) ?? m.set(f, new Set()).get(f)!).add(v);

  // JSX, by the AST and the checker. The class names of an element are read when they are literal
  // (a string, or an expression whose type is string literals): an element whose literal names carry
  // a guarded token is a census row with its tag, class attribute and attribute names, and may hold
  // no style, id-less markup or spread prop, so a second render path for a spec card anywhere under
  // src/ is a visible pin change. An element whose class names the checker cannot enumerate could
  // render anything, so if it also carries a style, id, markup or spread prop it is pinned by tag.
  const literalTokens = (e: ts.Expression | undefined): string[] | null => {
    if (!e) return [];
    if (ts.isStringLiteralLike(e)) return e.text.split(/\s+/).filter(Boolean);
    if (ts.isJsxExpression(e)) return e.expression ? literalTokens(e.expression) : [];
    if (ts.isParenthesizedExpression(e)) return literalTokens(e.expression);
    const ps = parts(checker.getTypeAtLocation(e));
    const blank = ts.TypeFlags.Undefined | ts.TypeFlags.Null;
    if (ps.length && ps.every((p) => p.isStringLiteral() || p.flags & blank)) {
      return ps.flatMap((p) => (p.isStringLiteral() ? p.value.split(/\s+/).filter(Boolean) : []));
    }
    return null;
  };
  const jsxRule = (el: ts.JsxOpeningLikeElement) => {
    const tag = el.tagName.getText();
    let tokens: string[] | null = [];
    let classAttr = "";
    let carries = false;
    let spread = false;
    const names: string[] = [];
    for (const a of el.attributes.properties) {
      if (ts.isJsxSpreadAttribute(a)) {
        spread = true;
        const t = checker.getTypeAtLocation(a.expression);
        const has = (n: string) => isAny(t) || isUnknown(t) || !!checker.getPropertyOfType(t, n);
        if (has("className") || has("class")) tokens = null;
        if (has("style") || has("id") || has("dangerouslySetInnerHTML")) carries = true;
        continue;
      }
      const n = a.name.getText();
      names.push(n === "className" ? "class" : n);
      if (n === "className" || n === "class") {
        const lt = literalTokens(a.initializer);
        if (lt === null) tokens = null;
        else if (tokens !== null) tokens.push(...lt);
        classAttr = a.initializer ? text(a.initializer).replace(/^\{|\}$/g, "") : "";
      }
      if (n === "style" || n === "id" || n === "dangerouslySetInnerHTML") carries = true;
    }
    if (tokens !== null && tokens.some((t) => GUARDED.test(t))) {
      if (carries || spread) return fault(el, `a guarded JSX element <${tag}> carries a style, id, markup or spread prop`);
      out.jsx.push(`${f} JSX <${tag}> class=${classAttr} attrs=${names.filter((n) => n !== "key").sort().join(",")}`);
    } else if (tokens === null && (carries || spread)) add(out.styled, tag);
  };
  const isClassAttrValue = (n: ts.Node) => {
    let p = n.parent;
    if (ts.isJsxExpression(p)) p = p.parent;
    return ts.isJsxAttribute(p) && /^(className|class)$/.test(p.name.getText());
  };

  /** A DOM value flows into a slot: judge the slot. */
  const flow = (n: ts.Node, slot: ts.Type | undefined, lib: boolean, how: string) => {
    if (!slot) return;
    const r = judge(slot, lib);
    if (r) fault(n, `a DOM value flows ${how} into ${r}`);
  };
  /** A callback whose contextual counterpart takes a DOM value must take it as the DOM type. */
  const callbackShape = (n: ts.Node, own: ts.Type, ctx: ts.Type) => {
    const ownSigs = checker.getSignaturesOfType(own, ts.SignatureKind.Call);
    if (!ownSigs.length) return;
    for (const cs of parts(ctx).flatMap((p) => checker.getSignaturesOfType(p, ts.SignatureKind.Call))) {
      cs.getParameters().forEach((cp, i) => {
        const ct = checker.getTypeOfSymbol(cp);
        if (!mentionsDom(ct)) return;
        for (const os of ownSigs) {
          const op = os.getParameters()[i];
          if (!op) continue;
          const ot = checker.getTypeOfSymbol(op);
          if (isAny(ot) || isUnknown(ot) || mentionsDom(ot)) continue;
          fault(n, `callback parameter "${op.getName()}" retypes a DOM value as ${checker.typeToString(ot)}`);
        }
      });
    }
  };

  const visit = (node: ts.Node) => {
    ts.forEachChild(node, visit);
    if (ts.isJsxOpeningLikeElement(node)) jsxRule(node);

    // A guarded class name may be spelled only as a class attribute: not handed to a component by
    // another prop, not built into a selector, not kept for a later className. Both checks run before
    // the expression filter below, which takes a JSX attribute's own string for a declaration name:
    // behind it `<div data-cls="hc-spec" />` was never read (round-11 falsification, route r11-1e).
    if (node.parent && f !== PINS && ts.isStringLiteralLike(node) && GUARDED_TEXT.test(node.text) && !isClassAttrValue(node)) {
      fault(node, "a guarded class name in a string that is not a class attribute");
    }
    if (node.parent && ts.isTemplateExpression(node) && [node.head, ...node.templateSpans.map((s) => s.literal)].some((l) => GUARDED_TEXT.test(l.text))) {
      fault(node, "a guarded class name in a template");
    }

    if (!node.parent || inTypePosition(node) || !ts.isExpression(node) || isDeclarationName(node)) return;
    if (ts.isJsxAttribute(node.parent) && node.parent.name === node) return;

    // Destructuring a DOM value hands its surfaces out as aliases.
    if (ts.isVariableDeclaration(node.parent) && node.parent.initializer === node && !ts.isIdentifier(node.parent.name)) {
      if (category(checker.getTypeAtLocation(node))) fault(node, "a DOM value is destructured");
    }

    const type = checker.getTypeAtLocation(node);
    const cat = category(type);

    // Reflection, by the symbol the call resolves to: the first argument must be a plain in-repo
    // record, never a DOM value or a laundered one. Code from a string and proxies are out.
    const api = ts.isCallExpression(node) || ts.isNewExpression(node) ? libApi(node) : null;
    if (api && ts.isCallExpression(node) && REFLECT_API.test(api)) {
      const target = node.arguments[0];
      if (!target) return;
      const tt = checker.getTypeAtLocation(target);
      const plain = ts.isObjectLiteralExpression(target) || ts.isArrayLiteralExpression(target) ||
        (!judge(tt, false) && !mentionsDom(tt) && !parts(tt).some((p) => p.flags & ts.TypeFlags.Instantiable));
      if (!plain) fault(node, "reflection on a value that could be a DOM surface");
    }
    if (api && CODE_API.test(api)) fault(node, "code from a string, or a proxy");

    // Assertions: a target that is a structural look-alike of a surface, or `any`, launders any value.
    if ((ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node))) {
      const src = checker.getTypeAtLocation(node.expression);
      const srcCat = category(src);
      const opaque = isUnknown(src) || isObjectKeyword(src) || isEmptyObject(src) || parts(src).some((p) => p.flags & ts.TypeFlags.Instantiable);
      if (srcCat) flow(node, type, false, "by assertion");
      else {
        const r = exposes(type, srcCat !== null || opaque) ?? (isAny(type) && (opaque || srcCat) ? "any" : null);
        if (r) fault(node, `an assertion to ${r}`);
      }
    }

    // Callbacks: any function-typed expression judged against the slot it fills.
    const ctx = checker.getContextualType(node);
    if (ctx && !cat && checker.getSignaturesOfType(type, ts.SignatureKind.Call).length) callbackShape(node, type, ctx);

    // `any` may not reach a surface: that is how a laundered element would be written.
    if (isAny(type)) {
      const p = node.parent;
      if (ts.isPropertyAccessExpression(p) && p.expression === node && SURFACE.has(p.name.text)) fault(p, "a styling member on an `any`");
      if (ts.isElementAccessExpression(p) && p.expression === node) fault(p, "indexing an `any`");
      return;
    }
    if (!cat || transparent(node)) return;

    const p = node.parent;
    const access = ts.isPropertyAccessExpression(p) && p.expression === node ? p : null;
    if (!access) {
      // Positions other than "receiver of a property access".
      if (ts.isElementAccessExpression(p) && p.expression === node) return fault(p, `indexing a DOM ${cat}`);
      if (ts.isSpreadElement(p) || ts.isSpreadAssignment(p)) return fault(p, `spreading a DOM ${cat}`);
      if (ts.isDeleteExpression(p)) return fault(p, "delete on a DOM value");
      if (cat === "styling" && !isComputedStyle(node)) return fault(node, "a styling surface held outside a property access");
      if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.includes(node as ts.Expression)) {
        const api = libApi(p);
        if (api && (REFLECT_API.test(api) || INVOKE_API.test(api))) return fault(p, "a DOM value passed through reflection or call/apply/bind");
        const sig = checker.getResolvedSignature(p);
        const decl = sig?.declaration;
        if (!decl || ts.isJSDocSignature(decl)) return fault(p, "a DOM value passed to an untyped function");
        const i = p.arguments.indexOf(node as ts.Expression);
        const params = decl.parameters;
        let param = params[i];
        if (!param && params.length && params[params.length - 1].dotDotDotToken) param = params[params.length - 1];
        if (!param) return fault(p, "a DOM value passed past the declared parameters");
        const lib = isLibDecl(decl);
        if (param.type) {
          let declared = checker.getTypeFromTypeNode(param.type);
          if (param.dotDotDotToken && isArrayish(declared)) declared = typeArgs(declared)[0] ?? declared;
          flow(node, declared, lib, `as an argument of ${text(p.expression).slice(0, 40)}`);
        } else if (!lib) return fault(p, "a DOM value passed to an unannotated parameter");
        return flow(node, ctx, true, `as an argument of ${text(p.expression).slice(0, 40)}`);
      }
      if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent)) return flow(node, ctx, false, `as JSX prop ${p.parent.name.getText()}`);
      if (ctx && !(ts.isBinaryExpression(p) && !isAssignOp(p.operatorToken.kind)) && !ts.isConditionalExpression(p)) {
        flow(node, ctx, false, ts.isReturnStatement(p) ? "by return" : ts.isArrowFunction(p) ? "by return" : `into ${ts.SyntaxKind[p.kind]}`);
      }
      return;
    }

    const name = access.name.text;
    const gp = access.parent;
    const call = ts.isCallExpression(gp) && gp.expression === access ? gp : null;
    const writes = isWriteTarget(access);
    const deleted = ts.isDeleteExpression(gp);

    if (cat === "styling") {
      const names = chain(type);
      const kind = [...names].find((n) => STYLING.has(n))!;
      if (!/^(CSSStyleDeclaration|DOMTokenList|DOMStringMap)$/.test(kind)) return fault(node, `a ${kind} is never touched`);
      if (isComputedStyle(node) && (writes || deleted || (call && /^(setProperty|removeProperty)$/.test(name)))) return fault(access, "writing a computed style");
      if (kind === "DOMStringMap") {
        if (call) return fault(gp, "a call on dataset");
        if (writes || deleted) add(out.data, name);
        return;
      }
      if (kind === "DOMTokenList") {
        if (writes || deleted) return fault(access, "writing classList itself");
        if (!call) return;
        if (!/^(add|remove)$/.test(name)) return /^(contains|item|forEach|entries|keys|values|supports)$/.test(name) ? undefined : fault(gp, "a classList call that is not add/remove");
        for (const a of call.arguments) {
          const lit = literal(a);
          if (lit === null || !/^[\w-]+$/.test(lit)) return fault(gp, "a class name that is not one literal");
          add(out.classes, lit);
        }
        return;
      }
      // CSSStyleDeclaration
      if (deleted) return fault(gp, "delete on style");
      if (writes) return row("CSSStyleDeclaration.write", name, node);
      if (!call) return;
      if (/^(setProperty|removeProperty)$/.test(name)) {
        const lit = literal(call.arguments[0] ?? call);
        if (lit === null || !lit.startsWith("--")) return fault(gp, `${name} without a literal custom property`);
        return row(`CSSStyleDeclaration.${name}`, lit, node);
      }
      if (!/^(getPropertyValue|getPropertyPriority|item)$/.test(name)) fault(gp, "a style call that is not a read");
      return;
    }
    if (cat === "document") {
      if (writes || deleted) return fault(access, "writing a document property");
      if (/^(adoptedStyleSheets|styleSheets)$/.test(name)) return fault(access, "a document stylesheet list");
      if (!call) return;
      if (DOCUMENT_BANNED.has(name)) return fault(gp, `document.${name}`);
      if (name === "createElement") {
        const lit = literal(call.arguments[0] ?? call);
        if (lit === null) return fault(gp, "createElement without a literal tag");
        return row("Document.createElement", lit, node);
      }
      return;
    }
    // element
    if (deleted) return fault(gp, "delete on an element property");
    if (writes) return row("Element.write", name, node);
    if (call && ELEMENT_BANNED.has(name)) return fault(gp, `element.${name}`);
    if (call && TREE_CALLS.has(name)) return row("Element.call", name, node);
    if (name === "adoptedStyleSheets") fault(access, "a shadow root stylesheet list");
  };
  visit(sf);
}

const fold = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1").replace(/\s+/g, " ").trim();
function fn(file: string, name: string): ts.FunctionDeclaration {
  const sf = program.getSourceFile(file)!;
  const d = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name);
  if (!d) throw new Error(`${file}: no function ${name}`);
  return d;
}

describe("DOM mutation census: every runtime DOM write under src/ is pinned by type (Codex round 10)", () => {
  beforeAll(() => {
    const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile("tsconfig.json", ts.sys.readFile).config, ts.sys, ".");
    program = ts.createProgram(SOURCES, { ...cfg.options, noUnusedLocals: false, noUnusedParameters: false });
    checker = program.getTypeChecker();
    found = { rows: [], classes: new Map(), data: new Map(), jsx: [], styled: new Map(), faults: [] };
    for (const f of SOURCES) censusFile(f, found);
  }, 120_000);

  it("the program under census type-checks, so every expression has the type the census read", () => {
    expect(SOURCES.length).toBeGreaterThan(100);
    expect(SOURCES).toContain("src/test/setup.ts");
    const diagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]
      .filter((d) => d.category === ts.DiagnosticCategory.Error)
      .map((d) => `${d.file?.fileName ?? "?"}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
    expect(diagnostics).toEqual([]);
    // The categories resolve to lib.dom, not to a same-named in-repo type.
    const sf = program.getSourceFile("src/design/theme.ts")!;
    let seen = 0;
    const look = (n: ts.Node) => {
      if (ts.isIdentifier(n) && n.text === "document" && !isDeclarationName(n)) {
        seen++;
        expect(category(checker.getTypeAtLocation(n))).toBe("document");
      }
      ts.forEachChild(n, look);
    };
    look(sf);
    expect(seen).toBeGreaterThan(0);
  });

  it("no expression under src/ touches the DOM outside the pinned shapes", () => {
    expect(found.faults).toEqual([]);
  });

  it("the writes found are exactly the pinned rows, classes, data keys and JSX elements", () => {
    const sorted = (m: Map<string, Set<string>>) => [...m.entries()].map(([f, s]) => [f, [...s].sort()] as const).sort();
    const pinned = (m: Map<string, string[]>) => [...m.entries()].map(([f, v]) => [f, [...v].sort()] as const).sort();
    expect([...new Set(found.rows)].sort()).toEqual([...DOM_WRITES].sort());
    expect(sorted(found.classes)).toEqual(pinned(CLASS_WRITES));
    expect(sorted(found.data)).toEqual(pinned(DATA_WRITES));
    expect([...new Set(found.jsx)].sort()).toEqual([...JSX_CARDS].sort());
    expect(sorted(found.styled)).toEqual(pinned(JSX_STYLED));
  });

  it("no pinned row can size, rename or restyle an element the sheets lay out", () => {
    for (const r of DOM_WRITES) {
      const m = /^(\S+) (\S+) (\S+) on (.+)$/.exec(r)!;
      const [, file, kind, name, receiver] = m;
      if (kind === "Element.write") {
        expect(name, r).not.toMatch(ELEMENT_NEVER_WRITTEN);
        if (name === "id") expect(file, "only the runtime accent stylesheet is given an id").toBe("src/design/theme.ts");
        if (/^(width|height)$/.test(name)) expect(receiver, `${r}: a bitmap size, on a <canvas> only`).toBe("canvas");
      } else if (kind === "CSSStyleDeclaration.write") {
        const canvas = /ElectricBorder/.test(file) && receiver === "canvas.style" && /^(width|height)$/.test(name);
        expect(PAINT.test(name) || canvas, `${r}: an inline style write must paint`).toBe(true);
      } else if (kind === "CSSStyleDeclaration.setProperty") {
        expect(name, r).toMatch(/^--/);
      } else if (kind === "Document.createElement") {
        expect([file, name], "the one runtime element is the accent stylesheet").toEqual(["src/design/theme.ts", "style"]);
      } else if (kind === "Element.call") {
        // The tree is rewritten in one place: the accent stylesheet goes into <head> and comes out.
        expect(file, r).toBe("src/design/theme.ts");
        expect([name, receiver], r).toEqual(name === "remove" ? ["remove", "el"] : ["appendChild", "document.head"]);
      } else expect.fail(`unknown row kind in ${r}`);
    }
    expect(DOM_WRITES.filter((r) => / CSSStyleDeclaration\.removeProperty /.test(r))).toEqual([]);
  });

  // The one runtime stylesheet. Pinned whole: its builder, its reader, and the whitelist both lean
  // on. Its rules set custom properties only, and only to colours from ROOM_ACCENT_SWATCHES, so the
  // overflow guard's refusal of any dynamic width (var()) on a card is the end of the route.
  it("theme.ts's accent stylesheet is the pinned builder over a whitelisted store", () => {
    const apply = fn("src/design/theme.ts", "applyRoomAccents");
    expect(fold(apply.getText())).toBe(
      "export function applyRoomAccents(): void { if (typeof document === \"undefined\") return; const accents = readRoomAccents(); const entries = Object.entries(accents) as [PickableRoom, string][]; let el = document.getElementById(ROOM_ACCENTS_STYLE_ID) as HTMLStyleElement | null; if (entries.length === 0) { if (el) el.remove(); return; } const css = entries .map(([room, hex]) => { const ink = swatchInk(hex); const inkDecls = ink ? `--v2-accent-ink:${ink};--ix-accent-ink:${ink};` : \"\"; const text = swatchText(hex); const textDecls = text ? `--v2-accent-text:${text};--ix-accent-text:${text};` : \"\"; const { hex: primary, hex2 } = splitSwatchKey(hex); const washSource = hex2 ?? primary; return ( `:root[data-room-identity=\"on\"] .v2-room[data-room=\"${room}\"]{` + `--v2-accent:${primary};` + inkDecls + textDecls + `--v2-accent-dim:color-mix(in srgb, ${washSource} 14%, transparent);` + `--v2-accent-line:color-mix(in srgb, ${washSource} 25%, transparent);}` ); }) .join(\"\\n\"); if (!el) { el = document.createElement(\"style\"); el.id = ROOM_ACCENTS_STYLE_ID; document.head.appendChild(el); } el.textContent = css; }",
    );
    expect(fold(fn("src/design/theme.ts", "readRoomAccents").getText())).toBe(
      "export function readRoomAccents(): Partial<Record<PickableRoom, string>> { const out: Partial<Record<PickableRoom, string>> = {}; try { const raw = localStorage.getItem(ROOM_ACCENTS_KEY); if (!raw) return out; const parsed = JSON.parse(raw) as Record<string, unknown>; for (const room of PICKABLE_ROOMS) { const v = parsed[room]; if (typeof v === \"string\" && isSwatchHex(v)) out[room] = v.trim().toLowerCase(); } } catch { } return out; }",
    );
    // Every declaration the builder's literals spell is a custom property.
    const pieces: string[] = [];
    const walk = (n: ts.Node) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) pieces.push(n.text);
      ts.forEachChild(n, walk);
    };
    walk(apply);
    expect(pieces.length).toBeGreaterThan(5);
    for (const piece of pieces) {
      for (const m of piece.matchAll(/(?:^|[{;])\s*([-\w]+)\s*:/g)) expect(m[1], `"${piece}" declares a property that is not custom`).toMatch(/^--/);
    }
    // Every value that can be interpolated is a colour from the whitelist, or a room name.
    const HEX = /^#[0-9a-f]{6}$/;
    expect(ROOM_ACCENT_SWATCHES.length).toBeGreaterThanOrEqual(5);
    for (const s of ROOM_ACCENT_SWATCHES) {
      const key = swatchKey(s);
      expect(isSwatchHex(key), key).toBe(true);
      const { hex, hex2 } = splitSwatchKey(key);
      expect(hex).toMatch(HEX);
      if (hex2 !== undefined) expect(hex2).toMatch(HEX);
      for (const v of [swatchInk(key), swatchText(key)]) if (v !== undefined) expect(v, key).toMatch(HEX);
    }
    expect(isSwatchHex("#000000; } .hc-spec { width: 400px")).toBe(false);
    for (const room of PICKABLE_ROOMS) expect(room).toMatch(/^[a-z]+$/);
  });
});
