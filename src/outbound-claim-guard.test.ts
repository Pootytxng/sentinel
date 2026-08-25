import { describe, it, expect, vi } from "vitest";

// GATE RELIABILITY (2026-08-19): this file reads 200+ shipped files off disk. Building the corpus
// once (see collect() below) cut it from ~8s to ~5s, but under the pre-push gate's full
// parallelism disk contention still puts it near the 15s default -- which is a statement about
// machine load, not about the copy being scanned. Raising it changes nothing this guard asserts.
vi.setConfig({ testTimeout: 60_000 });
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";

// OUTBOUND-CLAIM GUARD (2026-08-03). Replaces the receipts-only copy guard.
//
// WHY THIS EXISTS — two defects, both real:
//
//   1. The retired src/receipts-copy-guard.test.ts keyed ONLY on receipts_gate(). When the signed
//      updater armed on 2026-07-22 Compy gained a real outbound call while shipping copy still said
//      "nothing leaves your PC" — and no guard fired, because none watched the updater. Worse, that
//      guard was a WATCH-LIST: while receipts was dark it asserted the absolute phrases MUST STILL
//      EXIST, so it pinned the false copy in place and failed any attempt to reword it.
//
//   2. This guard's FIRST version fixed the logic but kept an allow-list corpus (src/ + site/ +
//      PRIVACY.md). It therefore missed site-app/ — the actual public marketing site — which still
//      told visitors the app "makes zero outbound network requests". The logic was never the weak
//      part. The CORPUS was.
//
// So the corpus is now INVERTED: walk the whole repo and exclude explicitly. A new surface is
// covered by default. Silence means covered, not skipped.
//
// Paths are repo-root-relative; vitest runs from the repo root (scripts/run-vitest.mjs). No
// __dirname — this project is ESM.

// ── Live-surface detection, read from real config rather than a hand-kept list ──────────────────

function receiptsArmed(): boolean {
  const src = readFileSync(join("src-tauri", "src", "receipts.rs"), "utf8");
  const m = src.match(/fn\s+receipts_gate\s*\(\s*\)\s*->\s*bool\s*\{\s*(true|false)\s*\}/);
  if (!m) throw new Error("could not parse receipts_gate() return literal from receipts.rs");
  return m[1] === "true";
}

function updaterArmed(): boolean {
  const conf = JSON.parse(readFileSync(join("src-tauri", "tauri.conf.json"), "utf8"));
  const endpoints = conf?.plugins?.updater?.endpoints;
  return Array.isArray(endpoints) && endpoints.length > 0;
}

const SURFACES: { name: string; live: () => boolean }[] = [
  { name: "receipts telemetry", live: receiptsArmed },
  { name: "signed update check", live: updaterArmed },
];

// ── Corpus: everything, minus explicit exclusions ───────────────────────────────────────────────

const EXT = /\.(ts|tsx|js|jsx|mjs|json|html|astro|md|css|rs)$/;

// Build output and vendored code. Nothing here is authored copy.
const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", ".github", "dist", "dist-web", "dist-site", "target",
  "coverage", "__snapshots__", ".vite", ".astro", ".claude",
  // .agents is the Codex lane's GITIGNORED mirror of .claude/skills — same content class as
  // .claude, which is already excluded above, and it is not in git at all, so nothing in it can
  // ship to anyone. It broke a push on 2026-08-21: a Codex run wrote 108 files into this worktree
  // mid-session and gate-drift-audit/SKILL.md:42 says "no updater" while auditing whether that row
  // is still true. The guard flagged it, the full suite went red, and NOTHING PUBLISHABLE HAD
  // CHANGED. Worse, the failure is machine-dependent: the directory only exists where Codex has
  // run, so the same commit is green on one desk and red on another. That is the #171 class.
  // The exclusion is asserted safe below — see "the .agents mirror is gitignored".
  ".agents",
  // src-tauri/gen is Tauri's generated schema mirror of capabilities/ — authored copy lives in the
  // source it is generated FROM, and flagging both reports one defect twice.
  "gen",
]);

// docs/ is an internal record shelf: dated specs, reviews, audits and changelogs legitimately
// preserve absolutes that were TRUE when written — rewriting history would be dishonest. These are
// the exceptions: text that is PUBLISHED or HANDED TO A TESTER is live copy, and a tester reading
// "no network calls, no auto-update" in their own guide is not reading history, they are being told
// something false about the build in front of them. (Added 2026-08-18 after exactly that: the beta
// guide still promised no updater a month after the signed updater armed.)
const DOCS_LIVE = new Set([
  join("docs", "PRIVACY.md"),
  join("docs", "EULA.md"),
  join("docs", "BETA_TESTER_README.md"),
]);

// collect() skips leading-underscore paths as local scratch. This one is a message the owner pastes
// to real testers, so it is force-included despite the underscore.
const DISTRIBUTION_FILES = ["_tester-message.md"];

// Tests hold fixtures and quoted examples; this file plants a phrase on purpose.
const SKIP_FILE = /\.(test|spec)\.[tj]sx?$/;

// Escape hatch for text that NAMES a forbidden phrase in order to retire or forbid it (CLAUDE.md
// recording that zero-outbound is dead; RELEASE_STATE recording that the claims were removed).
// Greppable on purpose: `git grep outbound-claim-allow` lists every exemption in the repo.
const ALLOW_MARKER = "outbound-claim-allow";

// GATE RELIABILITY (2026-08-19): two tests ask for this corpus and each one rebuilt it -- a full
// walk of docs/, site/, site-app/ and every committed evidence dump, then a read of 200+ files,
// done twice. In isolation that was ~8s of a 15s timeout; under the pre-push gate's full
// parallelism it went OVER and failed the push twice with nothing wrong in the repo. Building it
// once does NOT narrow what is scanned: the corpus assertions below still pin the exact files by
// name, so a shrunk corpus fails them. (readdir's withFileTypes would remove the per-entry stat
// too, but this repo ships no @types/node and the shimmed fs types reject the option.)
let corpusCache: string[] | null = null;

function collect(): string[] {
  if (corpusCache) return corpusCache;
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith("_")) continue; // local scratch
      const rel = dir === "." ? name : join(dir, name);
      if (statIsDir(rel)) {
        if (!EXCLUDE_DIRS.has(name)) walk(rel);
        continue;
      }
      if (!EXT.test(name) || SKIP_FILE.test(name)) continue;
      if (/^docs[\\/]/.test(rel) && !DOCS_LIVE.has(rel)) continue;
      out.push(rel);
    }
  };
  walk(".");
  for (const f of DISTRIBUTION_FILES) if (existsSync(f) && !out.includes(f)) out.push(f);
  corpusCache = out;
  return out;
}

// statSync throws on a vanished or unreadable entry; a walk that dies on one is a guard that stops
// guarding, so an unreadable path is simply not a directory to descend into.
function statIsDir(rel: string): boolean {
  try { return statSync(rel).isDirectory(); } catch { return false; }
}

// Engineering comments legitimately say "zero outbound" about ONE module (BlackBox, hardware.rs)
// and are true at that scope. Only shipped copy is in scope, so comments are stripped first. The
// `(?<!:)` keeps `https://…` inside a string from reading as a line comment. Worst case that hides
// a phrase later on a URL line — a false negative, never a false positive.
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(?<!:)\/\/[^\n]*/g, " ");
}

// Absolute claims that stop being true the moment ANY outbound surface is live. Deliberately
// unconditional forms only: "Compy makes no network request unless you press Check now" is honest
// and must stay legal, so this targets the absolutes, not every use of the words.
const FORBIDDEN = [
  "nothing leaves your pc",
  "never fetches the internet",
  "no network requests",
  "no network connections",
  "zero outbound",
  "zero-outbound",
  "never sent anywhere",
  // Added 2026-08-18: the beta tester guide still carried all three of these a month after the
  // signed updater armed, in the same document that tells testers to get onto that updater.
  "no network calls",
  "no remote anything",
  "no updater",
  "no auto-update",
  "不会离开你的电脑",
  "从不联网",
];

// The telemetry promise, in every language it actually ships in. Kept SEPARATE from FORBIDDEN
// because it is gated on a different surface: an update check is not telemetry, so this stays true
// while the updater is live and stops being true only when receipts_gate() flips.
//
// The Chinese entry is not decoration. `src/i18n/locales/zh-CN/home.json:447` and
// `settings.json:65` both carry 无遥测数据 — the same promise, to the same users — and an
// English-only phrase list would have walked straight past them at arming time. That is the exact
// defect this repo has already paid for once: plain-language-guard scanned 199 `.tsx?` files and
// none of the 18 locale files it existed to police. A guard's phrase list can be narrower than its
// subject the same way its file filter can.
const TELEMETRY_PROMISE = ["no telemetry", "无遥测"];

export function findAbsolutes(
  text: string,
  phrases: string[] = FORBIDDEN,
): { phrase: string; line: number }[] {
  const hits: { phrase: string; line: number }[] = [];
  stripComments(text).split("\n").forEach((raw, i) => {
    if (raw.includes(ALLOW_MARKER)) return;
    const low = raw.toLowerCase();
    for (const phrase of phrases) if (low.includes(phrase)) hits.push({ phrase, line: i + 1 });
  });
  return hits;
}

/** Files whose live copy still promises no telemetry. Pure, so it can be exercised while dark. */
export function telemetryPromiseOffenders(
  files: { path: string; text: string }[],
): { path: string; phrase: string; line: number }[] {
  return files.flatMap(({ path, text }) =>
    findAbsolutes(text, TELEMETRY_PROMISE).map((hit) => ({ path, ...hit })),
  );
}

// ── The guard ───────────────────────────────────────────────────────────────────────────────────

describe("outbound-claim guard", () => {
  it("each outbound surface is detectable from config (the watch cannot silently rot)", () => {
    for (const s of SURFACES) expect(() => s.live(), s.name).not.toThrow();
  });

  it("covers every shipping surface — the corpus is what failed before, so assert it", () => {
    const files = collect();
    // Regression pins for defect #2: surfaces an allow-list corpus silently missed.
    for (const m of [
      join("site-app", "src", "pages", "index.astro"),
      join("site-app", "src", "pages", "compare.astro"),
      join("site", "privacy.html"),
      join("site", "generate.mjs"),
      join("docs", "PRIVACY.md"),
      join("src", "i18n", "locales", "zh-CN", "settings.json"),
      "CLAUDE.md",
      "COMPY_OVERVIEW.md",
    ]) {
      expect(files, `corpus must include ${m}`).toContain(m);
    }
    expect(files.length).toBeGreaterThan(200);
  });

  it("detects a planted absolute (positive control — proves the guard can actually fail)", () => {
    expect(findAbsolutes('const copy = "Nothing leaves your PC, ever";')).toEqual([
      { phrase: "nothing leaves your pc", line: 1 },
    ]);
    // Comment-stripping must not make it toothless in the other direction.
    expect(findAbsolutes("// module note: zero outbound here\nconst c = 1;")).toEqual([]);
    // The escape hatch works, and only on the line that carries it.
    expect(findAbsolutes(`zero outbound ${ALLOW_MARKER}`)).toEqual([]);
  });

  const liveSurfaces = SURFACES.filter((s) => s.live());

  if (liveSurfaces.length > 0) {
    it(`no absolute offline claim ships while [${liveSurfaces
      .map((s) => s.name)
      .join(", ")}] is live`, () => {
      const offenders: string[] = [];
      for (const file of collect()) {
        for (const { phrase, line } of findAbsolutes(readFileSync(file, "utf8"))) {
          offenders.push(`${file}:${line} → "${phrase}"`);
        }
      }
      expect(
        offenders,
        `Compy has a live outbound surface (${liveSurfaces.map((s) => s.name).join(", ")}), so ` +
          `these absolute claims are false. Reword them to state what actually leaves the machine ` +
          `and when — or, if the text names the phrase in order to retire it, put the ` +
          `${ALLOW_MARKER} marker on that line:\n  ${offenders.join("\n  ")}`,
      ).toEqual([]);
    });
  } else {
    it("no outbound surface is live, so absolutes would be permitted (nothing to enforce)", () => {
      // NOT `expect(liveSurfaces).toEqual([])` — liveSurfaces was filtered to empty three lines
      // above, so that asserted `[] === []` and this branch would stay green even if SURFACES itself
      // had been emptied out from under the guard. The real risk in this branch is that the surface
      // REGISTRY silently loses its entries, which would disarm the whole file while still reading
      // as a passing suite. Assert the registry is populated; the emptiness of the filter is the
      // branch condition, not a finding.
      expect(SURFACES.length, "the outbound-surface registry is empty — this guard is disarmed").toBeGreaterThan(0);
      expect(SURFACES.every((s) => typeof s.live === "function")).toBe(true);
    });
  }

  // Receipts-specific. "No telemetry" is TRUE today even with the updater live — an update check is
  // not telemetry — so this claim is gated on receipts alone, not on the surface set above.
  it("absolute 'no telemetry' copy is reworded in the same change that arms receipts", () => {
    if (!receiptsArmed()) return;
    const offenders = telemetryPromiseOffenders(
      collect().map((path) => ({ path, text: readFileSync(path, "utf8") })),
    ).map((o) => `${o.path}:${o.line} → "${o.phrase}"`);
    expect(
      offenders,
      `receipts_gate() is TRUE but the no-telemetry promise still ships in:\n  ` +
        `${offenders.join("\n  ")}\nRework it (e.g. "local-only by default; optional opt-in sharing"), ` +
        `or mark a line that names the phrase in order to RETIRE it with ${ALLOW_MARKER}.`,
    ).toEqual([]);
  });

  // TRIPWIRE (2026-08-25, #133 Task 4). The test above has never run against real copy: its first
  // line returns while receipts_gate() is false, which it has been every day of its existence. A
  // conditional that has never been true is a test nobody has seen work, and this one guards the
  // single promise the owner ruled outranks our own later amendments (#207, 2026-08-24 — the
  // shipped app description and public download page both say "No telemetry"). Q9a then BUILT the
  // send path that would make it false, so the day it fires is now a real, near date.
  //
  // Same idiom as `support-evidence-outbound-guard.test.ts`'s "states today's tier truth": assert
  // the dormancy out loud, so flipping the gate fails HERE first with an explanation, instead of
  // silently promoting a never-exercised check into a load-bearing one.
  //
  // Deliberately NOT asserted: that the promise still EXISTS anywhere. Pinning the phrase in place
  // is the exact watch-list defect this file's header records — the retired receipts-copy-guard
  // asserted the absolutes MUST STILL EXIST and thereby froze false copy. The promise is free to be
  // reworded any day, by anyone, for any reason.
  it("is honest that the no-telemetry check is dormant, and says so where it will be read", () => {
    expect(
      receiptsArmed(),
      "receipts_gate() just flipped TRUE. The 'no telemetry' check above has run for the first " +
        "time — it was dormant until now. Read its offender list as an AUDIT, not a bug: every " +
        "file it names is public copy that promised no telemetry and no longer can. Rewording " +
        "them is part of the arming commit, not a follow-up.",
    ).toBe(false);
  });

  it("the dormant detector is provably able to fire (positive + negative controls)", () => {
    const found = telemetryPromiseOffenders([
      { path: "src-tauri/tauri.conf.json", text: '"longDescription": "…, no game injection, no telemetry."' },
      { path: "site/index.html", text: "Local-first · no telemetry · no account" },
      { path: "src/i18n/locales/zh-CN/settings.json", text: '"privacy": "无需账号、无遥测数据——…"' },
    ]);
    expect(found.map((o) => o.path)).toEqual([
      "src-tauri/tauri.conf.json",
      "site/index.html",
      "src/i18n/locales/zh-CN/settings.json",
    ]);
    // English-only would have missed the third. That is the whole reason TELEMETRY_PROMISE is a list.
    expect(found[2].phrase).toBe("无遥测");

    // Negative controls: a code comment, a retirement note, and a sentence that is NOT the promise.
    expect(telemetryPromiseOffenders([{ path: "a.ts", text: "// no telemetry here" }])).toEqual([]);
    expect(
      telemetryPromiseOffenders([{ path: "b.md", text: `we removed "no telemetry" ${ALLOW_MARKER}` }]),
    ).toEqual([]);
    expect(
      telemetryPromiseOffenders([
        { path: "c.md", text: "Windows telemetry tasks are what this rec turns off." },
      ]),
    ).toEqual([]);
  });
});

// ── Per-tier model, snapshot and audit (#91) ────────────────────────────────────────────────────
//
// Everything below is PURE over a snapshot so the positive controls can mutate an in-memory tier
// instead of editing working files — the same discipline the policy-coherence guard uses.

export type TierId = "tier1" | "tier2" | "tier3";

export interface TierSnapshot {
  id: TierId;
  label: string;
  /** Repo path that implements this tier. Reserved paths are named even before they exist, so an
   *  unbuilt tier is a fact the audit can state rather than a blind spot. */
  module: string;
  built: boolean;
  armed: boolean;
  source: string;
}

export interface OutboundSnapshot {
  updaterArmed: boolean;
  remoteRulesArmed: boolean;
  tiers: TierSnapshot[];
  copy: { file: string; text: string }[];
}

export function tierOf(snap: OutboundSnapshot, id: TierId): TierSnapshot {
  const t = snap.tiers.find((x) => x.id === id);
  if (!t) throw new Error(`tier ${id} missing from snapshot`);
  return t;
}

/** Reads a `fn name() -> bool { .. }` gate literal, tolerating a commented body (remote_rules.rs
 *  explains itself for five lines before returning false). Missing file/function → not armed. */
export function rustGateLiteral(source: string, fnName: string): boolean {
  // Deliberately string-scanned rather than regex-built: a dynamic `new RegExp` over an escaped
  // template is exactly the kind of expression that can silently compile to something that matches
  // nothing, and a gate reader that always answers "not armed" is worse than no reader at all.
  const at = source.indexOf(`fn ${fnName}(`);
  if (at < 0) return false;
  const open = source.indexOf("{", at);
  if (open < 0 || !source.slice(at, open).includes("bool")) return false;
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) { end = i; break; }
  }
  if (end < 0) return false;
  const lits = stripComments(source.slice(open + 1, end)).match(/\b(true|false)\b/g);
  return lits ? lits[lits.length - 1] === "true" : false;
}

function readIfPresent(path: string): { built: boolean; source: string } {
  try { return { built: true, source: readFileSync(path, "utf8") }; }
  catch { return { built: false, source: "" }; }
}

export const TIER_EVIDENCE_FIXTURE: Record<"tier2" | "tier3", string> = {
  tier2:
    "opt-in, default OFF even after arming; disclosed at first run; a real off switch in Settings; payload preview shown before send; scrub allowlist applied",
  tier3: "explicit per-case consent; redaction preview; named recipient; retention window; deletion receipt",
};

// What each tier must PROVE about itself. Keyed by tier id and consulted only for that tier — this
// keying is the mechanical form of "one tier cannot satisfy another tier's gate".
const TIER_ARMING_EVIDENCE: Record<TierId, { needs: string; re: RegExp }[]> = {
  // Tier 1 never uploads, so it has no consent surface to prove; its invariant is transport shape.
  tier1: [],
  // Tier 2's default was amended LOOSER on 2026-08-18 (docs/decisions/2026-08-18-outbound-capability-
  // expansion.md §2, "on by default once armed") and then ruled back TIGHTER by the owner on
  // 2026-08-24 (#207, docs/RECEIPTS_DOCTRINE.md §RETIRED): opt-in, default OFF, and it STAYS off
  // after arming — because the shipped app description and the public download page already promise
  // "No telemetry", and a claim users have already been given outranks a later internal amendment.
  // So the four obligations stand together rather than substituting for each other: silence means no
  // collection (opt-in), and the disclosure, the off switch and the preview are what make that
  // opt-in informed rather than nominal. Arming without any ONE of them is the failure caught here.
  tier2: [
    { needs: "an opt-in default (OFF even after arming)", re: /opt[-_ ]?in|default[-_ ]?off/i },
    { needs: "the first-run disclosure", re: /disclos/i },
    { needs: "a real off switch", re: /off switch|switch(able)? off|opt[-_ ]?out/i },
    { needs: "payload preview", re: /preview/i },
    { needs: "a scrubbed allowlist", re: /allow[-_ ]?list|allowlist|scrub/i },
  ],
  tier3: [
    { needs: "explicit per-case consent", re: /per[-_ ]?case|explicit consent/i },
    { needs: "preview/redaction", re: /redact|preview/i },
    { needs: "a named recipient", re: /recipient/i },
    { needs: "a retention window", re: /retention/i },
    { needs: "a deletion receipt", re: /delet(e|ion)/i },
  ],
};

// Tier 1 is a signed GET of public advisory knowledge. Any request that can CARRY something is the
// exact thing the owner decision separates from Tier 2/3, so shape is checked, not intent.
const UPLOAD_SHAPE = /\b(post|put|patch)\s*\(|multipart|\.body\s*\(|\bupload/i;

// Copy that admits an upload without naming which tier or whose consent. The qualifier list keeps
// honest sentences legal: "nothing is uploaded unless you approve the file" says the whole truth.
const VAGUE_UPLOAD = [
  /uploads? may occur/i,
  /data may be uploaded/i,
  /we may upload/i,
  /your (data|files?|logs?) (is|are) uploaded/i,
];
const CONSENT_QUALIFIER = /unless you|only when you|only if you|you (pick|choose|approve|select)|per[-_ ]?case|opt[-_ ]?in/i;

export function auditOutboundTiers(snap: OutboundSnapshot): string[] {
  const findings: string[] = [];

  for (const t of snap.tiers) {
    if (t.armed && !t.built) {
      findings.push(`${t.label} is armed but not built — ${t.module} does not exist`);
      continue;
    }
    if (t.id === "tier1" && t.built) {
      const hit = t.source.match(UPLOAD_SHAPE);
      if (hit) {
        findings.push(
          `${t.label} must stay download-only, but ${t.module} carries an upload-shaped call ` +
            `(${hit[0]}). An upload here is Tier 2/3 territory and needs its own gate.`,
        );
      }
    }
    if (t.armed) {
      const missing = TIER_ARMING_EVIDENCE[t.id]
        .filter((e) => !e.re.test(t.source))
        .map((e) => e.needs);
      if (missing.length) {
        findings.push(
          `${t.label} is armed without ${missing.join(", ")} in ${t.module}. ` +
            `Another tier's evidence does not count toward this one.`,
        );
      }
    }
  }

  for (const { file, text } of snap.copy) {
    const body = stripComments(text);
    for (const line of body.split("\n")) {
      if (line.includes(ALLOW_MARKER)) continue;
      if (!VAGUE_UPLOAD.some((re) => re.test(line))) continue;
      if (CONSENT_QUALIFIER.test(line)) continue;
      findings.push(
        `${file} admits an upload without naming the tier or the consent that authorises it: ` +
          `"${line.trim().slice(0, 90)}"`,
      );
    }
  }

  return findings;
}

export function readOutboundSnapshot(): OutboundSnapshot {
  const receipts = readIfPresent(join("src-tauri", "src", "receipts.rs"));
  const caseIntel = readIfPresent(join("src-tauri", "src", "case_intelligence.rs"));
  const caseUpload = readIfPresent(join("src-tauri", "src", "case_evidence_upload.rs"));
  const remote = readIfPresent(join("src-tauri", "src", "remote_rules.rs"));

  return {
    updaterArmed: updaterArmed(),
    remoteRulesArmed: rustGateLiteral(remote.source, "remote_fetch_enabled"),
    tiers: [
      {
        id: "tier1",
        label: "Tier 1 (signed case knowledge)",
        module: "src-tauri/src/case_intelligence.rs",
        built: caseIntel.built,
        armed: rustGateLiteral(caseIntel.source, "case_intelligence_gate"),
        source: caseIntel.source,
      },
      {
        id: "tier2",
        label: "Tier 2 (scrubbed incident fingerprint)",
        module: "src-tauri/src/receipts.rs",
        built: receipts.built,
        armed: receipts.built && receiptsArmed(),
        source: receipts.source,
      },
      {
        id: "tier3",
        label: "Tier 3 (per-case evidence upload)",
        module: "src-tauri/src/case_evidence_upload.rs",
        built: caseUpload.built,
        armed: rustGateLiteral(caseUpload.source, "case_evidence_upload_gate"),
        source: caseUpload.source,
      },
    ],
    copy: collect().map((file) => ({ file, text: readFileSync(file, "utf8") })),
  };
}

// ── TIER-AWARE OUTBOUND INVARIANTS (#91, Capability Exception Gate) ─────────────────────────────
//
// WHY THIS EXISTS. The guard above asks ONE question — "is anything live?" — and that question
// stopped being sufficient on 2026-08-09, when the owner retired zero-outbound absolutism and
// replaced it with THREE separately-consented tiers:
//
//   Tier 1  signed advisory DOWNLOAD, no machine data ever leaves
//   Tier 2  opt-in scrubbed incident fingerprint
//   Tier 3  explicit per-case evidence upload
//
// The failure mode this pins is tier COLLAPSE: Tier 1 ships, and its approval is quietly read as
// permission for the other two — a download gate growing an upload, or Tier 2/3 arming on Tier 1's
// consent. Merging their transport or their consent is exactly what the decision forbids, so the
// audit is per-tier by construction and a positive control proves one tier's evidence cannot clear
// another's gate.

describe("outbound tier separation", () => {
  it("reads a snapshot of every tier from the repo, so the audit cannot drift from reality", () => {
    const snap = readOutboundSnapshot();
    expect(snap.tiers.map((t) => t.id)).toEqual(["tier1", "tier2", "tier3"]);
    expect(typeof snap.updaterArmed).toBe("boolean");
    expect(typeof snap.remoteRulesArmed).toBe("boolean");
  });

  it("the live repo satisfies every tier invariant", () => {
    expect(auditOutboundTiers(readOutboundSnapshot())).toEqual([]);
  });

  it("the gate reader survives a commented body, and cannot silently answer 'false' forever", () => {
    // remote_rules.rs explains itself for five lines before returning false. A naive
    // `-> bool { (true|false) }` regex misses that shape and reports "not armed" for a gate it
    // never actually read — the exact rot this guard is supposed to be immune to.
    const commentedTrue = ["fn g() -> bool {", "  // false is the safe default", "  true", "}"].join("\n");
    const commentedFalse = ["fn g() -> bool {", "  // would be: KEY != [0u8; 32]", "  false", "}"].join("\n");
    expect(rustGateLiteral(commentedTrue, "g")).toBe(true);
    expect(rustGateLiteral(commentedFalse, "g")).toBe(false);
    expect(rustGateLiteral("fn g() -> bool { true }", "other")).toBe(false);
  });

  it("the gates it reads still exist under those names (a rename must break this, not disarm it)", () => {
    expect(readFileSync(join("src-tauri", "src", "remote_rules.rs"), "utf8"))
      .toMatch(/fn\s+remote_fetch_enabled\s*\(\s*\)\s*->\s*bool/);
    expect(readFileSync(join("src-tauri", "src", "receipts.rs"), "utf8"))
      .toMatch(/fn\s+receipts_gate\s*\(\s*\)\s*->\s*bool/);
    // Current truth, asserted so arming shows up here as a red test rather than as silence.
    const snap = readOutboundSnapshot();
    expect(snap.remoteRulesArmed, "remote rules fetch is triple-gated OFF").toBe(false);
    expect(tierOf(snap, "tier2").armed).toBe(receiptsArmed());
    expect(tierOf(snap, "tier1").built, "Tier 1 is approved but not built").toBe(false);
    expect(tierOf(snap, "tier3").built, "Tier 3 is not authorized by Tier 1").toBe(false);
  });

  it("Tier 1 fails the moment it grows an upload", () => {
    const snap = readOutboundSnapshot();
    const t1 = tierOf(snap, "tier1");
    t1.built = true;
    t1.source = 'client.post(CATALOG_URL).body(incident_payload).send()';
    expect(auditOutboundTiers(snap).join(" ")).toMatch(/tier 1 .*(upload|post)/i);
  });

  it("Tier 2 cannot arm without disclosure, an off switch, payload preview and a scrubbed allowlist", () => {
    const snap = readOutboundSnapshot();
    const t2 = tierOf(snap, "tier2");
    t2.built = true;
    t2.armed = true;
    t2.source = "fn receipts_gate() -> bool { true }";
    expect(auditOutboundTiers(snap).join(" ")).toMatch(/tier 2/i);
  });

  it("Tier 3 cannot arm without per-case consent, preview/redaction, recipient, retention and deletion", () => {
    const snap = readOutboundSnapshot();
    const t3 = tierOf(snap, "tier3");
    t3.built = true;
    t3.armed = true;
    t3.source = "fn upload_case_evidence() { post(recipient, evidence) }";
    expect(auditOutboundTiers(snap).join(" ")).toMatch(/tier 3/i);
  });

  it("one tier's evidence cannot satisfy another tier's gate", () => {
    const snap = readOutboundSnapshot();
    // Tier 1 is handed EVERY marker Tier 2 and Tier 3 would need. Tier 2 still arms with nothing.
    const t1 = tierOf(snap, "tier1");
    t1.built = true;
    t1.source = TIER_EVIDENCE_FIXTURE.tier2 + "\n" + TIER_EVIDENCE_FIXTURE.tier3;
    const t2 = tierOf(snap, "tier2");
    t2.built = true;
    t2.armed = true;
    t2.source = "fn receipts_gate() -> bool { true }";
    expect(auditOutboundTiers(snap).join(" ")).toMatch(/tier 2/i);
  });

  it("an armed tier that was never built is a contradiction, not a pass", () => {
    const snap = readOutboundSnapshot();
    const t1 = tierOf(snap, "tier1");
    t1.built = false;
    t1.armed = true;
    expect(auditOutboundTiers(snap).join(" ")).toMatch(/tier 1 .*armed .*not built/i);
  });

  it("rejects vague upload copy that hides which tier and which consent", () => {
    const snap = readOutboundSnapshot();
    snap.copy.push({ file: "site/fake.html", text: "Uploads may occur to improve Compy." });
    expect(auditOutboundTiers(snap).join(" ")).toMatch(/site\/fake\.html/);
  });

  it("tier-qualified upload copy stays legal", () => {
    const snap = readOutboundSnapshot();
    snap.copy.push({
      file: "site/fake.html",
      text: "Nothing is uploaded unless you pick a case and approve the exact file we send.",
    });
    expect(auditOutboundTiers(snap)).toEqual([]);
  });
});

// bug→guard (2026-08-21): an excluded directory is only safe to exclude while it CANNOT ship.
//
// .agents was added to EXCLUDE_DIRS because it is the Codex lane's gitignored mirror of
// .claude/skills. That reasoning has one load-bearing premise -- it is not in git -- and premises
// rot silently. If someone commits .agents/ later, it becomes publishable text that this guard has
// been told to look away from, which is precisely the corpus hole the header above says killed the
// FIRST version of this guard ("The logic was never the weak part. The CORPUS was.").
//
// So the exclusion asserts its own premise instead of trusting a comment.
describe("corpus exclusions that rest on 'it cannot ship' must prove it", () => {
  const tracked = (path: string): string[] =>
    execFileSync("git", ["ls-files", "--", path], { encoding: "utf8" })
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

  it("the .agents mirror is gitignored, which is the only reason skipping it is safe", () => {
    expect(
      tracked(".agents"),
      "EXCLUDE_DIRS skips .agents because it is a gitignored local mirror that cannot reach " +
        "anyone. These files are now TRACKED, so that reasoning no longer holds: either drop " +
        '".agents" from EXCLUDE_DIRS so its copy is scanned like every other shipped surface, or ' +
        "stop tracking it. Do not widen the exclusion.",
    ).toEqual([]);
  });

  it(".claude rests on the same premise and is checked the same way", () => {
    // .claude IS partially tracked (settings, hooks, skills) -- but it is agent tooling that runs
    // on a developer machine, never copy shipped to a user, so its exclusion rests on a different
    // premise than .agents'. This test pins the distinction so the two are not merged by someone
    // tidying the list: if .claude ever lands in the built app, that is the thing to catch.
    const shipped = tracked("src-tauri/resources/.claude").concat(tracked("site/.claude"));
    expect(
      shipped,
      ".claude copy is now bundled into a shipped surface, so excluding it from this guard hides " +
        "live claims from the scan. Scan it, or stop shipping it.",
    ).toEqual([]);
  });
});
