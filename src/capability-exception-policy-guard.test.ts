import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

// Capability Exception policy coherence guard (2026-08-09).
//
// The policy is deliberately split by responsibility: standing law, current runtime truth, privacy,
// product direction, queue, decision/spec, and executable plans. That makes contradiction the primary
// failure mode. This guard reads an explicit operative corpus, never docs/archive/**; the historical
// Gate Decisions file is included only to pin its supersession banner. The pure auditor lets unsafe
// policy mutations be proved to fail without editing files.

export const LIVE_POLICY_PATHS = [
  "CLAUDE.md",
  "AGENTS.md",
  "COMPY_OVERVIEW.md",
  ".claude/skills/INDEX.md",
  "docs/ARCHITECTURE_LOCKS.md",
  "docs/RECEIPTS_DOCTRINE.md",
  "docs/PRODUCT_DIRECTION.md",
  "docs/PRIVACY.md",
  "docs/RELEASE_STATE.md",
  "docs/BACKLOG.md",
  "docs/GATE_DECISIONS.md",
  "docs/decisions/2026-08-09-capability-exception-gate.md",
  "docs/superpowers/specs/2026-08-09-compy-care-capability-exception-gate.md",
  "docs/superpowers/plans/2026-08-09-capability-exception-policy-rails.md",
  "docs/superpowers/plans/2026-08-09-outbound-case-intelligence-tier1.md",
] as const;

const FORBIDDEN_POLICY_PATHS = [
  "CLAUDE.md",
  "AGENTS.md",
  "COMPY_OVERVIEW.md",
  "docs/ARCHITECTURE_LOCKS.md",
  "docs/RECEIPTS_DOCTRINE.md",
  "docs/PRODUCT_DIRECTION.md",
  "docs/PRIVACY.md",
  "docs/RELEASE_STATE.md",
  "docs/BACKLOG.md",
  "docs/decisions/2026-08-09-capability-exception-gate.md",
  "docs/superpowers/specs/2026-08-09-compy-care-capability-exception-gate.md",
] as const;

export type PolicySnapshot = Record<string, string>;

const REQUIRED: Record<string, string[]> = {
  "CLAUDE.md": [
    "capability exception gate (owner decision 2026-08-09)",
    "current build ships no driver",
    "no longer categorically forbidden",
    "no third-party game/process injection. this remains absolute",
    "tier 1 signed advisory download / no machine-data upload",
    "tier 2 opt-in scrubbed incident fingerprint",
    "tier 3 explicit per-case evidence upload",
    "signed remote rules — triple-gated off",
  ],
  "AGENTS.md": [
    "capability exception gate; no third-party game/process injection",
    "policy-possible only through the named gate",
    "none ships today",
    "issue #91 authorizes tier 1 design + dark implementation",
  ],
  "COMPY_OVERVIEW.md": [
    "last reconciled: 2026-08-09",
    "current build ships no kernel driver",
    "a future compy driver would need its own capability exception gate record",
    "game/process injection remains prohibited",
    "no case-intelligence endpoint or upload exists today",
  ],
  ".claude/skills/INDEX.md": [
    "the signed updater is already live",
    "receipts is a tier 2 precursor and must not inherit updater or tier 1 approval",
  ],
  "docs/ARCHITECTURE_LOCKS.md": [
    "capability exception gate + outbound case intelligence",
    "no third-party game/process injection",
    "a compy driver is policy-possible",
    "current runtime remains driver-free",
    "no machine-derived incident payload",
    "tier 1 does not authorize tier 2 or 3",
    "tier 1's initial kill switch is local and deny-only",
    "any remotely delivered disable signal is a new inbound trust surface",
    "it may disable only, never enable or configure",
    "it cannot travel inside the advisory catalog",
    "case_source_origins",
    "it cannot add an origin",
    "opening a source is an explicit user click into the system browser",
  ],
  "docs/RECEIPTS_DOCTRINE.md": [
    "capability exception gate",
    "no third-party game/process injection",
    "a compy driver is exception-gated",
    "none ships today",
    "tier 1/2/3 boundaries",
  ],
  "docs/PRODUCT_DIRECTION.md": [
    "capability exception gate",
    "no third-party game/process injection",
    "current build ships no compy driver",
    "tier 1 signed advisory download/no machine upload",
    "tier 2 opt-in scrubbed fingerprint",
    "tier 3 explicit per-case evidence upload",
  ],
  "docs/PRIVACY.md": [
    "this policy describes current runtime behavior",
    "capability exception gate outbound tier",
    "no module, endpoint or traffic today",
    "tier 1 cannot authorize tier 2 or 3",
  ],
  "docs/RELEASE_STATE.md": [
    "owner-approved direction; not built / no runtime traffic",
    "no machine-derived upload",
    "one surface: signed update check/download",
    "current runtime ships no compy driver and performs no game/process injection",
    "requires the capability exception gate",
  ],
  "docs/BACKLOG.md": [
    "compy care: primary pc-doctor directive + capability exception gate",
    "zero machine-derived upload",
    "tier 2 — not authorized by tier 1",
    "tier 3 — not authorized by tier 1",
    "a compy driver is policy-possible only through",
    "game/process injection remain barred",
    "a compact care entry is always visible on home",
  ],
  "docs/GATE_DECISIONS.md": [
    "historical process snapshot (2026-06-27) — not current gate state",
    "docs/release_state.md for current runtime truth",
    "capability exception gate",
  ],
  "docs/decisions/2026-08-09-capability-exception-gate.md": [
    "capability exception gate + outbound case intelligence",
    "upload no machine-derived incident data",
    "tier 1 is approved for dark implementation",
    "it is not permission to arm an unspecified endpoint, to build tier 2/3",
    "no longer categorically forbidden",
    "no driver is approved or needed for tier 1",
    "third-party game/process injection remain prohibited",
    "case intelligence has no module, endpoint, cache or runtime traffic",
    "the initial kill switch is local and deny-only",
    "case_source_origins",
    "the catalog cannot add an origin",
    "may disable only",
    "cannot ride inside the catalog",
  ],
  "docs/superpowers/specs/2026-08-09-compy-care-capability-exception-gate.md": [
    "capability exception gate",
    "case_source_origins",
    "changes only through an app release",
    "the catalog cannot extend the list",
    "first tier 1 kill switch is local and deny-only",
    "may disable only and cannot be carried in the catalog",
    "there is no proven notification action/click callback contract",
    "the persisted home card is the authoritative route",
  ],
  "docs/superpowers/plans/2026-08-09-capability-exception-policy-rails.md": [
    "seeded src/capability-exception-policy-guard.test.ts",
    "remote disable is a separate signed/gated trust surface",
    "catalog content cannot add transport origins",
  ],
  "docs/superpowers/plans/2026-08-09-outbound-case-intelligence-tier1.md": [
    "const case_source_origins",
    "changed only through an app release",
    "initial kill switch is local and deny-only",
    "do not add a remote kill switch in tier 1",
    "the persisted pending state is authoritative",
    "no supported action/click callback carrying an incident payload",
  ],
};

function normalize(value: string): string {
  return value
    .replace(/[\u0060*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function clone(snapshot: PolicySnapshot): PolicySnapshot {
  return { ...snapshot };
}

export function auditCapabilityExceptionPolicy(snapshot: PolicySnapshot): string[] {
  const issues: string[] = [];

  for (const path of LIVE_POLICY_PATHS) {
    const source = snapshot[path];
    if (typeof source !== "string") {
      issues.push(`missing live policy file: ${path}`);
      continue;
    }

    const flat = normalize(source);
    for (const marker of REQUIRED[path] ?? []) {
      if (!flat.includes(normalize(marker))) {
        issues.push(`${path}: missing policy marker: ${marker}`);
      }
    }
  }

  // Executable plans describe the positive-control phrases they must reject, so scan blanket
  // permissions only in operative policy/current-state sources, not the test plan prose.
  const corpus = normalize(
    FORBIDDEN_POLICY_PATHS.map((path) => snapshot[path] ?? "").join("\n"),
  );

  const forbidden: Array<[RegExp, string]> = [
    [/(?:any|all) (?:kernel )?(?:driver|drivers|network|outbound capabilities?).{0,30}(?:is|are) (?:allowed|approved|unlocked)/i,
      "blanket driver/network permission"],
    [/tier 1 authorizes tier 2(?: and tier 3| and 3)?/i,
      "Tier 1 authorizes Tier 2"],
    [/tier 1 authorizes tier 3/i,
      "Tier 1 authorizes Tier 3"],
    [/tier 1.{0,50}(?:uploads|sends).{0,35}(?:machine|incident|evidence)/i,
      "Tier 1 machine-derived upload"],
    [/(?:remote )?kill switch.{0,45}(?:can|may)\s+(?:enable|configure)/i,
      "remote kill switch can enable/configure"],
    [/catalog (?:may|can) add an origin/i,
      "catalog-supplied transport origin"],
  ];

  for (const [pattern, label] of forbidden) {
    if (pattern.test(corpus)) issues.push(`forbidden policy: ${label}`);
  }

  return issues;
}

const liveSnapshot: PolicySnapshot = Object.fromEntries(
  LIVE_POLICY_PATHS.map((path) => [path, readFileSync(path, "utf8")]),
);

describe("Capability Exception policy coherence", () => {
  it("keeps every applicable live mirror aligned", () => {
    expect(LIVE_POLICY_PATHS.some((path) => path.startsWith("docs/archive/"))).toBe(false);
    expect(auditCapabilityExceptionPolicy(liveSnapshot)).toEqual([]);
  });

  it("rejects a blanket driver/network unlock", () => {
    const snapshot = clone(liveSnapshot);
    snapshot["CLAUDE.md"] += "\nAny driver/network is allowed.";
    expect(auditCapabilityExceptionPolicy(snapshot)).toContain(
      "forbidden policy: blanket driver/network permission",
    );
  });

  it("rejects removal of the game/process injection ban", () => {
    const snapshot = clone(liveSnapshot);
    snapshot["CLAUDE.md"] = snapshot["CLAUDE.md"].replace(
      "No third-party game/process injection.",
      "Injection policy removed.",
    );
    expect(auditCapabilityExceptionPolicy(snapshot)).toContain(
      "CLAUDE.md: missing policy marker: no third-party game/process injection. this remains absolute",
    );
  });

  it("rejects Tier 1 machine-derived upload", () => {
    const snapshot = clone(liveSnapshot);
    snapshot["docs/ARCHITECTURE_LOCKS.md"] = snapshot[
      "docs/ARCHITECTURE_LOCKS.md"
    ].replace(
      "**no machine-derived incident payload**",
      "**Tier 1 uploads machine-derived incident evidence**",
    );
    const issues = auditCapabilityExceptionPolicy(snapshot);
    expect(issues).toContain(
      "docs/ARCHITECTURE_LOCKS.md: missing policy marker: no machine-derived incident payload",
    );
    expect(issues).toContain("forbidden policy: Tier 1 machine-derived upload");
  });

  it("rejects consent inheritance across outbound tiers", () => {
    const snapshot = clone(liveSnapshot);
    snapshot["docs/BACKLOG.md"] += "\nTier 1 authorizes Tier 2 and Tier 3.";
    expect(auditCapabilityExceptionPolicy(snapshot)).toContain(
      "forbidden policy: Tier 1 authorizes Tier 2",
    );
  });

  it("rejects a false current-runtime claim", () => {
    const snapshot = clone(liveSnapshot);
    snapshot["docs/RELEASE_STATE.md"] = snapshot["docs/RELEASE_STATE.md"].replace(
      "OWNER-APPROVED DIRECTION; NOT BUILT / NO RUNTIME TRAFFIC",
      "LIVE / RUNTIME TRAFFIC ENABLED",
    );
    expect(auditCapabilityExceptionPolicy(snapshot)).toContain(
      "docs/RELEASE_STATE.md: missing policy marker: owner-approved direction; not built / no runtime traffic",
    );
  });

  it("rejects a remote switch that can enable or configure", () => {
    const snapshot = clone(liveSnapshot);
    snapshot["docs/ARCHITECTURE_LOCKS.md"] +=
      "\nRemote kill switch can enable or configure case intelligence.";
    expect(auditCapabilityExceptionPolicy(snapshot)).toContain(
      "forbidden policy: remote kill switch can enable/configure",
    );
  });

  it("rejects catalog-supplied transport origins", () => {
    const snapshot = clone(liveSnapshot);
    snapshot["docs/ARCHITECTURE_LOCKS.md"] += "\nCatalog may add an origin.";
    expect(auditCapabilityExceptionPolicy(snapshot)).toContain(
      "forbidden policy: catalog-supplied transport origin",
    );
  });
});
