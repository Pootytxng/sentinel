import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const read = (path: string) => readFileSync(path, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

const constitution = read("docs/PRODUCT_CONSTITUTION.md");
const claude = read("CLAUDE.md");
const agents = read("AGENTS.md");
const rootReadme = read("README.md");
const docsReadme = read("docs/README.md");
const locks = read("docs/ARCHITECTURE_LOCKS.md");
const backlog = read("docs/BACKLOG.md");
const roadmap = read("docs/product/ROADMAP.md");
const workControl = read("docs/WORK_CONTROL.md");
const product = read("PRODUCT.md");
const supersessionManifest = read("docs/product/SUPERSESSION_MANIFEST.md");

const legacyTombstones = [
  "docs/RECEIPTS_DOCTRINE.md",
  "docs/PRODUCT_DIRECTION.md",
  "docs/PRD.md",
  "docs/MONETIZATION.md",
  "docs/MONETIZATION_PLAN.md",
  "COMPY_OVERVIEW.md",
];

// Live routing/bootstrap files outside the authority stack that a fresh session still reads.
const legacyRoutingFiles = [
  "PRODUCT.md",
  "docs/SESSION_HANDOFF.md",
  "docs/COWORK_HANDOFF.md",
  "docs/COUNCIL_PROTOCOL.md",
  "docs/PRICING_RESEARCH.md",
  "docs/OWNER_ACTION_CHECKLIST.md",
  "docs/LANE_BUS.md",
  "docs/LANE_WORKFLOW.md",
  "docs/PARALLEL_WORKTREE_OPS.md",
  "docs/UI_VISION_BACKLOG.md",
  "docs/GAMING_MODE_QA.md",
  ".claude/skills/INDEX.md",
  ".claude/skills/status/SKILL.md",
  ".claude/skills/doc-sync/SKILL.md",
  ".claude/skills/self-review/SKILL.md",
  ".claude/agents/web-design-director.md",
  ".claude/agents/self-reviewer.md",
  ".codex/agents/web-design-director.toml",
  "docs/decisions/2026-08-09-capability-exception-gate.md",
].filter(existsSync);

const TOMBSTONE_NAME =
  /Receipts [Dd]octrine|RECEIPTS_DOCTRINE\.md|PRODUCT_DIRECTION\.md|MONETIZATION_PLAN\.md|\bPRD\.md|COMPY_OVERVIEW\.md/;
const RETIRED_WORD = /tombstone|superseded|historical|history|retired|pre-rebirth|bounded provenance/i;

const activeAuthorityFiles: [string, string][] = [
  ["CLAUDE.md", claude],
  ["AGENTS.md", agents],
  ["README.md", rootReadme],
  ["docs/README.md", docsReadme],
  ["docs/ARCHITECTURE_LOCKS.md", locks],
  ["docs/BACKLOG.md", backlog],
  ["docs/product/ROADMAP.md", roadmap],
  ["docs/WORK_CONTROL.md", workControl],
  ["PRODUCT.md", product],
];

const CURRENT_LOOKING_ROOTS = [
  "docs/superpowers/specs",
  "docs/superpowers/plans",
  "docs/reviews",
  "docs/decisions",
];
const PRE_REBIRTH_CUTOFF = "2026-09-04";
const CURRENT_AUTHORITY_SIGNAL =
  /(?:\bStatus\b[^\n]{0,40}\b(?:ACTIVE|IN BUILD|GREEN[- ]?LIT|IMPLEMENTATION[- ]?READY)\b|owner[- ]approved direction|owner[- ]requested program blueprint|owner\s+GO|begin implementing|PRIORITY OVERRIDE|implementation[- ]ready plan|PRODUCT_DIRECTION\.md sequence is authoritative|product priority and completion remain in|(?:source of truth|canonical|governing)[^\n]{0,140}(?:product|direction|roadmap|priority|build|launch|monetization|experience|ui)|(?:product|direction|roadmap|priority|build|launch|monetization|experience|ui)[^\n]{0,140}(?:source of truth|canonical|governing))/i;
const SUPERSESSION_BANNER = /(?:POLICY AND )?PRODUCT DIRECTION SUPERSEDED|PRODUCT[- ]DIRECTION AUTHORITY RETIRED/i;

const CURRENT_LOOKING_BASELINE = [
  "docs/decisions/2026-08-18-outbound-capability-expansion.md",
  "docs/reviews/2026-07-16-owner-directive-intelligence-platform.md",
  "docs/superpowers/specs/2026-07-16-intelligence-foundation-train1.md",
  "docs/superpowers/specs/2026-07-29-product-quality-stabilization-program.md",
  "docs/superpowers/specs/2026-08-09-compy-care-capability-exception-gate.md",
];

function collectMarkdown(root: string): string[] {
  const out: string[] = [];
  const walk = (path: string) => {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const child of readdirSync(path)) walk(join(path, child));
    } else if (path.endsWith(".md")) {
      out.push(path.replace(/\\/g, "/"));
    }
  };
  walk(root);
  return out;
}

function collectAgentEntrypoints(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (path: string) => {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const child of readdirSync(path)) walk(join(path, child));
    } else if (path.endsWith(".md") || path.endsWith(".toml")) {
      out.push(path.replace(/\\/g, "/"));
    }
  };
  walk(root);
  return out;
}

function datedPathIsPreRebirth(path: string): boolean {
  const match = path.match(/(?:^|\/)(20\d\d-\d\d-\d\d)[^/]*\.md$/);
  return Boolean(match && match[1] < PRE_REBIRTH_CUTOFF);
}

function manifestClassifies(path: string): boolean {
  return supersessionManifest.includes(`\`${path}\``);
}

function hasTopLevelConstitutionBoundary(body: string): boolean {
  const top = body.slice(0, 2400);
  return SUPERSESSION_BANNER.test(top) && top.includes("docs/PRODUCT_CONSTITUTION.md");
}

export function findUnboundedCurrentLookingLegacyDocs(snapshot: Record<string, string>): string[] {
  return Object.entries(snapshot)
    .filter(([path]) => datedPathIsPreRebirth(path))
    .filter(([, body]) => CURRENT_AUTHORITY_SIGNAL.test(body.slice(0, 5000)))
    .filter(([path, body]) => !hasTopLevelConstitutionBoundary(body) && !manifestClassifies(path))
    .map(([path]) => path)
    .sort();
}

describe("Compy product constitution authority", () => {
  it("contains the ratified north-star laws", () => {
    const f = flat(constitution);
    expect(f).toContain(
      "The user chooses the destination. Compy handles the technical route, proves the result, explains the tradeoffs, and never hides the way back.",
    );
    expect(f).toContain("Compy optimizes outcomes, not settings.");
    expect(f).toContain("MAKE THIS PC BETTER.");
    expect(f).toContain("FIGURE OUT WHAT WENT WRONG.");
    expect(f).toContain("The fundamental unit of optimization is not a tweak.");
    expect(f).toContain("It is a **Trial**.");
    expect(f).toContain("No measurable change. Original setting restored.");
    expect(f).toContain("Simple outside, deep inside");
  });

  it("keeps the four authority domains separate", () => {
    const f = flat(constitution);
    expect(f).toContain("Product truth — `docs/PRODUCT_CONSTITUTION.md`");
    expect(f).toContain("Safety/architecture truth — `docs/ARCHITECTURE_LOCKS.md`");
    expect(f).toContain("Current implementation/release truth — `docs/RELEASE_STATE.md`");
    expect(f).toContain("Execution ownership truth — `docs/WORK_CONTROL.md`");
  });

  it.each([
    ["CLAUDE.md", claude],
    ["AGENTS.md", agents],
    ["README.md", rootReadme],
    ["docs/README.md", docsReadme],
    ["docs/BACKLOG.md", backlog],
  ])("%s routes product work through PRODUCT_CONSTITUTION.md", (_name, body) => {
    expect(body).toContain("PRODUCT_CONSTITUTION.md");
  });

  it("Architecture Locks declares safety authority, not product hierarchy", () => {
    expect(locks).toContain("SUPREME SAFETY / ARCHITECTURE AUTHORITY");
    expect(locks).toContain("PRODUCT_CONSTITUTION.md");
    expect(locks).not.toMatch(/Care is (?:the )?primary product/i);
    expect(locks).not.toMatch(/optimization is (?:a )?(?:secondary|second) specialty/i);
  });

  it("Backlog is execution-only and derives priority from the reborn roadmap", () => {
    expect(backlog).toContain("current execution status only");
    expect(backlog).toContain("product/ROADMAP.md");
    expect(backlog).toContain("do **not** retain priority merely because they predate the Product Constitution");
    expect(backlog).not.toContain("CURRENT PROGRAM CUTLINE — PRODUCT QUALITY STABILIZATION");
  });

  it("Work Control separates product authority from execution status", () => {
    expect(workControl).toContain("docs/PRODUCT_CONSTITUTION.md");
    expect(workControl).toContain("docs/product/ROADMAP.md");
    expect(workControl).toContain("current execution status only");
    expect(workControl).not.toMatch(/BACKLOG\.md[^\n]{0,100}(?:authoritative|canonical)[^\n]{0,60}(?:priority|product priority)/i);
    expect(workControl).not.toMatch(/Product priority and completion[^\n]*BACKLOG\.md/i);
  });

  it.each(legacyTombstones)("%s is mechanically marked superseded/historical", (path) => {
    const body = read(path);
    expect(body).toMatch(/SUPERSEDED|HISTORICAL ONLY|HISTORICAL SNAPSHOT ONLY/);
    expect(body).toContain("PRODUCT_CONSTITUTION.md");
  });

  it("the supersession manifest makes pre-rebirth product authority default-dead", () => {
    expect(supersessionManifest).toContain("Ratification cutoff: 2026-09-04");
    expect(supersessionManifest).toContain("zero product-direction authority by default");
    expect(supersessionManifest).toContain("technical provenance never promotes the surrounding historical product direction back into force");
  });

  it("active authority files cannot restore the retired Care-vs-Performance hierarchy", () => {
    const forbidden = [
      /Care is (?:the )?primary product/i,
      /Compy Care is (?:the )?primary product/i,
      /optimization(?:\/proving)? is (?:the )?(?:second|secondary) specialty/i,
      /optimization remains .* secondary to diagnosis/i,
    ];

    for (const [path, body] of activeAuthorityFiles) {
      for (const pattern of forbidden) {
        expect(body, `${path} restored retired product hierarchy: ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("active authority cannot make the Receipts Doctrine canonical again", () => {
    for (const [path, body] of activeAuthorityFiles) {
      expect(body, `${path} restored Receipts Doctrine authority`).not.toMatch(
        /Receipts Doctrine[^\n]{0,80}(?:canonical|wins over|supreme)/i,
      );
    }
  });

  it("roadmap keeps the two flagship journeys equal and shared", () => {
    const f = flat(roadmap);
    expect(f).toContain("MAKE THIS PC BETTER");
    expect(f).toContain("FIGURE OUT WHAT WENT WRONG");
    expect(f).toContain("same machine model, evidence, history, Trial system, rollback machinery");
  });

  it("PRODUCT.md gives the two constitutional journeys equal standing", () => {
    const f = flat(product);
    expect(f).toContain("make this PC better");
    expect(f).toContain("figure out what went wrong");
    expect(f).toContain("equal flagship journeys");
    expect(f).not.toMatch(/safety layer that happens to optimize/i);
  });

  it("pre-rebirth current-looking specs, plans, reviews, and decisions are explicitly bounded", () => {
    const paths = CURRENT_LOOKING_ROOTS.flatMap(collectMarkdown);
    const snapshot = Object.fromEntries(paths.map((path) => [path, read(path)]));
    const currentLooking = Object.entries(snapshot)
      .filter(([path]) => datedPathIsPreRebirth(path))
      .filter(([, body]) => CURRENT_AUTHORITY_SIGNAL.test(body.slice(0, 5000)))
      .map(([path]) => path)
      .sort();

    expect(currentLooking.length).toBeGreaterThanOrEqual(CURRENT_LOOKING_BASELINE.length);
    expect(currentLooking).toEqual(expect.arrayContaining(CURRENT_LOOKING_BASELINE));
    expect(findUnboundedCurrentLookingLegacyDocs(snapshot)).toEqual([]);
  });

  it("the current-looking legacy scan is armed (positive control)", () => {
    expect(
      findUnboundedCurrentLookingLegacyDocs({
        "docs/superpowers/specs/2026-08-01-spec.md": "# Plan\n\n**Status:** ACTIVE\n\nBegin implementing now.",
      }),
    ).toEqual(["docs/superpowers/specs/2026-08-01-spec.md"]);
  });

  // 2026-09-04 (#369): the active-authority audit found still-live routing files (skills,
  // agent seats, handoffs, PRODUCT.md, decisions) that named a tombstone as canonical. Grep-quieting
  // by deletion is banned, so the law is: a live routing file may mention a tombstone only in a
  // paragraph that also says it is history.
  it.each(legacyRoutingFiles)("%s cites tombstones only as history", (path) => {
    const paragraphs = read(path).split(/\r?\n\s*\r?\n/);
    const offenders = paragraphs.filter((p) => TOMBSTONE_NAME.test(p) && !RETIRED_WORD.test(p));
    expect(offenders, `${path} routes authority to a tombstone without marking it history`).toEqual([]);
  });

  it("no live routing file makes a tombstone canonical", () => {
    const dynamicAgentEntrypoints = [
      ...collectAgentEntrypoints(".claude/skills"),
      ...collectAgentEntrypoints(".claude/agents"),
      ...collectAgentEntrypoints(".codex/agents"),
    ];
    const paths = [...new Set([...legacyRoutingFiles, ...dynamicAgentEntrypoints])];

    for (const path of paths) {
      expect(read(path), `${path}`).not.toMatch(
        /(?:Receipts Doctrine|RECEIPTS_DOCTRINE\.md|PRODUCT_DIRECTION\.md|MONETIZATION_PLAN\.md)[^\n]{0,80}(?:wins over|is canonical|supreme)/i,
      );
      expect(read(path), `${path}`).not.toMatch(/Canonical(?: core)?: `docs\/RECEIPTS_DOCTRINE\.md`/);
    }
  });

  it("live routing cannot silently recommend a classified legacy directive", () => {
    const classified = CURRENT_LOOKING_ROOTS.flatMap(collectMarkdown)
      .filter((path) => datedPathIsPreRebirth(path) && manifestClassifies(path));
    const live = [...new Set([
      ...legacyRoutingFiles,
      ...collectAgentEntrypoints(".claude/skills"),
      ...collectAgentEntrypoints(".claude/agents"),
      ...collectAgentEntrypoints(".codex/agents"),
    ])];
    const offenders: string[] = [];

    for (const livePath of live) {
      const lines = read(livePath).split(/\r?\n/);
      lines.forEach((line, i) => {
        for (const legacyPath of classified) {
          const basename = legacyPath.split("/").pop() ?? legacyPath;
          if (!line.includes(legacyPath) && !line.includes(basename)) continue;
          const window = [lines[i - 1] ?? "", line, lines[i + 1] ?? ""].join(" ");
          if (!RETIRED_WORD.test(window)) offenders.push(`${livePath}:${i + 1} -> ${legacyPath}`);
        }
      });
    }

    expect(offenders, "live routing cited a classified pre-rebirth directive without disclosing its retired/historical status").toEqual([]);
  });

  it("the routing law is armed (positive control)", () => {
    const bad = "Read this first.\n\nCanonical: `docs/RECEIPTS_DOCTRINE.md` wins over everything.\n";
    const offenders = bad.split(/\r?\n\s*\r?\n/).filter((p) => TOMBSTONE_NAME.test(p) && !RETIRED_WORD.test(p));
    expect(offenders).toHaveLength(1);
  });

  it("CLAUDE bootstrap carries the constitutional product laws", () => {
    const f = flat(claude);
    expect(f).toContain("Compy optimizes outcomes, not settings.");
    expect(f).toContain("MAKE THIS PC BETTER");
    expect(f).toContain("FIGURE OUT WHAT WENT WRONG");
    expect(f).toContain("pre-rebirth strategy specs are historical evidence only");
    expect(f).not.toContain("Receipts Doctrine — canonical");
  });
});
