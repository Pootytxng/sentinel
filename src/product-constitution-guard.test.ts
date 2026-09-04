import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";

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

const legacyTombstones = [
  "docs/RECEIPTS_DOCTRINE.md",
  "docs/PRODUCT_DIRECTION.md",
  "docs/PRD.md",
  "docs/MONETIZATION.md",
  "docs/MONETIZATION_PLAN.md",
  "COMPY_OVERVIEW.md",
];

const activeAuthorityFiles: [string, string][] = [
  ["CLAUDE.md", claude],
  ["AGENTS.md", agents],
  ["README.md", rootReadme],
  ["docs/README.md", docsReadme],
  ["docs/ARCHITECTURE_LOCKS.md", locks],
  ["docs/BACKLOG.md", backlog],
  ["docs/product/ROADMAP.md", roadmap],
];

describe("Compy product constitution authority", () => {
  it("contains the ratified north-star laws", () => {
    const f = flat(constitution);
    expect(f).toContain(
      "The user chooses the destination. Compy handles the technical route, proves the result, explains the tradeoffs, and never hides the way back.",
    );
    expect(f).toContain("Compy optimizes outcomes, not settings.");
    expect(f).toContain("MAKE THIS PC BETTER.");
    expect(f).toContain("FIGURE OUT WHAT WENT WRONG.");
    expect(f).toContain("The fundamental unit of optimization is not a tweak. It is a Trial.");
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

  it.each(legacyTombstones)("%s is mechanically marked superseded/historical", (path) => {
    const body = read(path);
    expect(body).toMatch(/SUPERSEDED|HISTORICAL ONLY|HISTORICAL SNAPSHOT ONLY/);
    expect(body).toContain("PRODUCT_CONSTITUTION.md");
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

  it("CLAUDE bootstrap carries the constitutional product laws", () => {
    const f = flat(claude);
    expect(f).toContain("Compy optimizes outcomes, not settings.");
    expect(f).toContain("MAKE THIS PC BETTER");
    expect(f).toContain("FIGURE OUT WHAT WENT WRONG");
    expect(f).not.toContain("Receipts Doctrine — canonical");
  });
});
