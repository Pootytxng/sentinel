// Guard for scripts/usage-audit.mjs itself — the report generator, not its libraries.
//
// WHY A NEW FILE. Four test files mention "usage-audit" (actions-health, disk-bloat-guard,
// gate-residency-guard, superseded-plan-citation-guard) and none of them has this script as its
// SUBJECT: two guard a library it imports, one guards a report path it writes, one guards a
// citation that quotes a generated row. Nothing pinned the script's own output, which is how the
// three defects below all shipped together.
//
// BUG→GUARD for issue #473, fixed in 640cb66a with no test attached. Three defects, one guard each:
//
//  A. DOUBLE MARKER. The working-headroom flag was pushed as `🔴 ${room.reason}` while
//     usableHeadroom()'s own failing reason already opens with 🔴 — so the one flag the owner is
//     meant to act on printed "🔴 🔴 only 7k of working headroom". Pinned by RUNNING the script
//     against a fixture that makes the flag fire and counting the markers in the emitted line.
//
//  B. UNNAMED GATE. DOC_BYTE_BUDGETS rows are TARGETS, deliberately tighter than the real byte
//     gates, and the rows carried no pointer to the gate — so a reader who hit a 🟡 had no way to
//     tell nag from block. Each row now names its gate, and this guard derives the correct answer
//     from the gate files rather than restating it: a doc that is a key in $byteBudgets must name
//     scripts/doc-budget.ps1, and a doc that is NOT a key must name the gate that does cover it.
//
//  C. STALE HEADER. The header's flag list was five bullets under a 2026-07-13 date while the
//     script pushed eight distinct flags. Pinned by binding each bullet to exactly one primary
//     flags.push() site, in source order.
//
// Plus one citation the #473 fix left standing (Scope 2): the BACKLOG advice and the usage-audit
// skill both cited a "retention rule" in docs/BACKLOG.md that the rebuilt ledger no longer states.
// A citation may not survive the rule it cites.
//
// Every filesystem case is built in a temp directory and the script is run as a SUBPROCESS against
// it: the script scans ~/.claude/projects at import time, so importing it here would audit the
// machine running the test. USAGE_AUDIT_SCRIPT lets the red proof point this same file at a
// pre-fix copy of the script without editing the live tree.
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPTS, "..");
const AUDIT = process.env.USAGE_AUDIT_SCRIPT || join(SCRIPTS, "usage-audit.mjs");
const SOURCE = readFileSync(AUDIT, "utf8");

const temps = [];
const scratch = (tag) => {
  const dir = mkdtempSync(join(tmpdir(), `usage-audit-${tag}-`));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Compute once, on first use — never in a describe() body. A guard whose setup throws during
 * collection reports "no tests" and names nothing; the same throw inside an it() names the case.
 */
const once = (fn) => {
  let done = false;
  let value;
  return () => {
    if (!done) {
      value = fn();
      done = true;
    }
    return value;
  };
};

// ---------------------------------------------------------------------------------------------
// A. the working-headroom flag carries exactly one 🔴
// ---------------------------------------------------------------------------------------------

// The arithmetic the fixture is built to satisfy, spelled out so a later reader can re-derive it:
//   ceiling  = WINDOW − NATIVE_COMPACT_RESERVE = 120000 − 33000 = 87000
//   floorP75 = floors[floor(3 * 0.75)] = floors[2] = 80000   (usage-audit.mjs sorts floors ascending)
//   headroom = 87000 − 80000 = 7000, which is under MIN_WORKING_HEADROOM (60000) → the flag fires.
const WINDOW = 120_000;
const FLOORS = [70_000, 75_000, 80_000];

/** One assistant turn as the harness writes it: usage on message, context = the three input counts. */
const turn = (timestamp, id, ctx) =>
  JSON.stringify({
    type: "assistant",
    timestamp,
    uuid: id,
    message: {
      id,
      model: "claude-sonnet-5",
      content: [],
      usage: { input_tokens: ctx, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  });

function runAudit() {
  const home = scratch("home");
  const repo = scratch("repo");
  const proj = join(home, ".claude", "projects", "-fixture");
  mkdirSync(proj, { recursive: true });
  mkdirSync(join(repo, "docs"), { recursive: true });

  FLOORS.forEach((floor, i) => {
    // Dated after WINDOW_CONFIGURED_SINCE so the peak flag treats them as current, and peaking well
    // under the window so the peak flag itself stays silent — this case is about ONE flag.
    const day = `2026-09-1${i}`;
    const body = [
      turn(`${day}T00:00:00.000Z`, `msg-${i}-a`, floor),
      turn(`${day}T00:10:00.000Z`, `msg-${i}-b`, floor + 5_000),
    ].join("\n");
    writeFileSync(join(proj, `session-${i}.jsonl`), `${body}\n`);
  });

  const res = spawnSync(process.execPath, [AUDIT], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home, // homedir() reads HOME on POSIX...
      USERPROFILE: home, // ...and USERPROFILE on win32. Both, so the fixture holds on either.
      USAGE_AUDIT_REPO: repo,
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(WINDOW),
    },
  });
  expect(res.status, `usage-audit.mjs exited ${res.status}: ${res.stderr}`).toBe(0);

  // Health flags are emitted as "- <flag>" under the "## Health flags" heading.
  const lines = res.stdout.split(/\r?\n/);
  const start = lines.indexOf("## Health flags");
  expect(start, `no "## Health flags" section in:\n${res.stdout.slice(0, 800)}`).toBeGreaterThan(-1);
  const flags = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("- ")) flags.push(line.slice(2));
    else if (flags.length) break;
  }
  return { flags, stdout: res.stdout };
}

const audited = once(runAudit);
const headroomFlag = () => {
  const hits = audited().flags.filter((f) => f.includes("of working headroom"));
  expect(hits, `flags were:\n${audited().flags.join("\n")}`).toHaveLength(1);
  return hits[0];
};

describe("A. working-headroom flag", () => {
  it("fires for the fixture — otherwise this whole case would pass vacuously", () => {
    expect(headroomFlag()).toContain("Sessions are configured to thrash");
  });

  it("carries exactly one 🔴: usableHeadroom()'s reason already opens with its own", () => {
    const flag = headroomFlag();
    expect(flag.match(/🔴/gu) || [], `flag was: ${flag}`).toHaveLength(1);
    expect(flag.startsWith("🔴")).toBe(true);
  });

  it("does not double-mark any other flag either", () => {
    for (const f of audited().flags) expect((f.match(/🔴/gu) || []).length, `flag: ${f}`).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------------------------
// B. every DOC_BYTE_BUDGETS row names its doc's real byte gate
// ---------------------------------------------------------------------------------------------

/** Read the table out of the source rather than importing: the script audits the machine on import. */
function docByteBudgets() {
  const table = SOURCE.match(/const DOC_BYTE_BUDGETS = \[[\s\S]*?\n\];/);
  expect(table, "DOC_BYTE_BUDGETS is no longer a literal array in scripts/usage-audit.mjs").toBeTruthy();
  const helper = SOURCE.match(/^const DOC_BUDGET_PS1 = .*;$/m);
  return new Function(`${helper ? helper[0] : ""}\n${table[0]}\nreturn DOC_BYTE_BUDGETS;`)();
}

/** The docs scripts/doc-budget.ps1 actually gates by bytes, read from $byteBudgets itself. */
function ps1ByteBudgetDocs() {
  const ps1 = readFileSync(join(REPO, "scripts", "doc-budget.ps1"), "utf8");
  const block = ps1.match(/\$byteBudgets\s*=\s*@\{([\s\S]*?)^\}/m);
  expect(block, "$byteBudgets is no longer a literal hashtable in scripts/doc-budget.ps1").toBeTruthy();
  return [...block[1].matchAll(/"([^"]+)"\s*=\s*\d+/g)].map((m) => m[1]);
}

const budgetRows = once(docByteBudgets);
const ps1Docs = once(ps1ByteBudgetDocs);

describe("B. DOC_BYTE_BUDGETS rows name their real byte gate", () => {
  it("reads a non-empty table whose rows are [doc, target, advice, gate]", () => {
    const rows = budgetRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row, `row: ${JSON.stringify(row)}`).toHaveLength(4);
      const [rel, budget, advice, gate] = row;
      expect(typeof rel).toBe("string");
      expect(typeof budget).toBe("number");
      expect(budget).toBeGreaterThan(0);
      expect(typeof advice).toBe("string");
      expect(advice.length, `row ${rel} has no advice`).toBeGreaterThan(0);
      expect(typeof gate, `row ${rel} names no byte gate`).toBe("string");
    }
  });

  it("names a gate as '<symbol> in <path>', and that symbol is declared in that file", () => {
    for (const [rel, , , gate] of budgetRows()) {
      const m = String(gate).match(/^(\S+) in (\S+)$/);
      expect(m, `row ${rel}: gate "${gate}" is not "<symbol> in <path>"`).toBeTruthy();
      const [, symbol, path] = m;
      const abs = join(REPO, path);
      expect(existsSync(abs), `row ${rel}: gate file ${path} does not exist`).toBe(true);
      const text = readFileSync(abs, "utf8");
      expect(
        new RegExp(`${escapeRe(symbol)}\\s*=`).test(text),
        `row ${rel}: ${path} declares no ${symbol}`,
      ).toBe(true);
    }
  });

  it("points at doc-budget.ps1 exactly when $byteBudgets covers that doc, and elsewhere when it does not", () => {
    const gatedByPs1 = ps1Docs();
    for (const [rel, , , gate] of budgetRows()) {
      const path = String(gate).split(" in ").pop();
      if (gatedByPs1.includes(rel)) {
        expect(path, `${rel} IS a $byteBudgets key, so its gate is doc-budget.ps1`).toBe("scripts/doc-budget.ps1");
        continue;
      }
      // Not covered by the ps1 — so the row must point at whatever gate does cover it, and that
      // file must actually name the doc. CLAUDE.md is the live case: doc-budget.ps1 leaves it out
      // of $byteBudgets on purpose (src-tauri/CLAUDE.md is a different key), and
      // src/claude-md-laws-guard.test.ts holds its MAX_BYTES.
      expect(path, `${rel} is not a $byteBudgets key, so it must not cite doc-budget.ps1`).not.toBe(
        "scripts/doc-budget.ps1",
      );
      const gateText = readFileSync(join(REPO, path), "utf8");
      expect(gateText.includes(rel.split("/").pop()), `${path} never mentions ${rel}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// C. the header's flag list matches the flags.push() sites, in push order
// ---------------------------------------------------------------------------------------------

/** Header bullets: "//   - " opens one, "//     " continues it. */
function headerFlagBullets() {
  const lines = SOURCE.split(/\r?\n/);
  const head = lines.findIndex((l) => /^\/\/ Health flags it raises/.test(l));
  expect(head, "the header no longer introduces its flag list").toBeGreaterThan(-1);
  const heading = [];
  const bullets = [];
  for (let i = head; i < lines.length; i++) {
    const l = lines[i];
    if (/^\/\/ {3}- /.test(l)) bullets.push(l.replace(/^\/\/ {3}- /, ""));
    else if (/^\/\/ {5}\S/.test(l) && bullets.length) bullets[bullets.length - 1] += ` ${l.replace(/^\/\/ {5}/, "")}`;
    else if (!bullets.length) heading.push(l.replace(/^\/\/ ?/, ""));
    else break;
  }
  return { heading: heading.join(" "), bullets };
}

/**
 * Primary flag pushes: one per distinct finding. `else`-branch pushes are the SAME finding in its
 * other state (🔴/🟢), and the all-clear line is the absence of findings — neither earns a bullet.
 */
function primaryPushLines() {
  const lines = SOURCE.split(/\r?\n/);
  const body = lines.findIndex((l) => /^const flags = \[\];/.test(l));
  expect(body, "scripts/usage-audit.mjs no longer builds a `flags` array").toBeGreaterThan(-1);
  const out = [];
  for (let i = body; i < lines.length; i++) {
    const l = lines[i];
    if (!l.includes("flags.push(")) continue;
    if (/No health flags/.test(l)) continue; // the all-clear, not a finding
    if (/\belse\b/.test(l.slice(0, l.indexOf("flags.push(")))) continue;
    const prev = lines.slice(0, i).reverse().find((p) => p.trim() !== "") || "";
    if (/^\}?\s*else\b/.test(prev.trim())) continue;
    out.push(i);
  }
  return out;
}

// One row per header bullet, in header order. `bullet` must appear in that bullet (so this table
// cannot drift from the header), `source` must appear at or before that bullet's push site (so the
// binding is to a real flag, in the real push order).
const BULLET_ANCHORS = [
  { bullet: "flagPeakContext()", source: "flagPeakContext(rows" },
  { bullet: "usableHeadroom()", source: "usableHeadroom(windowInfo" },
  { bullet: "opus/fable", source: "opus/fable" },
  { bullet: "carried context", source: "carried context (cache-read)" },
  { bullet: "DOC_BYTE_BUDGETS", source: "const DOC_BYTE_BUDGETS" },
  { bullet: "diskBloatFlags()", source: "diskBloatFlags(REPO)" },
  { bullet: "floor step", source: "FLOOR TREND" },
  { bullet: "Edit errors", source: "file not read yet" },
];

const header = once(headerFlagBullets);
const pushLines = once(primaryPushLines);

describe("C. header flag list vs the flags.push() sites", () => {
  it("lists one bullet per distinct flag the script pushes", () => {
    const { bullets } = header();
    const pushes = pushLines();
    expect(bullets, `bullets:\n${bullets.join("\n")}`).toHaveLength(pushes.length);
    expect(bullets).toHaveLength(BULLET_ANCHORS.length);
  });

  it("carries no date on the heading — a dated list is a list nobody updates", () => {
    const { heading } = header();
    expect(heading).toMatch(/order it pushes them/);
    expect(heading, `heading: ${heading}`).not.toMatch(/\b(?:19|20)\d{2}\b/);
  });

  it("binds each bullet to its push site, in source order", () => {
    const { bullets } = header();
    const pushes = pushLines();
    const lines = SOURCE.split(/\r?\n/);
    const bodyStart = lines.findIndex((l) => /^const flags = \[\];/.test(l));
    let previous = bodyStart;
    BULLET_ANCHORS.forEach((anchor, i) => {
      expect(bullets[i], `bullet ${i + 1} does not mention ${anchor.bullet}`).toContain(anchor.bullet);
      const at = lines.findIndex((l, n) => n >= bodyStart && l.includes(anchor.source));
      expect(at, `"${anchor.source}" is gone from the flag block`).toBeGreaterThan(-1);
      expect(at, `"${anchor.source}" is out of push order`).toBeGreaterThanOrEqual(previous);
      expect(
        pushes[i],
        `bullet ${i + 1} (${anchor.bullet}) does not sit at the ${i + 1}th flag push`,
      ).toBeGreaterThanOrEqual(at);
      if (i + 1 < BULLET_ANCHORS.length) {
        const next = lines.findIndex((l, n) => n >= bodyStart && l.includes(BULLET_ANCHORS[i + 1].source));
        expect(pushes[i], `bullet ${i + 1} overruns the next bullet's region`).toBeLessThan(next);
      }
      previous = at;
    });
  });
});

// ---------------------------------------------------------------------------------------------
// D. no citation may outlive the rule it cites  (Scope 2 of the #473 follow-up)
// ---------------------------------------------------------------------------------------------

// docs/BACKLOG.md was rebuilt as an execution ledger on 2026-09-05 and states no retention rule and
// has no steering-log section; the rule text survives only in docs/BACKLOG_ARCHIVE.md, describing a
// section that no longer exists. Two places still sent the reader to BACKLOG.md for it.
const CITATIONS = [
  {
    where: "scripts/usage-audit.mjs",
    cites: /per (?:its|the) retention rule/i,
    statedIn: "docs/BACKLOG.md",
    token: /retention/i,
  },
  {
    where: ".claude/skills/usage-audit/SKILL.md",
    cites: /per (?:its|the) retention rule/i,
    statedIn: "docs/BACKLOG.md",
    token: /retention/i,
  },
  {
    where: ".claude/skills/usage-audit/SKILL.md",
    cites: /steering-log section/i,
    statedIn: "docs/BACKLOG.md",
    token: /steering[- ]log/i,
  },
];

describe("D. citations of a rule in another doc", () => {
  for (const c of CITATIONS) {
    it(`${c.where} may only say ${c.cites} while ${c.statedIn} bears it out`, () => {
      const text = readFileSync(join(REPO, c.where), "utf8");
      if (!c.cites.test(text)) return; // nothing cited — nothing to keep true
      const target = readFileSync(join(REPO, c.statedIn), "utf8");
      expect(
        c.token.test(target),
        `${c.where} cites ${c.cites} as living in ${c.statedIn}, which no longer says it`,
      ).toBe(true);
    });
  }
});
