import { describe, expect, it } from "vitest";

// Compy may say what a change DOES: it saves the current value first, so the change can be undone. It may
// not call a change, a tweak or itself "safe": nobody can promise the outcome on every PC and every game.
// Product text rule: CLAUDE.md "Honesty rules", docs/PRODUCT_CONSTITUTION.md section 38 (no promises:
// "guarantee", "safe", "probably", "caused", "fixed", scores).
//
// This scan fails on the word used as a promise ("safe tweak", "safely", "harmless", "risk-free", "nothing to
// lose", "worry-free", and the zh-CN words 安全 / 放心 / 无风险 / 无忧 / 无害 / 不会有问题) in:
//   - every locale JSON (all namespaces, en and zh-CN, found on disk),
//   - src/data/*.json (the tweak, term, guide and trick text shown in the Library and Learn),
//   - the user-visible string literals of src-tauri/src/**/*.rs (production code only),
//   - the user-visible string literals of src/**/*.ts|tsx (not tests; comments are skipped).
// A hit is reworded to say what the code does ("reversible", "Compy saves the current setting first, so you
// can undo it"), never allowlisted. The allowlist below holds only class B: a proper name or a Windows
// term, or a different meaning of the Chinese word (security), each with its exact phrase and a reason.
//
// Not dodgeable by case or spacing: text is Unicode-normalised (NFKC: full-width letters), zero-width and
// soft-hyphen characters are removed, whitespace (including non-breaking) is collapsed, dashes are unified
// and case is folded before the patterns run. Allowlisted phrases are cut out first, so "Safe Mode is safe"
// still fails on the second "safe".

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

const PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["safe / safely / safest / safer", /\bsafe(?:ly|st|r)?\b/],
  ["risk-free / no risk / zero risk", /\brisk[- ]?free\b|\b(?:no|zero)[- ]risk\b/],
  ["harmless", /\bharmless(?:ly)?\b/],
  ["can't hurt", /\b(?:can't|cannot|can not|cant) hurt\b/],
  ["nothing to lose", /\bnothing to lose\b/],
  ["worry-free", /\bworry[- ]?free\b/],
  ["zh: 安全 / 放心 / 无风险 / 没风险 / 无忧 / 无害 / 不会有问题 / 不会出问题", /安全|放心|无风险|没风险|无忧|无害|不会有问题|不会出问题/],
];

// Class B. Each entry is an exact phrase that is allowed to stay, and why. Matching is on the normalised text.
const ALLOWLIST: ReadonlyArray<{ phrase: string; reason: string }> = [
  { phrase: "Safe Mode", reason: "Windows boot mode name (used to run a driver-cleanup tool); a proper name, not a claim about Compy" },
  { phrase: "安全启动", reason: "Windows 'Secure Boot' (firmware feature name)" },
  { phrase: "安全漏洞", reason: "'security vulnerability': the other meaning of 安全 (security), a cost named in the refused-tweak definition" },
  { phrase: "安全缓解措施", reason: "'security mitigations' (Spectre/Meltdown): the name of the thing a tweak disables" },
  { phrase: "安全补丁", reason: "'security patches': Windows Update content, named as a thing a tweak would break" },
  { phrase: "安全定义更新", reason: "'security definition updates': Windows Defender update category (Paramedic counts them)" },
  { phrase: "基于虚拟化的安全", reason: "Windows 'virtualization-based security' (VBS): feature name" },
  { phrase: "安全代价", reason: "'security cost': the trade-off of turning VBS off, stated as a cost, not a promise" },
  { phrase: "安全芯片", reason: "'security chip' (TPM): hardware description" },
  { phrase: "安全软件", reason: "'security software': antivirus category the guide says to leave alone" },
  { phrase: "账号安全", reason: "'account security': the risk a game-injecting tool puts on an account (a warning, not a promise)" },
  { phrase: "数据安全", reason: "'data safety' of a RAID backup array, stated as not a performance matter" },
  { phrase: "安全备份", reason: "'safe backup' as the purpose of a RAID layout (a general explanation of RAID, not Compy)" },
  { phrase: "安全关卡", reason: "'security checkpoint': description of what Secure Boot is" },
  { phrase: "安全阀", reason: "'safety valve': a metaphor describing what a page file is for" },
  { phrase: "安全网", reason: "'safety net' metaphor for a fallback mechanism (V-Sync as backstop; BIOS reset to defaults)" },
  { phrase: "安全性", reason: "'security' as a category name (Lab category; Windows 10 end of support)" },
  { phrase: "安全机制", reason: "'safeguards': the Settings text says the safeguards do not change in expert view" },
  { phrase: "安全带", reason: "'Seatbelt': the name of Compy's one-click apply / one-click undo feature" },
  { phrase: "涉及安全的功能", reason: "'safety-related features': the never-paywall promise about what stays free (a product-tier statement)" },
  { phrase: "更多安全还是更多帧数", reason: "'more security or more frames': the Memory Integrity trade-off title; the owner decides" },
];

// Ids that happen to be the word and are never shown (the guide tier id is the string "safe"; the pill shows
// its own wording from the locale file). Matched by key path suffix AND exact value.
const ID_VALUES: ReadonlyArray<{ keySuffix: string; value: string; reason: string }> = [
  { keySuffix: ".tier", value: "safe", reason: "guide tier id (class D): never rendered, the pill text lives in blackbook.json" },
];

// Wording in a file another worker owns right now. Allowed ONLY until that worker rewords it; the test below
// fails the moment the phrase is gone, so the entry has to be deleted then. Not class B.
const PENDING_REWORD: ReadonlyArray<{ file: string; phrase: string; owner: string }> = [
  { file: "locales/en/paramedic.json", phrase: "nothing safe Compy can change", owner: "claude/p4-cardagree (Paramedic locale file)" },
  { file: "locales/zh-CN/paramedic.json", phrase: "可以安全更改", owner: "claude/p4-cardagree (Paramedic locale file)" },
];

type Hit = { where: string; pattern: string; text: string };

const allowedPhrases = ALLOWLIST.map((a) => norm(a.phrase));

function scanText(where: string, raw: string, extraCut: readonly string[] = []): Hit[] {
  let t = norm(raw);
  for (const p of [...allowedPhrases, ...extraCut.map(norm)]) t = t.split(p).join(" ");
  const hits: Hit[] = [];
  for (const [pattern, re] of PATTERNS) if (re.test(t)) hits.push({ where, pattern, text: raw.length > 160 ? raw.slice(0, 160) + "…" : raw });
  return hits;
}

function flatten(node: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof node === "string") out.push([path, node]);
  else if (Array.isArray(node)) node.forEach((v, i) => flatten(v, `${path}[${i}]`, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) flatten(v, path ? `${path}.${k}` : k, out);
}

function scanJson(modules: Record<string, unknown>): Hit[] {
  const hits: Hit[] = [];
  for (const [file, mod] of Object.entries(modules)) {
    const rel = file.replace(/^\.\.?\//, "");
    const pending = PENDING_REWORD.filter((p) => rel.endsWith(p.file)).map((p) => p.phrase);
    const flat: Array<[string, string]> = [];
    flatten(mod, "", flat);
    for (const [key, value] of flat) {
      if (ID_VALUES.some((i) => key.endsWith(i.keySuffix) && value === i.value)) continue;
      hits.push(...scanText(`${rel} :: ${key}`, value, pending));
    }
  }
  return hits;
}

// Rust: production code only (cut at the first #[cfg(test)]), comment lines and trailing comments dropped,
// line count preserved so a hit names file:line. Only string literals that contain a space (or CJK) are text a
// user can read; single-token literals such as "safe" (a severity id) or "no-safe-change" (a code) are ids.
function stripTrailingComment(line: string): string {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") { i++; continue; }
    if (c === '"') inStr = !inStr;
    else if (!inStr && c === "/" && line[i + 1] === "/") return line.slice(0, i);
  }
  return line;
}

function rustLiterals(text: string): Array<{ line: number; value: string }> {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex((l) => /^\s*#\[cfg\(test\)\]/.test(l));
  const prod = (cut === -1 ? lines : lines.slice(0, cut))
    .map((l) => (l.trim().startsWith("//") ? "" : stripTrailingComment(l.replace(/'"'/g, "''"))))
    .join("\n");
  const out: Array<{ line: number; value: string }> = [];
  const re = /"((?:[^"\\]|\\[\s\S])*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prod))) {
    const value = m[1].replace(/\\\r?\n\s*/g, "");
    if (!/\s|[一-鿿]/.test(value)) continue;
    out.push({ line: prod.slice(0, m.index).split("\n").length, value });
  }
  return out;
}

function scanRust(): Hit[] {
  const hits: Hit[] = [];
  for (const [file, text] of Object.entries(RUST_SOURCES)) {
    if (/[\\/]tests?[\\/]|[\\/]tests\.rs$/.test(file)) continue;
    const rel = file.replace(/^(\.\.\/)+/, "");
    for (const { line, value } of rustLiterals(text)) hits.push(...scanText(`${rel}:${line}`, value));
  }
  return hits;
}

function tsLiterals(text: string): Array<{ line: number; value: string }> {
  const out: Array<{ line: number; value: string }> = [];
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\[\s\S])*)`/g;
  // Block comments (including multi-line JSX comments) go first, keeping the line count. Only a `/*` that
  // starts a token counts, so a glob such as "../**/*.ts" inside a string does not eat real code.
  const noBlocks = text.replace(/(^|[\s{(,;])\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  noBlocks.split(/\r?\n/).forEach((raw, i) => {
    const t = raw.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*")) return;
    const line = stripTrailingComment(raw.replace(/\{?\/\*.*?\*\/\}?/g, ""));
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(line))) {
      const value = m[1] ?? m[2] ?? m[3] ?? "";
      if (/\s|[一-鿿]/.test(value)) out.push({ line: i + 1, value });
    }
  });
  return out;
}

function scanTs(): Hit[] {
  const hits: Hit[] = [];
  for (const [file, text] of Object.entries(TS_SOURCES)) {
    const rel = "src/" + file.replace(/^(\.\.\/)+/, "");
    for (const { line, value } of tsLiterals(text)) hits.push(...scanText(`${rel}:${line}`, value));
  }
  return hits;
}

const show = (hits: Hit[]): string => hits.map((h) => `  ${h.where}  [${h.pattern}]  "${h.text}"`).join("\n");

describe("no promise words: 'safe' and its relatives", () => {
  it("no locale string (en, zh-CN) calls a change, a tweak or Compy safe", () => {
    const hits = scanJson(LOCALE_MODULES);
    expect(hits, "reword to what the code does (reversible; Compy saves the current setting first), never to another promise:\n" + show(hits)).toEqual([]);
  });

  it("no src/data JSON text (tweaks, terms, guides, tricks; en and zh-CN) uses it", () => {
    const hits = scanJson(DATA_MODULES);
    expect(hits, "reword, never allowlist a promise:\n" + show(hits)).toEqual([]);
  });

  it("no user-visible string in the Rust sources uses it", () => {
    const hits = scanRust();
    expect(hits, "reword, never allowlist a promise:\n" + show(hits)).toEqual([]);
  });

  it("no user-visible string literal in src/**/*.ts(x) uses it", () => {
    const hits = scanTs();
    expect(hits, "reword, never allowlist a promise:\n" + show(hits)).toEqual([]);
  });

  it("the scan reads real files (a broken glob would pass vacuously)", () => {
    expect(Object.keys(LOCALE_MODULES).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(DATA_MODULES).length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(RUST_SOURCES).length).toBeGreaterThan(20);
    expect(Object.keys(TS_SOURCES).length).toBeGreaterThan(50);
    expect(Object.values(RUST_SOURCES).reduce((n, t) => n + rustLiterals(t).length, 0)).toBeGreaterThan(200);
  });

  it("a pending reword is deleted from PENDING_REWORD the moment the other worker rewords it", () => {
    for (const p of PENDING_REWORD) {
      const mod = Object.entries(LOCALE_MODULES).find(([f]) => f.endsWith(p.file.replace("locales/", "locales/")));
      expect(mod, `${p.file} exists`).toBeTruthy();
      const flat: Array<[string, string]> = [];
      flatten(mod![1], "", flat);
      expect(flat.some(([, v]) => norm(v).includes(norm(p.phrase))), `"${p.phrase}" is gone from ${p.file}: delete this PENDING_REWORD entry (owner: ${p.owner})`).toBe(true);
    }
  });

  it("every allowlist entry carries a reason", () => {
    for (const a of ALLOWLIST) expect(a.reason.length, a.phrase).toBeGreaterThan(15);
  });
});

describe("the scan itself (break check, not dodgeable by case or spacing)", () => {
  const caught = (s: string): boolean => scanText("x", s).length > 0;

  it("catches the promise in every spelling", () => {
    for (const s of [
      "1 safe tweak is ready",
      "Apply SAFE fixes",
      "Safe  tweak",
      "safe\ttweak",
      "s​afe tweak",
      "s­afe tweak",
      "Ｓａｆｅ tweak",
      "Compy applies it safely",
      "the safest option",
      "fail-safe switch",
      "Risk-free",
      "RISK FREE",
      "no risk at all",
      "Harmless to disable",
      "it can’t hurt",
      "nothing to lose",
      "Worry-free tuning",
      "一键应用安全优化",
      "尽管放心探索",
      "无风险",
      "ＳＡＦＥ tweak",
    ]) expect(caught(s), s).toBe(true);
  });

  it("lets only the named class B phrases through, and still catches a promise beside them", () => {
    expect(caught("Boot in Safe Mode")).toBe(false);
    expect(caught("boot in safe mode")).toBe(false);
    expect(caught("Safe Mode is safe")).toBe(true);
    expect(caught("开启安全启动(Secure Boot)")).toBe(false);
    expect(caught("安全启动是安全的")).toBe(true);
    expect(caught("它是unsafe的、也没有 safety 声明")).toBe(false);
  });

  it("names the file and the key in a locale hit", () => {
    const hits = scanJson({ "./locales/en/x.json": { a: { b: "a safe tweak" } } });
    expect(hits).toHaveLength(1);
    expect(hits[0].where).toBe("locales/en/x.json :: a.b");
  });

  it("skips the guide tier id but not other values under other keys", () => {
    expect(scanJson({ "../data/g.json": { entries: [{ tier: "safe" }] } })).toEqual([]);
    expect(scanJson({ "../data/g.json": { entries: [{ goal: "safe" }] } })).toHaveLength(1);
  });

  it("reads Rust string literals only, with continuations, and names the line", () => {
    const src = [
      'fn a() -> &\'static str {',
      '    // a comment that says safe is not text',
      '    "Applying the safe stack…"',
      "}",
      'const ID: &str = "safe";',
      'fn b() { let x = "so it can\'t undo \\',
      '    this safely."; }',
      "#[cfg(test)]",
      'mod t { const S: &str = "a safe test fixture"; }',
    ].join("\n");
    const lits = rustLiterals(src);
    expect(lits.map((l) => l.value)).toEqual(["Applying the safe stack…", "so it can't undo this safely."]);
    expect(lits[0].line).toBe(3);
  });

  it("reads TS literals only: not comments, not single-token ids", () => {
    const src = ['// "a safe tweak" in a comment', 'const s = "safe";', 'const t = "Apply safe fixes";', '{/* "safe thing" */}'].join("\n");
    expect(tsLiterals(src).map((l) => l.value)).toEqual(["Apply safe fixes"]);
  });
});
