import { describe, expect, it } from "vitest";

// Compy may say what a change DOES: it saves the current value first, so the change can be undone. It may
// not call a change, a tweak or itself "safe", and it may not promise an undo outcome ("fully reversible",
// "all reversible", "every change undoable", "undo any time"): an undo can fail, so only the mechanism is
// stated. Product text rule: CLAUDE.md "Honesty rules", docs/PRODUCT_CONSTITUTION.md section 38 (no promises:
// "guarantee", "safe", "probably", "caused", "fixed", scores).
//
// This scan fails on, in every locale JSON (en, zh-CN, found on disk), src/data/*.json, the user-visible string
// literals of src-tauri/src/**/*.rs and the user-visible string literals and same-line JSX text of src/**/*.ts(x):
//   - safe / safely / safest / safer / safety / safeguard, risk-free, no risk, harmless, can't hurt, nothing to
//     lose, worry-free, foolproof, no downside; zh 安全 放心 无风险 没风险 无忧 无害 稳妥 保险 万无一失 不会有问题,
//   - the promise phrases listed in PROMISES below (fully reversible, all reversible, undo any time, ...).
// A hit is reworded to say what the code does, never allowlisted. The allowlist holds only class B (a proper
// name, a Windows term, or the other meaning of the Chinese word: security), each entry scoped to the file
// (and where needed the key) it was justified for, with the exact phrase and a reason. A caution passes:
// "not safe", "isn't safe", "unsafe", 不安全.
//
// Not dodgeable by case or spacing: text is Unicode-normalised (NFKC: full-width letters), zero-width and
// soft-hyphen characters are removed, whitespace (including non-breaking) is collapsed, dashes are unified and
// case is folded before the patterns run. Allowlisted phrases are cut out first, so "Safe Mode is safe" still
// fails on the second "safe".
//
// What it cannot see: raw Rust strings r#"..."#; Rust and TS literals that are a single token (an id such as
// "safe"); JSX text that spans lines; strings built at run time; text in CSS, HTML or markdown; site/ and docs/.

const LOCALE_MODULES = import.meta.glob("./locales/*/*.json", { import: "default", eager: true }) as Record<string, unknown>;
const DATA_MODULES = import.meta.glob("../data/*.json", { import: "default", eager: true }) as Record<string, unknown>;
const RUST_SOURCES = import.meta.glob("../../src-tauri/src/**/*.rs", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const TS_SOURCES = import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts", "!../**/*.test.tsx", "!../**/*.d.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const norm = (s: string): string =>
  s
    .normalize("NFKC")
    .replace(/[­​-‏⁠﻿]/g, "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[‐-―−_]/g, "-")
    .replace(/\s+/g, " ")
    .toLowerCase();

// Cautions are cut before matching: a warning that something is NOT safe is honest and must stay possible.
const CAUTIONS: ReadonlyArray<RegExp> = [
  /\b(?:not|isn't|is not|aren't|are not|wasn't|never|n't) (?:\w+ ){0,2}safe(?:ly|r|st)?\b/g,
  /\bunsafe\b/g,
  /不安全|不够安全|并不安全/g,
];

const PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["safe / safely / safest / safer / safety / safeguard", /\bsafe(?:ly|st|r|ty|guards?|guarded|guarding)?\b/],
  ["risk-free / no risk / zero risk", /\brisk[- ]?free\b|\b(?:no|zero)[- ]risk\b/],
  ["harmless", /\bharmless(?:ly)?\b/],
  ["can't hurt", /\b(?:can't|cannot|can not|cant) hurt\b/],
  ["nothing to lose", /\bnothing to lose\b/],
  ["worry-free", /\bworry[- ]?free\b/],
  ["foolproof / no downside", /\bfool-?proof\b|\bno downsides?\b/],
  ["zh: 安全 放心 无风险 没风险 无忧 无害 稳妥 保险 万无一失 不会有问题 不会出问题", /安全|放心|无风险|没风险|无忧|无害|稳妥|保险|万无一失|不会有问题|不会出问题/],
];

// An undo outcome is not promised: undo can fail (the saved plan is gone, the record is unreadable). The
// mechanism ("Compy saves the current setting first, so you can undo it") is what may be said.
const PROMISES: ReadonlyArray<[string, RegExp]> = [
  ["fully / completely reversible", /\b(?:fully|completely|entirely|100%) (?:reversible|undoable|undo-able)\b/],
  ["all reversible / all undoable", /\ball (?:of them )?(?:are |is )?(?:reversible|undoable)\b/],
  ["every change undoable", /\bevery (?:change|one|tweak|fix|setting)(?: \w+){0,3} (?:reversible|undoable)\b|\b(?:reversible|undoable), every one\b/],
  ["undo / roll back / restore ... any time", /\b(?:undo|roll(?: \w+){0,2} back|restore|reversible)\b[^.;]{0,30}\bany ?time\b/],
  ["zh: 完全撤销 / 全部可撤销 / 随时撤销", /完全撤销|完全可撤销|完全可逆|完全回滚|全部可撤销|全部回滚|全部可回滚|均可完全|随时(?:可以|可|都可以)?(?:撤销|回滚|恢复)|任何时候(?:都)?(?:可以)?(?:撤销|回滚)|每(?:一)?项(?:都|均)(?:仍)?可(?:撤销|回滚)|均可(?:在[^,，。]{0,8})?(?:撤销|回滚)/],
];

// Class B. Each entry is an exact phrase allowed to stay in ONE file (and, where given, under keys matching
// `key`), with the reason. Matching is on the normalised text. The same phrase anywhere else still fails.
type Allow = { phrase: string; file: string; key?: RegExp; reason: string };
const ALLOWLIST: ReadonlyArray<Allow> = [
  { phrase: "Safe Mode", file: "blackbox.rs", reason: "Windows boot mode name, used in the driver-cleanup (DDU) step; a proper name, not a claim about Compy" },
  { phrase: "安全漏洞", file: "locales/zh-CN/blackbook.json", key: /^verdictGlossary\.risky\.definition$/, reason: "'security vulnerabilities': the other meaning of 安全 (security), a cost named in the refused-tweak definition" },
  { phrase: "安全漏洞", file: "data/knowledge.ts", reason: "same refused-tweak definition (zh overlay of the glossary): 'security vulnerabilities'" },
  { phrase: "safety-critical", file: "locales/en/common.json", key: /^licensePanel\.freeVersion$/, reason: "the never-paywall statement: what stays free (a product-tier fact, not a promise about a change)" },
  { phrase: "safety-critical", file: "locales/en/optimize.json", key: /^proGate\.body$/, reason: "the never-paywall statement: what stays free (a product-tier fact, not a promise about a change)" },
  { phrase: "涉及安全的功能", file: "locales/zh-CN/common.json", key: /^licensePanel\.freeVersion$/, reason: "zh of the never-paywall statement: what stays free (a product-tier fact)" },
  { phrase: "涉及安全的功能", file: "locales/zh-CN/optimize.json", key: /^proGate\.body$/, reason: "zh of the never-paywall statement: what stays free (a product-tier fact)" },
  { phrase: "更多安全还是更多帧数", file: "locales/zh-CN/common.json", key: /memory-integrity-vbs-advisory$/, reason: "'more security or more frames': the Memory Integrity trade-off title; the owner decides" },
  { phrase: "安全带", file: "locales/zh-CN/home.json", key: /^setupTour\.seatbelt\.tag$/, reason: "'Seatbelt': the name of the one-click apply / one-click undo feature in the setup tour" },
  { phrase: "安全性", file: "locales/zh-CN/lab.json", key: /\.risk\.security$/, reason: "'security': the name of one of the four stated risk dimensions in the trial receipt" },
  { phrase: "安全定义更新", file: "locales/zh-CN/paramedic.json", key: /updatesMinor$/, reason: "'security definition updates': the Windows Update category Paramedic counts" },
  { phrase: "安全启动", file: "data/terms.zh-CN.json", key: /^\[(24|27|31)\]\.(name|what|more)$/, reason: "Windows 'Secure Boot' (firmware feature name)" },
  { phrase: "安全关卡", file: "data/terms.zh-CN.json", key: /^\[24\]\.what$/, reason: "'security checkpoint': describes what Secure Boot is" },
  { phrase: "安全芯片", file: "data/terms.zh-CN.json", key: /^\[25\]\.what$/, reason: "'security chip': describes what a TPM is" },
  { phrase: "基于虚拟化的安全", file: "data/tweaks.zh-CN.json", key: /^\[4\]\.what$/, reason: "Windows 'virtualization-based security' (VBS): feature name" },
  { phrase: "安全代价", file: "data/tweaks.zh-CN.json", key: /^\[4\]\.why$/, reason: "'security cost': the trade-off of turning VBS off, stated as a cost" },
  { phrase: "安全补丁", file: "data/tweaks.zh-CN.json", key: /^\[33\]\.why$/, reason: "'security patches': Windows Update content the tweak would break (a warning)" },
  { phrase: "安全缓解措施", file: "data/tweaks.zh-CN.json", key: /^\[34\]\.name$/, reason: "'security mitigations' (Spectre/Meltdown): the name of what the tweak disables" },
  { phrase: "安全启动", file: "data/tweaks.zh-CN.json", key: /^\[39\]\.name$/, reason: "Windows 'Secure Boot' (firmware feature name)" },
  { phrase: "安全性", file: "data/tweaks.zh-CN.json", key: /^\[82\]\.why$/, reason: "'security': Windows 10 end of support is a security matter, not a frame-rate one" },
  { phrase: "安全软件", file: "data/guides.zh-CN.json", key: /^\[2\]\.steps\[2\]$/, reason: "'security software' (antivirus): the guide says to leave those startup items alone" },
  { phrase: "safety blocklist", file: "experiment.rs", reason: "names the permanent refusal blocklist (a mechanism name), in the text that says Compy will not test the change" },
  { phrase: "safety bar", file: "experiment.rs", reason: "names the refusal bar (a mechanism name), in the text that says the change stays barred" },
  { phrase: "Privacy & safety", file: "export.rs", reason: "section heading of the exported report (a name; the section lists what Compy does not send)" },
  { phrase: "safety margin", file: "leftovers.rs", reason: "describes Windows' scheduler headroom that the listed registry values remove (about Windows, not a claim about Compy)" },
  { phrase: "update safety barrier", file: "lib.rs", reason: "names the update barrier mechanism that refuses an update or Gaming Mode start; a mechanism name" },
  { phrase: "restart safety barrier", file: "use-update.ts", reason: "names the same update barrier mechanism in a console log line (not UI text)" },
];

// Ids that happen to be the word and are never shown (the guide tier id is the string "safe"; the pill shows
// its own wording from the locale file). Matched by key path suffix AND exact value.
const ID_VALUES: ReadonlyArray<{ keySuffix: string; value: string; reason: string }> = [
  { keySuffix: ".tier", value: "safe", reason: "guide tier id (class D): never rendered, the pill text lives in blackbook.json" },
];

type Hit = { where: string; pattern: string; text: string };
type Where = { file: string; key?: string; label: string };

function scanText(w: Where, raw: string, allow: ReadonlyArray<Allow> = ALLOWLIST): Hit[] {
  let t = norm(raw);
  for (const c of CAUTIONS) t = t.replace(c, " ");
  for (const a of allow) {
    if (!w.file.endsWith(a.file)) continue;
    if (a.key && !(w.key !== undefined && a.key.test(w.key))) continue;
    t = t.split(norm(a.phrase)).join(" ");
  }
  const hits: Hit[] = [];
  const text = raw.length > 160 ? raw.slice(0, 160) + "…" : raw;
  for (const [pattern, re] of [...PATTERNS, ...PROMISES]) if (re.test(t)) hits.push({ where: w.label, pattern, text });
  return hits;
}

function flatten(node: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof node === "string") out.push([path, node]);
  else if (Array.isArray(node)) node.forEach((v, i) => flatten(v, `${path}[${i}]`, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) flatten(v, path ? `${path}.${k}` : k, out);
}

function scanJson(modules: Record<string, unknown>, allow: ReadonlyArray<Allow> = ALLOWLIST): Hit[] {
  const hits: Hit[] = [];
  for (const [file, mod] of Object.entries(modules)) {
    const rel = file.replace(/^\.\.?\//, "");
    const flat: Array<[string, string]> = [];
    flatten(mod, "", flat);
    for (const [key, value] of flat) {
      if (ID_VALUES.some((i) => key.endsWith(i.keySuffix) && value === i.value)) continue;
      hits.push(...scanText({ file: rel, key, label: `${rel} :: ${key}` }, value, allow));
    }
  }
  return hits;
}

// ---- Rust: whole file minus #[cfg(test)] items (found by brace depth over code characters, so production
// code after a test-only helper is still scanned). Comments are blanked, line count preserved so a hit names
// file:line. Only string literals with a space (or CJK) are text a user can read; single-token literals such
// as "safe" (a severity id) or "no-safe-change" (a code) are ids.
function blankRust(text: string): string {
  const out = text.split("");
  const n = text.length;
  const blank = (a: number, b: number) => {
    for (let k = a; k < b && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  type Span = { a: number; b: number; kind: "str" | "line" | "block" | "char" };
  const spans: Span[] = [];
  const CHAR = /^'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|.)|[^\\'])'/;
  for (let i = 0; i < n; ) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") { const j = text.indexOf("\n", i); const e = j === -1 ? n : j; spans.push({ a: i, b: e, kind: "line" }); i = e; continue; }
    if (c === "/" && text[i + 1] === "*") {
      let d = 1, j = i + 2;
      while (j < n && d > 0) {
        if (text[j] === "/" && text[j + 1] === "*") { d++; j += 2; }
        else if (text[j] === "*" && text[j + 1] === "/") { d--; j += 2; }
        else j++;
      }
      spans.push({ a: i, b: j, kind: "block" }); i = j; continue;
    }
    if (c === "r" && /^r#*"/.test(text.slice(i, i + 12)) && !/[A-Za-z0-9_]/.test(text[i - 1] ?? "")) {
      const h = /^r(#*)"/.exec(text.slice(i, i + 12))![1];
      const close = '"' + h;
      const j = text.indexOf(close, i + 2 + h.length);
      const e = j === -1 ? n : j + close.length;
      spans.push({ a: i, b: e, kind: "str" }); i = e; continue;
    }
    if (c === '"') { let j = i + 1; while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1; spans.push({ a: i, b: j + 1, kind: "str" }); i = j + 1; continue; }
    if (c === "'") { const m = CHAR.exec(text.slice(i, i + 14)); if (m) { spans.push({ a: i, b: i + m[0].length, kind: "char" }); i += m[0].length; continue; } }
    i++;
  }
  const nonCode = new Uint8Array(n);
  for (const s of spans) for (let k = s.a; k < s.b && k < n; k++) nonCode[k] = 1;
  const re = /#\[cfg\(test\)\]/g;
  let m: RegExpExecArray | null;
  const cuts: Array<[number, number]> = [];
  while ((m = re.exec(text))) {
    if (nonCode[m.index]) continue;
    let j = m.index + m[0].length;
    while (j < n && (nonCode[j] || (text[j] !== "{" && text[j] !== ";"))) j++;
    if (j >= n) { cuts.push([m.index, n]); break; }
    if (text[j] === ";") { cuts.push([m.index, j + 1]); continue; }
    let d = 0;
    for (; j < n; j++) {
      if (nonCode[j]) continue;
      if (text[j] === "{") d++;
      else if (text[j] === "}") { d--; if (d === 0) { j++; break; } }
    }
    cuts.push([m.index, j]);
    re.lastIndex = j;
  }
  for (const s of spans) if (s.kind === "line" || s.kind === "block") blank(s.a, s.b);
  for (const [a, b] of cuts) blank(a, b);
  return out.join("");
}

function rustLiterals(text: string): Array<{ line: number; value: string }> {
  const code = blankRust(text);
  const out: Array<{ line: number; value: string }> = [];
  const n = code.length;
  const CHAR = /^'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|.)|[^\\'])'/;
  for (let i = 0; i < n; ) {
    const c = code[i];
    if (c === "r" && /^r#*"/.test(code.slice(i, i + 12)) && !/[A-Za-z0-9_]/.test(code[i - 1] ?? "")) {
      const h = /^r(#*)"/.exec(code.slice(i, i + 12))![1];
      const close = '"' + h;
      const j = code.indexOf(close, i + 2 + h.length);
      i = j === -1 ? n : j + close.length;
      continue;
    }
    if (c === "'") { const m = CHAR.exec(code.slice(i, i + 14)); if (m) { i += m[0].length; continue; } }
    if (c === '"') {
      let j = i + 1;
      while (j < n && code[j] !== '"') j += code[j] === "\\" ? 2 : 1;
      const value = code.slice(i + 1, j).replace(/\\\r?\n\s*/g, "");
      if (/\s|[一-鿿]/.test(value)) out.push({ line: code.slice(0, i).split("\n").length, value });
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

function scanRust(): Hit[] {
  const hits: Hit[] = [];
  for (const [file, text] of Object.entries(RUST_SOURCES)) {
    if (/[\\/]tests?[\\/]|[\\/]tests\.rs$/.test(file)) continue;
    const rel = file.replace(/^(\.\.\/)+/, "");
    for (const { line, value } of rustLiterals(text)) hits.push(...scanText({ file: rel, label: `${rel}:${line}` }, value));
  }
  return hits;
}

// ---- TS/TSX: a small tokenizer (comments, "..", '..', `..` including multi-line templates) plus same-line JSX
// text (`>text<`). Only literals with a space (or CJK) count.
function tsLiterals(text: string): Array<{ line: number; value: string }> {
  const out: Array<{ line: number; value: string }> = [];
  const n = text.length;
  const code: string[] = text.split("");
  let line = 1;
  for (let i = 0; i < n; ) {
    const c = text[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === "/" && text[i + 1] === "/") { while (i < n && text[i] !== "\n") { code[i] = " "; i++; } continue; }
    if (c === "/" && text[i + 1] === "*") {
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) { if (text[i] === "\n") line++; else code[i] = " "; i++; }
      if (i < n) { code[i] = " "; code[i + 1] = " "; }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      const startLine = line;
      let j = i + 1;
      while (j < n && text[j] !== q) {
        if (text[j] === "\\") j++;
        else if (text[j] === "\n") { if (q !== "`") break; line++; }
        j++;
      }
      const value = text.slice(i + 1, j);
      if (/\s|[一-鿿]/.test(value)) out.push({ line: startLine, value });
      for (let k = i; k <= j && k < n; k++) if (text[k] !== "\n") code[k] = " ";
      i = j + 1;
      continue;
    }
    i++;
  }
  code.join("").split("\n").forEach((l, idx) => {
    const re = />([^<>{}()=;&|\n]{3,})</g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(l))) if (/\s/.test(m[1].trim()) && /[A-Za-z]{3}|[一-鿿]/.test(m[1])) out.push({ line: idx + 1, value: m[1] });
  });
  return out;
}

function scanTs(): Hit[] {
  const hits: Hit[] = [];
  for (const [file, text] of Object.entries(TS_SOURCES)) {
    const rel = "src/" + file.replace(/^(\.\.\/)+/, "");
    for (const { line, value } of tsLiterals(text)) hits.push(...scanText({ file: rel, label: `${rel}:${line}` }, value));
  }
  return hits;
}

const show = (hits: Hit[]): string => hits.map((h) => `  ${h.where}  [${h.pattern}]  "${h.text}"`).join("\n");

describe("no promise words: 'safe' and its relatives, and no undo-outcome promises", () => {
  it("no locale string (en, zh-CN) calls a change, a tweak or Compy safe, or promises an undo", () => {
    const hits = scanJson(LOCALE_MODULES);
    expect(hits, "reword to what the code does (Compy saves the current setting first, so you can undo it), never to another promise:\n" + show(hits)).toEqual([]);
  });

  it("no src/data JSON text (tweaks, terms, guides, tricks; en and zh-CN) uses it", () => {
    const hits = scanJson(DATA_MODULES);
    expect(hits, "reword, never allowlist a promise:\n" + show(hits)).toEqual([]);
  });

  it("no user-visible string in the Rust sources uses it", () => {
    const hits = scanRust();
    expect(hits, "reword, never allowlist a promise:\n" + show(hits)).toEqual([]);
  });

  it("no user-visible string literal or JSX text in src/**/*.ts(x) uses it", () => {
    const hits = scanTs();
    expect(hits, "reword, never allowlist a promise:\n" + show(hits)).toEqual([]);
  });

  it("the scan reads real files (a broken glob would pass vacuously)", () => {
    expect(Object.keys(LOCALE_MODULES).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(DATA_MODULES).length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(RUST_SOURCES).length).toBeGreaterThan(20);
    expect(Object.keys(TS_SOURCES).length).toBeGreaterThan(50);
    expect(Object.values(RUST_SOURCES).reduce((k, t) => k + rustLiterals(t).length, 0)).toBeGreaterThan(1500);
  });

  it("every allowlist entry carries a reason and a file", () => {
    for (const a of ALLOWLIST) {
      expect(a.reason.length, a.phrase).toBeGreaterThan(15);
      expect(a.file.length, a.phrase).toBeGreaterThan(3);
    }
  });
});

describe("the scan itself (break check, not dodgeable by case or spacing)", () => {
  const caught = (s: string): boolean => scanText({ file: "x.json", label: "x" }, s, []).length > 0;

  it("catches the promise in every spelling", () => {
    for (const s of [
      "1 safe tweak is ready", "Apply SAFE fixes", "Safe  tweak", "safe\ttweak", "s​afe tweak", "s­afe tweak",
      "Ｓａｆｅ tweak", "Compy applies it safely", "the safest option", "fail-safe switch", "Risk-free", "RISK FREE",
      "no risk at all", "Harmless to disable", "it can’t hurt", "nothing to lose", "Worry-free tuning", "Foolproof",
      "A safety net for you", "a safeguard", "一键应用安全优化", "尽管放心探索", "无风险", "这样更稳妥", "有保险", "万无一失",
    ]) expect(caught(s), s).toBe(true);
  });

  it("catches an undo-outcome promise", () => {
    for (const s of [
      "it's fully reversible", "Fully  Reversible", "completely undoable", "all reversible from Applied", "All Reversible",
      "every change undoable in the ledger", "every one is still undoable", "Reversible, every one.", "undo any time",
      "you can roll this back anytime", "Reversible anytime.", "restore any one anytime", "均可完全撤销", "完全撤销", "全部可撤销", "可随时回滚", "随时可以撤销",
    ]) expect(caught(s), s).toBe(true);
  });

  it("lets cautions and the mechanism statement through", () => {
    for (const s of [
      "This is not safe to do on a work PC", "it isn't safe to unplug", "Unsafe", "不安全的做法", "并不安全",
      "Compy saves the current setting first, so you can undo it.", "Each is individually reversible below.", "Stop anytime.",
      "Turn it off any time and it stops.", "Compy has no reversible switch for this one",
    ]) expect(caught(s), s).toBe(false);
  });

  it("scopes an allowlisted phrase to its file and key, and still catches a promise beside it", () => {
    const allow: Allow[] = [
      { phrase: "Safe Mode", file: "locales/en/x.json", reason: "Windows boot mode name, used in a driver-cleanup step" },
      { phrase: "安全带", file: "locales/zh-CN/home.json", key: /^seatbelt\.tag$/, reason: "Seatbelt: the feature name" },
    ];
    const ok = (file: string, key: string, s: string) =>
      scanJson({ [`./${file}`]: { [key.split(".")[0]]: key.includes(".") ? { [key.split(".")[1]]: s } : s } }, allow).length === 0;
    expect(ok("locales/en/x.json", "a", "Boot in Safe Mode")).toBe(true);
    expect(ok("locales/en/x.json", "a", "Boot in safe mode")).toBe(true);
    expect(ok("locales/en/x.json", "a", "Safe Mode is safe")).toBe(false);
    expect(ok("locales/en/y.json", "a", "Boot in Safe Mode"), "other file").toBe(false);
    expect(ok("locales/zh-CN/home.json", "seatbelt.tag", "安全带")).toBe(true);
    expect(ok("locales/zh-CN/home.json", "other.tag", "安全带"), "other key in the same file").toBe(false);
    expect(ok("locales/zh-CN/lab.json", "seatbelt.tag", "安全带"), "other file").toBe(false);
  });

  it("names the file and the key in a locale hit", () => {
    const hits = scanJson({ "./locales/en/x.json": { a: { b: "a safe tweak" } } }, []);
    expect(hits).toHaveLength(1);
    expect(hits[0].where).toBe("locales/en/x.json :: a.b");
  });

  it("skips the guide tier id but not other values under other keys", () => {
    expect(scanJson({ "../data/g.json": { entries: [{ tier: "safe" }] } }, [])).toEqual([]);
    expect(scanJson({ "../data/g.json": { entries: [{ goal: "safe" }] } }, [])).toHaveLength(1);
  });

  it("reads Rust string literals only, with continuations, scans past a test-only item, and names the line", () => {
    const src = [
      "fn a() -> &'static str {",
      "    // a comment that says safe is not text",
      '    "Applying the safe stack…"',
      "}",
      'const ID: &str = "safe";',
      'fn b() { let x = "so it can\'t undo \\',
      '    this safely."; }',
      "#[cfg(test)]",
      'mod t { const S: &str = "a safe test fixture"; fn f() { let b = "{"; let c = \'}\'; } }',
      "fn after() -> &'static str { \"a harmless production string after the test module\" }",
      "/* block says safe here */",
      "fn c() -> char { '\"' }",
      'fn d() -> &\'static str { "fully reversible change" }',
    ].join("\n");
    const lits = rustLiterals(src);
    expect(lits.map((l) => l.value)).toEqual(["Applying the safe stack…", "so it can't undo this safely.", "a harmless production string after the test module", "fully reversible change"]);
    expect(lits[0].line).toBe(3);
    expect(lits[2].line).toBe(10);
  });

  it("reads TS literals, multi-line templates and same-line JSX text; not comments, not single-token ids", () => {
    const src = [
      '// "a safe tweak" in a comment',
      'const s = "safe";',
      'const t = "Apply safe fixes";',
      '{/* "safe thing" */}',
      "const u = `line one",
      "safe here`;",
      "const v = <p>a safe tweak is ready</p>;",
      "const w = a > b && c < d;",
    ].join("\n");
    const lits = tsLiterals(src);
    expect(lits.map((l) => l.value)).toEqual(["Apply safe fixes", "line one\nsafe here", "a safe tweak is ready"]);
    expect(lits[1].line).toBe(5);
  });
});
