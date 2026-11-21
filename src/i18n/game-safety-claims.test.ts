import { describe, expect, it } from "vitest";

// Compy may say what it DOES to a game (reads frame timing from Windows, injects nothing, writes
// nothing to game files). The true remaining set (src-tauri, guarded by other_load.rs
// `open_process_appears_only_at_allowlisted_sites`, whose allowlist is empty; it scans src-tauri/src only,
// not dependency crates): Compy's own code opens NO process by id, the game included. Process names and
// "is the game still running" read one system-wide snapshot (other_load::read_process_rows: pid, parent,
// image name, create time, threads, session); only the FPS helper also checks pid reuse by creation time
// (the app's check is by name). It reads no game memory and holds no handle to the game; frame timing is read from Windows'
// event tracing (ETW); window and foreground checks are window-manager queries. It may still not say
// "never touched" or promise an outcome with anti-cheat or bans: the makers of anti-cheat do not publish
// what they allow, so Compy cannot know (docs/ARCHITECTURE_LOCKS.md ~191).
// "Compy can't promise how any anti-cheat will react" is the true line.
// Product text rule: CLAUDE.md "Honesty rules", docs/PRODUCT_CONSTITUTION.md section 38.
//
// Scans EVERY locale JSON (all namespaces, en and zh-CN, found on disk, so a new file or language is
// covered without editing this test). A claim that trips a pattern is reworded, never excluded.

// Every locales/<lang>/<namespace>.json, parsed at test time (Vite-native, no fs typings needed).
const LOCALE_MODULES = import.meta.glob("./locales/*/*.json", { import: "default", eager: true }) as Record<string, unknown>;

// The Library / Blackbook data (terms, tweaks, tricks, guides; en and zh-CN) reaches users through the
// Term tooltip, Learn and the autopsy pages, so it is held to the same rule as the locale files.
const DATA_MODULES = import.meta.glob("../data/*.json", { import: "default", eager: true }) as Record<string, unknown>;

// Every Rust source under src-tauri/src as raw text. Rust strings reach users raw (the exported report,
// the Leftovers rows, the simulator's "why"), so they are scanned too. Narrowing, so honest internals
// do not trip it: from each file only the PRODUCTION text is scanned (cut at the first `#[cfg(test)]`,
// lines starting with `//` dropped, so doc comments that explain why a rule exists are not claims), and
// files named tests.rs or under a tests/ folder are skipped (fixtures).
const RUST_SOURCES = import.meta.glob("../../src-tauri/src/**/*.rs", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const productionRust = (text: string): string => {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex((l) => /^\s*#\[cfg\(test\)\]/.test(l));
  return (cut === -1 ? lines : lines.slice(0, cut)).filter((l) => !l.trim().startsWith("//")).join("\n");
};

const CLAIM_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["'never/doesn't touch ... games'", /\b(never|doesn'?t|does not|won'?t|will not|no)\s+touch(es)?\b[^.]{0,30}\bgames?\b/i],
  ["'safe with / safe for anti-cheat'", /\bsafe (with|for|against|around|under)\b[^.]{0,12}anti-?cheat/i],
  ["'anti-cheat-safe / -friendly / -proof / -compatible'", /anti-?cheats?[- ](safe|friendly|proof|compatible|approved|whitelisted|ok)\b/i],
  ["'compatible with anti-cheat'", /\bcompatible with\b[^.]{0,12}anti-?cheat/i],
  ["'anti-cheat will not flag / ban / react'", /anti-?cheats?\b[^.]{0,20}\b(won'?t|will not|never|can'?t|cannot)\s+(flag|ban|detect|object|care|notice)/i],
  ["'anti-cheats react badly' (a claim about their behaviour)", /anti-?cheats?\s+(react|reacts)\b/i],
  ["'nothing for anti-cheat to object to'", /nothing for anti-?cheat/i],
  ["'100%' beside safe / secure / undetectable / ban", /100\s?%\s*[-\w ]{0,12}(safe|secure|undetect|ban|anti)/i],
  ["'undetectable'", /undetect/i],
  ["'can't be banned' / 'won't get you banned'", /(can'?t|cannot|won'?t|will not|never)\s+(be|get you|get)\s+banned/i],
  ["'no risk' / 'risk-free' / 'zero risk' (bans)", /\b(no|zero) risk\b|risk-free/i],
  ["'guarantee' beside anti-cheat or ban", /guarantee[sd]?\b[^.]{0,40}(anti-?cheat|\bban)/i],
  ["zh: '绝不触碰 / 不会触碰 ... 游戏'", /(绝不|不会|从不|不)触碰[^。]{0,8}游戏|绝不触碰|不会触碰/],
  // The dodge family a reviewer listed (safe-to-use wording, "<launcher>-safe", "won't trigger", "no ban risk").
  // Over-broad on purpose: it would also block an honest "safe ... anti-cheat" sentence; reword that instead.
  ["'safe ... anti-cheat / Vanguard / EAC / BattlEye'", /\bsafe\b[^.]{0,20}\b(anti-?cheat|vanguard|eac|battleye)\b/i],
  ["'Vanguard-safe / EAC-safe / BattlEye-safe / ban-safe'", /\b(vanguard|eac|battleye|ban)[- ]safe\b/i],
  ["'won't trigger / set off anti-cheat'", /(won'?t|never|doesn'?t|does not|will not)\s+(trigger|set off|upset|alert)\b[^.]{0,15}anti-?cheat/i],
  ["'no ban risk'", /\bno\s+ban\s+risk\b/i],
  ["'react badly'", /\breact(s|ed)? badly\b/i],
  ["zh: '对反作弊(系统)安全 / 与反作弊兼容'", /(对|与|和)反作弊(系统|软件)?(来说)?(是)?(安全|兼容|友好)|反作弊(系统|软件)?(来说)?(是)?(安全|无忧|放心)/],
  ["zh: '不会触发反作弊'", /不会触发[^。]{0,4}反作弊/],
  ["zh: '不碰 ... 游戏'", /不(会)?碰[^。]{0,4}游戏/],
  ["zh: '反作弊 ... 反应会很不好'", /反作弊[^。]{0,24}反应(会)?(很)?(不好|糟)/],
  ["zh: '不会封号 / 不会被封'", /不会(被)?封(号|禁)|不会被封|无需担心[^。]{0,6}封号|封号风险(为零|没有|很低)/],
  ["zh: '检测不到 / 无法被检测'", /检测不到|无法被检测|不会被检测|不被检测/],
  ["zh: '百分之百 / 绝对安全'", /百分之百|绝对安全|100\s?%\s*安全/],
  ["zh: '反作弊系统会 ... 异常反应'", /反作弊(系统)?[^。]{0,6}(会|将)[^。]{0,6}(异常反应|封|拦截)/],
];

type Hit = { where: string; text: string; label: string };

const scan = (text: string): string[] => CLAIM_PATTERNS.filter(([, re]) => re.test(text)).map(([label]) => label);

const leaves = (value: unknown, path = ""): Array<[string, string]> => {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  }
  return [];
};

const localeFiles = (): string[] => Object.keys(LOCALE_MODULES).map((p) => p.replace("./locales/", ""));

describe("game-safety claims: Compy states what it does, never an outcome with a game or anti-cheat", () => {
  it("catches the strings it was written for (disarm proof) and passes their replacements", () => {
    const old: Array<[string, string]> = [
      ["en home", "Never touches your games — safe with anti-cheat"],
      ["en monitor", " · no hooks or injected overlay, and no driver installed deep in Windows. Safe with anti-cheat."],
      ["en monitor play", " — nothing added to it, and no driver installed deep in Windows. Safe with anti-cheat."],
      ["en gaming", "(anti-cheat-safe) — it reads live RPM and temps from a free monitor you run"],
      ["en monitor why", "Compy ships no driver of its own — that is what keeps it anti-cheat-safe — so it shows"],
      ["en optimize", "your only always-on protection — and some anti-cheats react badly."],
      ["en generic", "Undetectable by every anti-cheat."],
      ["en generic", "You can't be banned for using this."],
      ["zh home", "绝不触碰你的游戏——对反作弊安全"],
      ["zh monitor", "也不在 Windows 底层安装驱动。与反作弊兼容。"],
      ["zh monitor play", "也不会安装深入 Windows 底层的驱动。对反作弊安全。"],
      ["zh gaming", "(对反作弊系统安全)——它会从你自行运行的免费监测软件读取"],
      ["zh monitor why", "（这正是它对反作弊安全的原因）"],
      ["zh optimize", "而且部分反作弊系统还会因此产生异常反应。"],
      ["zh generic", "不会被封号。"],
    ];
    for (const [id, s] of old) expect(scan(s).length, `${id}: "${s}" must be caught`).toBeGreaterThan(0);

    const fresh: Array<[string, string]> = [
      ["en home", "Doesn't inject into games or change game files"],
      ["en monitor", " · no hooks or code injected into it, and no driver installed deep in Windows. Compy's overlay is a separate window on top. Frame timing is read from Windows, not from inside the game. Compy can't promise how any anti-cheat will react."],
      ["en optimize", "and Compy can't tell how a game's anti-cheat treats it."],
      ["en caution", "its low-level driver can trip strict anti-cheat (Valorant/Vanguard) — close it before those games."],
      ["en voltage", "A gauge, not a control — Compy never touches your voltage."],
      ["zh home", "不向游戏注入代码，也不修改游戏文件"],
      ["zh monitor", "帧时间读取自 Windows，而不是游戏内部。Compy 无法承诺任何反作弊系统会作何反应。"],
      ["zh optimize", "而且 Compy 无法判断游戏的反作弊系统会如何看待此举。"],
      ["zh caution", "它的底层驱动可能会触发严格的反作弊系统(Valorant/Vanguard)——请在运行这些游戏前将其关闭。"],
    ];
    for (const [id, s] of fresh) expect(scan(s), `${id}: "${s}" must pass`).toEqual([]);
  });

  it("scans every locale file in both languages", () => {
    const files = localeFiles();
    expect(files.filter((f) => f.startsWith("en/")).length, "no en locale files found").toBeGreaterThan(5);
    expect(files.filter((f) => f.startsWith("zh-CN/")).length, "no zh-CN locale files found").toBeGreaterThan(5);
  });

  const failMessage = (hits: Hit[]) =>
    `Compy cannot prove these. State what Compy does (e.g. "Frame timing is read from Windows, not from inside the game"), ` +
    `never an outcome with a game or anti-cheat. Reword:\n` +
    hits.map((h) => `  ${h.where} [${h.label}]: "${h.text.slice(0, 140)}"`).join("\n");

  it("no locale string claims a game is never touched, is safe with anti-cheat, or cannot be banned", () => {
    const hits: Hit[] = [];
    for (const file of localeFiles()) {
      for (const [key, text] of leaves(LOCALE_MODULES[`./locales/${file}`])) {
        for (const label of scan(text)) hits.push({ where: `${file}:${key}`, text, label });
      }
    }
    expect(hits, failMessage(hits)).toEqual([]);
  });

  it("no src/data JSON string (terms, tweaks, tricks, guides; en and zh-CN) makes those claims", () => {
    const names = Object.keys(DATA_MODULES);
    expect(names.some((n) => n.endsWith("terms.json")), "terms.json not scanned").toBe(true);
    expect(names.some((n) => n.endsWith("terms.zh-CN.json")), "terms.zh-CN.json not scanned").toBe(true);
    expect(names.some((n) => n.endsWith("tweaks.json")), "tweaks.json not scanned").toBe(true);
    const hits: Hit[] = [];
    for (const [file, json] of Object.entries(DATA_MODULES)) {
      for (const [key, text] of leaves(json)) {
        for (const label of scan(text)) hits.push({ where: `${file.replace("../", "src/")}:${key}`, text, label });
      }
    }
    expect(hits, failMessage(hits)).toEqual([]);
  });

  it("no Rust string shown to users (export report, Leftovers, simulator) makes those claims", () => {
    const files = Object.entries(RUST_SOURCES).filter(([f]) => !/(^|\/)tests\.rs$|\/tests\//.test(f));
    expect(files.length, "Rust sources not found").toBeGreaterThan(20);
    for (const must of ["export.rs", "leftovers.rs"]) {
      expect(files.some(([f]) => f.endsWith(`/${must}`)), `${must} not scanned`).toBe(true);
    }
    const hits: Hit[] = [];
    for (const [file, raw] of files) {
      const prod = productionRust(raw);
      for (const label of scan(prod)) {
        const re = CLAIM_PATTERNS.find(([l]) => l === label)![1];
        const m = re.exec(prod);
        hits.push({ where: file.replace("../../", ""), text: m ? prod.slice(Math.max(0, m.index - 40), m.index + 100) : "", label });
      }
    }
    expect(hits, failMessage(hits)).toEqual([]);
  });

  it("the Rust and data scans would catch the old sentences (disarm proof)", () => {
    expect(scan(productionRust('    "No game code is touched and no overlay is injected — anti-cheat-safe by design.",')).length).toBeGreaterThan(0);
    expect(scan(productionRust('// anti-cheat-safe in a comment is not a claim\nfn a() {}')), "comment lines are skipped").toEqual([]);
    expect(scan(productionRust('fn a() {}\n#[cfg(test)]\nmod t { const S: &str = "anti-cheat-safe"; }')), "test code is skipped").toEqual([]);
    expect(scan("the cost is your only always-on protection — and some anti-cheats react badly.").length).toBeGreaterThan(0);
    expect(scan("Because it reads events Windows already broadcasts, it doesn't touch game memory, so it's anti-cheat-safe.").length).toBeGreaterThan(0);
    expect(scan("Compy stays anti-cheat-safe and does not enable any feature your game forbids").length).toBeGreaterThan(0);
    expect(scan("Safe to use with anti-cheat.").length).toBeGreaterThan(0);
    expect(scan("It won't trigger anti-cheat.").length).toBeGreaterThan(0);
    expect(scan("Vanguard-safe.").length).toBeGreaterThan(0);
    expect(scan("No ban risk.").length).toBeGreaterThan(0);
    expect(scan("不会触发反作弊。").length).toBeGreaterThan(0);
    expect(scan("不碰你的游戏。").length).toBeGreaterThan(0);
    expect(scan("所以对反作弊系统来说是安全的。").length).toBeGreaterThan(0);
    expect(scan("有些反作弊系统一旦发现安全防护被动过手脚,反应会很不好。").length).toBeGreaterThan(0);
    // The honest sentences must keep passing.
    expect(scan("Compy can't promise how any anti-cheat will react."), "honest EN").toEqual([]);
    expect(scan("Compy 无法承诺任何反作弊系统会作何反应。"), "honest ZH").toEqual([]);
    expect(scan("Breaks Game Pass, anti-cheat compatibility, and security patching"), "'anti-cheat compatibility' as a topic").toEqual([]);
    expect(scan("会破坏 Game Pass、反作弊兼容性和安全补丁机制"), "zh 反作弊兼容性 as a topic").toEqual([]);
  });
});
