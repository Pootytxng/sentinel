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
const uiVisionBacklog = read("docs/UI_VISION_BACKLOG.md");

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
const uiEvidenceRoutingFiles = [
  "CLAUDE.md",
  "docs/SESSION_HANDOFF.md",
  "docs/OWNER_ACTION_CHECKLIST.md",
  ".claude/skills/status/SKILL.md",
  ".claude/skills/self-review/SKILL.md",
  ".claude/agents/self-reviewer.md",
];
const historicalExecutionFiles = [
  "docs/PARALLEL_WORKTREE_OPS.md",
  "docs/LANE_BUS.md",
  "docs/LANE_WORKFLOW.md",
];
const TOMBSTONE_NAME =
  /Receipts [Dd]octrine|RECEIPTS_DOCTRINE\.md|PRODUCT_DIRECTION\.md|(?<!product\/)MONETIZATION\.md|MONETIZATION_PLAN\.md|\bPRD\.md|COMPY_OVERVIEW\.md/;
const RETIRED_WORD = /tombstone|superseded|historical|history|retired|pre-rebirth|bounded provenance/i;
const TOMBSTONE_AUTHORITY_WORD =
  /canonical|source of truth|governs?|authoritative|wins over|supreme|follow[^\n]{0,40}for all product decisions/i;

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
const CURRENT_AUTHORITY_SIGNALS = [
  /\bStatus\b[^\n]{0,40}\b(?:ACTIVE|IN BUILD|GREEN[- ]?LIT|IMPLEMENTATION[- ]?READY)\b/i,
  /owner-approved direction|owner-requested program blueprint|begin implementing|PRIORITY OVERRIDE|implementation-ready plan/i,
  /product priority and completion remain in|PRODUCT_DIRECTION\.md sequence is authoritative/i,
  /PRODUCT_DIRECTION\.md.{0,300}(?:source of truth|asks of any new feature|trust them|authoritative)/i,
  /(?:source of truth|asks of any new feature|trust them|authoritative).{0,300}PRODUCT_DIRECTION\.md/i,
  /(?:RECEIPTS_DOCTRINE\.md|Receipts Doctrine).{0,300}(?:governs?|source of truth|trust them|canonical|law on every|priority|owner directive)/i,
  /(?:governs?|source of truth|trust them|canonical|law on every|priority|owner directive).{0,300}(?:RECEIPTS_DOCTRINE\.md|Receipts Doctrine)/i,
  /TOP-PRIORITY DIRECTIVE|owner-decided,\s*execute now|Implementation GREEN-LIT/i,
  /\bStatus\b.{0,80}QUEUED,\s*not started|work order.{0,160}SPORT MODE/i,
  /autonomous long-run,\s*owner GO|owner GO.{0,120}gate-override/i,
  /canonical,\s*compaction-proof copy|Owner-greenlit.{0,320}run them/i,
  /Each picked option becomes a scoped CC build task|\bStatus\b.{0,160}APPROVED.{0,200}build it all/i,
  /^# .*owner directive/im,
  /Decision record for.{0,240}owner directive/i,
  /Design source of truth|ENTRY GATE|owner's binding requirements/i,
  /UI_VISION_BACKLOG\.md.{0,160}STANDING DIRECTIVE|Directive verbatim.{0,160}UI_VISION_BACKLOG\.md/i,
  /\bStatus:\*\* (?:SPEC|DRAFT)[^\n]{0,160}(?:not built|NOT AUTHORIZED)|Implementation authorized:\s*build \+ push/i,
  /(?:source of truth|canonical|governing)[^\n]{0,140}(?:product|direction|roadmap|priority|build|launch|monetization|experience|ui)/i,
  /(?:product|direction|roadmap|priority|build|launch|monetization|experience|ui)[^\n]{0,140}(?:source of truth|canonical|governing)/i,
  /(?:follow|read|use|consult)[^\n]{0,100}(?:PRODUCT_DIRECTION\.md|RECEIPTS_DOCTRINE\.md|Receipts Doctrine|(?<!product\/)MONETIZATION\.md|\bPRD\.md)[^\n]{0,100}(?:product|direction|decision|priority|pricing|monetization)/i,
  /(?:canonical|authoritative|source of truth|governs?)[^\n]{0,100}(?:PRODUCT_DIRECTION\.md|RECEIPTS_DOCTRINE\.md|Receipts Doctrine|(?<!product\/)MONETIZATION\.md|\bPRD\.md)/i,
];
const SUPERSESSION_BANNER =
  /(?:POLICY AND )?PRODUCT DIRECTION SUPERSEDED|PRODUCT[- ]DIRECTION AUTHORITY RETIRED|HISTORICAL UI EVIDENCE[^\n]{0,80}NOT CURRENT PRODUCT AUTHORITY/i;

const EXPECTED_CURRENT_LOOKING = [
  "docs/decisions/2026-08-09-capability-exception-gate.md",
  "docs/decisions/2026-08-18-canonical-data-root.md",
  "docs/decisions/2026-08-18-outbound-capability-expansion.md",
  "docs/reviews/2026-07-15-cc-brief-panel-review-execution.md",
  "docs/reviews/2026-07-15-consumer-panel-review.md",
  "docs/reviews/2026-07-16-owner-directive-intelligence-platform.md",
  "docs/reviews/2026-08-23-codex-four-room-review-brief.md",
  "docs/superpowers/plans/2026-06-02-gaming-mode-f1.md",
  "docs/superpowers/plans/2026-06-04-beta-build-order.md",
  "docs/superpowers/plans/2026-07-09-console-hud-phase1-lab.md",
  "docs/superpowers/plans/2026-07-09-lab-instrument-bench-p1.md",
  "docs/superpowers/plans/2026-07-10-console-hud-phase2-home.md",
  "docs/superpowers/plans/2026-07-10-console-hud-phase3-monitor.md",
  "docs/superpowers/plans/2026-07-10-monitor-v3-ribbon.md",
  "docs/superpowers/plans/2026-07-10-monitor-v4-session-waterfall.md",
  "docs/superpowers/plans/2026-07-11-consumer-panel-overhaul.md",
  "docs/superpowers/plans/2026-07-11-monitor-v5-deck-stack.md",
  "docs/superpowers/plans/2026-07-12-console-hud-phase4-blackbook.md",
  "docs/superpowers/plans/2026-07-30-single-entry-workflow.md",
  "docs/superpowers/plans/2026-08-09-capability-exception-policy-rails.md",
  "docs/superpowers/plans/2026-08-20-comprehensibility-sweep.md",
  "docs/superpowers/specs/2026-06-01-experience-design-system-pass-design.md",
  "docs/superpowers/specs/2026-06-02-gaming-mode-f1-design.md",
  "docs/superpowers/specs/2026-06-05-compy-design-system.md",
  "docs/superpowers/specs/2026-06-05-fix-surface.md",
  "docs/superpowers/specs/2026-06-05-knowledge-layer-chapter.md",
  "docs/superpowers/specs/2026-06-05-knowledge-layer-notes.md",
  "docs/superpowers/specs/2026-06-06-shadow-realm-doctrine.md",
  "docs/superpowers/specs/2026-06-08-tuning-guides-stability-measurement.md",
  "docs/superpowers/specs/2026-06-12-doctrine-voice-baptism-design-refresh.md",
  "docs/superpowers/specs/2026-06-12-monetization-transformation-plan.md",
  "docs/superpowers/specs/2026-06-12-R5-unattended-marathon.md",
  "docs/superpowers/specs/2026-06-12-receipts-marathon-R3.md",
  "docs/superpowers/specs/2026-06-12-waitlist-wiring.md",
  "docs/superpowers/specs/2026-06-15-monetization-model-proposal.md",
  "docs/superpowers/specs/2026-06-20-intuitiveness-sweep.md",
  "docs/superpowers/specs/2026-06-21-optimize-merge-design.md",
  "docs/superpowers/specs/2026-06-24-council-staged-1.0-hygiene.md",
  "docs/superpowers/specs/2026-07-01-token-routing-protocol.md",
  "docs/superpowers/specs/2026-07-02-design-direction-product-ui-system.md",
  "docs/superpowers/specs/2026-07-02-external-audit-2-council.md",
  "docs/superpowers/specs/2026-07-02-full-tidy-directive.md",
  "docs/superpowers/specs/2026-07-02-owner-vision-directive.md",
  "docs/superpowers/specs/2026-07-05-lab-bento-checkup.md",
  "docs/superpowers/specs/2026-07-05-lab-linear-guided-bench.md",
  "docs/superpowers/specs/2026-07-05-ui-deslop-organic-directive.md",
  "docs/superpowers/specs/2026-07-06-design-rnd-options.md",
  "docs/superpowers/specs/2026-07-06-firstcheck-monitor-mvp-train.md",
  "docs/superpowers/specs/2026-07-08-lab-proving-ground.md",
  "docs/superpowers/specs/2026-07-09-compy-console-hud-direction.md",
  "docs/superpowers/specs/2026-07-09-lab-redesign-COURSE-CORRECTION.md",
  "docs/superpowers/specs/2026-07-14-site-makeover-research-spitball.md",
  "docs/superpowers/specs/2026-07-16-intelligence-foundation-train1.md",
  "docs/superpowers/specs/2026-07-17-intelligence-phase2-train2.md",
  "docs/superpowers/specs/2026-07-17-intelligence-phase3-experiment-engine.md",
  "docs/superpowers/specs/2026-07-29-product-quality-stabilization-program.md",
  "docs/superpowers/specs/2026-07-30-single-entry-workflow.md",
  "docs/superpowers/specs/2026-08-09-compy-care-capability-exception-gate.md",
  "docs/superpowers/specs/2026-08-21-test-rig-reading-set.md",
];

function hasCurrentAuthoritySignal(body: string): boolean {
  const searchable = flat(body);
  return CURRENT_AUTHORITY_SIGNALS.some((pattern) => pattern.test(searchable));
}

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
  const match = path.match(/(?:^|\/)[^/]*(20\d\d-\d\d-\d\d)[^/]*\.md$/);
  return Boolean(match && match[1] < PRE_REBIRTH_CUTOFF);
}

function manifestClassifies(path: string, manifest = supersessionManifest): boolean {
  // Only these sections assign dispositions. Mentions elsewhere cannot classify a document.
  const tableSections = new Set([
    "Explicitly superseded product-direction sources",
    "Current-looking mixed sources explicitly bounded by this migration",
  ]);
  let section = "";
  let classifiedTable = false;
  for (const line of manifest.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      section = heading[1];
      classifiedTable = false;
      continue;
    }
    if (section === "Semantic authority-audit corpus" && line.trim() === "- `" + path + "`") {
      return true;
    }
    if (!tableSections.has(section)) continue;
    const cells = line.trim().split("|").slice(1, -1).map((cell) => cell.trim());
    if (!line.trim().startsWith("|") || !line.trim().endsWith("|")) {
      if (line.trim()) classifiedTable = false;
      continue;
    }
    if (cells.join("|") === "Pre-rebirth source|Former role|Rebirth disposition" ||
        cells.join("|") === "Source|Retained value|Superseded authority") {
      classifiedTable = true;
      continue;
    }
    if (classifiedTable && cells.length === 3 && cells[0] === "`" + path + "`" &&
        cells.slice(1).every((cell) => cell.length > 0 && !/^[-:]+$/.test(cell))) return true;
  }
  return false;
}

function hasTopLevelConstitutionBoundary(body: string): boolean {
  const top = body.slice(0, 2400);
  return SUPERSESSION_BANNER.test(top) && top.includes("docs/PRODUCT_CONSTITUTION.md");
}

export function findUnboundedCurrentLookingLegacyDocs(snapshot: Record<string, string>): string[] {
  return Object.entries(snapshot)
    .filter(([path]) => datedPathIsPreRebirth(path))
    .filter(([, body]) => hasCurrentAuthoritySignal(body))
    .filter(([path, body]) => !hasTopLevelConstitutionBoundary(body) && !manifestClassifies(path))
    .map(([path]) => path)
    .sort();
}

export function findUndisclosedClassifiedDirectiveCitations(
  liveSnapshot: Record<string, string>,
  classifiedPaths: string[],
): string[] {
  const offenders: string[] = [];
  for (const [livePath, body] of Object.entries(liveSnapshot)) {
    const lines = body.split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const legacyPath of classifiedPaths) {
        const basename = legacyPath.split("/").pop() ?? legacyPath;
        if (!line.includes(legacyPath) && !line.includes(basename)) continue;
        const window = [lines[i - 1] ?? "", line, lines[i + 1] ?? ""].join(" ");
        if (!RETIRED_WORD.test(window)) offenders.push(`${livePath}:${i + 1} -> ${legacyPath}`);
      }
    });
  }
  return offenders;
}

describe("structured manifest classification (#379)", () => {
  const path = "docs/superpowers/specs/2026-07-16-intelligence-foundation-train1.md";
  const table = "## Current-looking mixed sources explicitly bounded by this migration\n\n" +
    "| Source | Retained value | Superseded authority |\n|---|---|---|\n";
  const row = "| `" + path + "` | implementation evidence | historical execution direction |";

  it.each([
    "TODO: `" + path + "` has not been classified.",
    "## Notes\n- `" + path + "`",
    table + "| `" + path + "` | evidence | |",
    table + "| prefix `" + path + "` | evidence | historical direction |",
    "## Unrelated table\n| Source | Retained value | Superseded authority |\n|---|---|---|\n" + row,
    "## Semantic authority-audit corpus\n- `" + path + "` remains unclassified",
    "## Semantic authority-audit corpus\n### Pending\n- `" + path + "`",
  ])("does not classify from incidental or incomplete text: %s", (manifest) => {
    expect(manifestClassifies(path, manifest)).toBe(false);
  });

  it("accepts an exact classified row and the bounded historical corpus list", () => {
    expect(manifestClassifies(path, table + row)).toBe(true);
    expect(manifestClassifies(path, "### Semantic authority-audit corpus\n\n- `" + path + "`\n")).toBe(true);
    expect(manifestClassifies(path + ".other", table + row)).toBe(false);
  });
});

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

  it.each([
    ["CLAUDE.md", claude],
    ["AGENTS.md", agents],
    ["README.md", rootReadme],
  ])("%s carries the same constitutional product entry", (name, body) => {
    const f = flat(body);
    expect(f, name).toContain("Compy optimizes outcomes, not settings.");
    expect(f, name).toContain("MAKE THIS PC BETTER");
    expect(f, name).toContain("FIGURE OUT WHAT WENT WRONG");
    expect(f, name).toMatch(/historical evidence only|pre-rebirth strategy specs are historical evidence only/i);
  });

  it("the docs index cannot route a human around the Constitution", () => {
    expect(docsReadme).toContain("supreme product authority");
    expect(docsReadme).toContain("PRODUCT_CONSTITUTION.md");
    expect(docsReadme).toContain("Care primary / optimization secondary");
    expect(docsReadme).toContain("superseded product thesis");
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

  it("the legacy UI vision ledger is evidence, not a second product authority", () => {
    const top = uiVisionBacklog.slice(0, 1800);
    expect(top).toContain("HISTORICAL UI EVIDENCE");
    expect(top).toContain("NOT CURRENT PRODUCT AUTHORITY");
    expect(top).toContain("PRODUCT_CONSTITUTION.md");
    expect(top).toContain("product/ROADMAP.md");
  });

  it.each(uiEvidenceRoutingFiles)("%s routes UI evidence through the Constitution", (path) => {
    const body = read(path);
    expect(body).toContain("UI_VISION_BACKLOG.md");
    expect(body).toContain("PRODUCT_CONSTITUTION.md");
    expect(body).toMatch(/historical|evidence/i);
    expect(body).not.toMatch(
      /UI_VISION_BACKLOG\.md[^\n]{0,100}(?:is |— the )?(?:authoritative|canonical|ONE home)/i,
    );
  });

  it.each(historicalExecutionFiles)("%s cannot compete with Work Control", (path) => {
    const top = read(path).slice(0, 1800);
    expect(top).toMatch(/SUPERSEDED|HISTORICAL ONLY/);
    expect(top).toContain("WORK_CONTROL.md");
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
      const offenders = body
        .split(/\r?\n\s*\r?\n/)
        .filter((paragraph) => TOMBSTONE_NAME.test(paragraph) && TOMBSTONE_AUTHORITY_WORD.test(paragraph) && !RETIRED_WORD.test(paragraph));
      expect(offenders, `${path} restored tombstone authority`).toEqual([]);
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
      .filter(([, body]) => hasCurrentAuthoritySignal(body))
      .map(([path]) => path)
      .sort();

    expect(currentLooking).toEqual([...EXPECTED_CURRENT_LOOKING].sort());
    expect(findUnboundedCurrentLookingLegacyDocs(snapshot)).toEqual([]);
  });

  it("the current-looking legacy scan is armed (positive control)", () => {
    expect(
      findUnboundedCurrentLookingLegacyDocs({
        "docs/superpowers/specs/2026-08-01-spec.md": "# Plan\n\n**Status:** ACTIVE\n\nBegin implementing now.",
      }),
    ).toEqual(["docs/superpowers/specs/2026-08-01-spec.md"]);
    expect(
      findUnboundedCurrentLookingLegacyDocs({
        "docs/superpowers/specs/2026-08-02-late.md":
          "# Old spec\n\n" + "Historical detail.\n\n".repeat(900) +
          "## Authority\n`docs/RECEIPTS_DOCTRINE.md` governs every new product decision.",
      }),
    ).toEqual(["docs/superpowers/specs/2026-08-02-late.md"]);
    expect(
      findUnboundedCurrentLookingLegacyDocs({
        "docs/superpowers/specs/legacy-2026-08-03.md":
          "# Legacy\n\nFollow `docs/PRODUCT_DIRECTION.md` for all product decisions.",
      }),
    ).toEqual(["docs/superpowers/specs/legacy-2026-08-03.md"]);
  });

  it("dynamically checks skills and agent entrypoints for undisclosed tombstone routing", () => {
    const paths = [".claude/skills", ".claude/agents", ".codex/agents"]
      .flatMap(collectMarkdown)
      .concat(legacyRoutingFiles);
    const offenders = [...new Set(paths)].flatMap((path) =>
      read(path)
        .split(/\r?\n\s*\r?\n/)
        .filter((paragraph) => TOMBSTONE_NAME.test(paragraph) && !RETIRED_WORD.test(paragraph))
        .map(() => path),
    );
    expect(offenders).toEqual([]);
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
    const paths = [...new Set([
      ...activeAuthorityFiles.map(([path]) => path),
      ...legacyRoutingFiles,
      ...dynamicAgentEntrypoints,
    ])];
    for (const path of paths) {
      const offenders = read(path)
        .split(/\r?\n\s*\r?\n/)
        .filter((paragraph) => TOMBSTONE_NAME.test(paragraph) && TOMBSTONE_AUTHORITY_WORD.test(paragraph) && !RETIRED_WORD.test(paragraph));
      expect(offenders, `${path} routes authority to a tombstone`).toEqual([]);
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
    const snapshot = Object.fromEntries(live.map((path) => [path, read(path)]));
    const offenders = findUndisclosedClassifiedDirectiveCitations(snapshot, classified);

    expect(offenders, "live routing cited a classified pre-rebirth directive without disclosing its retired/historical status").toEqual([]);
  });

  it("the classified-directive routing scan stays armed even behind a valid top-level boundary", () => {
    const legacyPath = "docs/superpowers/specs/2026-08-01-old-direction.md";
    const body = [
      "# Mixed record",
      "> **PRODUCT DIRECTION SUPERSEDED.** Current authority: `docs/PRODUCT_CONSTITUTION.md`.",
      "",
      "Historical evidence follows.",
      "",
      `Use \`${legacyPath}\` as the canonical build direction.`,
    ].join("\n");
    expect(findUndisclosedClassifiedDirectiveCitations({ "docs/bannered.md": body }, [legacyPath])).toEqual([
      `docs/bannered.md:6 -> ${legacyPath}`,
    ]);
  });

  it("the routing law is armed (positive control)", () => {
    const bad = [
      "Canonical: `docs/RECEIPTS_DOCTRINE.md` wins over everything.",
      "Canonical authority: Receipts Doctrine.",
      "Follow `docs/PRODUCT_DIRECTION.md` for all product decisions.",
      "The PRD.md is the product source of truth.",
      "`docs/MONETIZATION.md` is canonical for current pricing.",
      "MONETIZATION.md is canonical for current pricing.",
    ];
    for (const paragraph of bad) {
      expect(TOMBSTONE_NAME.test(paragraph), paragraph).toBe(true);
      expect(TOMBSTONE_AUTHORITY_WORD.test(paragraph), paragraph).toBe(true);
      expect(RETIRED_WORD.test(paragraph), paragraph).toBe(false);
    }
    expect(TOMBSTONE_NAME.test("Current authority: docs/product/MONETIZATION.md")).toBe(false);
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
