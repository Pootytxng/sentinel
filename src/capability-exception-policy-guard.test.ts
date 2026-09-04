import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// Capability Exception policy coherence guard (2026-08-09).
//
// The policy is deliberately split by responsibility: standing law, current runtime truth, privacy,
// product direction, queue, decision/spec, and executable plans. That makes contradiction the primary
// failure mode. This guard reads an explicit operative corpus, never docs/archive/**; the historical
// Gate Decisions file is included only to pin its supersession banner. The pure auditor lets unsafe
// policy mutations be proved to fail without editing files.
//
// AMENDED 2026-09-04 (#369, constitutional migration). COMPY_OVERVIEW.md, RECEIPTS_DOCTRINE.md and
// PRODUCT_DIRECTION.md became tombstones and BACKLOG.md became an execution ledger, so none of them
// may carry policy any more; their mirrors moved to CLAUDE.md, AGENTS.md and ARCHITECTURE_LOCKS.md
// §1.8, and the Product Constitution is pinned to its own deferral to the Locks. The tombstones stay
// in the FORBIDDEN scan: a superseded file must not quietly re-assert a blanket permission either.

export const LIVE_POLICY_PATHS = [
  "CLAUDE.md",
  "AGENTS.md",
  ".claude/skills/INDEX.md",
  "docs/PRODUCT_CONSTITUTION.md",
  "docs/ARCHITECTURE_LOCKS.md",
  "docs/PRIVACY.md",
  "docs/RELEASE_STATE.md",
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
  "docs/PRODUCT_CONSTITUTION.md",
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
    "tier 2 scrubbed incident fingerprint",
    // AMENDED 2026-08-25 (Q9a, #217). This used to pin the 2026-08-18 §2 amendment's "on by default
    // once armed". The owner OVERRULED that six days later — 2026-08-24, issue #207,
    // `docs/RECEIPTS_DOCTRINE.md` §2 and §4 — because the shipped app description and the public
    // download page already promise "No telemetry", and a claim already published to users outranks
    // a later internal amendment. COMPY_OVERVIEW.md carried the ruling; CLAUDE.md,
    // ARCHITECTURE_LOCKS.md, PRODUCT_DIRECTION.md, BACKLOG.md and this guard did not — so the guard
    // was pinning text its own owner had retired. Still pinned in BOTH directions: the two
    // guarantees that ride alongside the default (first-run disclosure, real off switch) are named
    // here, not dropped, and `no policy doc re-asserts the retired default-ON wording` below stops
    // the amendment creeping back in unmarked.
    "opt-in, default off and it stays off after arming, disclosed at first run, with a real off switch",
    "tier 3 explicit per-case evidence upload",
    "signed remote rules — triple-gated off",
  ],
  "AGENTS.md": [
    "capability exception gate; no third-party game/process injection",
    "policy-possible only through the named gate",
    "none ships today",
    "issue #91 authorizes tier 1 design + dark implementation",
  ],
  ".claude/skills/INDEX.md": [
    "the signed updater is already live",
    "receipts is a tier 2 precursor and must not inherit updater or tier 1 approval",
  ],
  "docs/PRODUCT_CONSTITUTION.md": [
    "this constitution does not override architecture_locks.md on safety/security/immutability",
    "safety/architecture truth — docs/architecture_locks.md",
  ],
  "docs/ARCHITECTURE_LOCKS.md": [
    "capability exception gate + outbound case intelligence",
    "no third-party game/process injection",
    "a compy driver is policy-possible",
    "current runtime remains driver-free",
    "no machine-derived incident payload",
    // See the CLAUDE.md note above — overruled 2026-08-24 (#207).
    "opt-in, default off and it stays off after arming, disclosed at first run, real off switch, previewable",
    "tier 1 does not authorize tier 2 or 3",
    "tier 1's initial kill switch is local and deny-only",
    "any remotely delivered disable signal is a new inbound trust surface",
    "it may disable only, never enable or configure",
    "it cannot travel inside the advisory catalog",
    "case_source_origins",
    "it cannot add an origin",
    "opening a source is an explicit user click into the system browser",
  ],
  "docs/PRIVACY.md": [
    "this policy describes current runtime behavior",
    "capability exception gate outbound tier",
    // AMENDED 2026-08-25 (#220), same reason as the RELEASE_STATE row below: the module now
    // exists, so "no module" was a false statement in a PRIVACY policy of all places. What a
    // reader is owed is the reachability claim, which is unchanged and now names all three locks.
    "no endpoint, no key and no traffic today",
    "tier 1 cannot authorize tier 2 or 3",
  ],
  "docs/RELEASE_STATE.md": [
    // AMENDED 2026-08-25 (#220). This pinned "OWNER-APPROVED DIRECTION; NOT BUILT / NO RUNTIME
    // TRAFFIC". The Tier 1 module was built dark that day, so half of that phrase became false and
    // a guard that forces a doc to keep saying it would be forcing a lie. The load-bearing half is
    // the RUNTIME half — this row exists so RELEASE_STATE can never quietly claim outbound Tier 1
    // is live — and that is what stays pinned. "Built" is a source fact; "armed" is the gate fact,
    // and only the second one is a promise to users.
    "no runtime traffic, nothing armed",
    "no machine-derived upload",
    "one surface: signed update check/download",
    "current runtime ships no compy driver and performs no game/process injection",
    "requires the capability exception gate",
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

// The greppable line-level escape hatch a doc uses to QUOTE a retired claim without re-asserting it
// (ARCHITECTURE_LOCKS.md §1.8's Tier 2 row cites the superseded default this way).
const RETIRED_CLAIM_ALLOW = "retired-claim-allow";
const RETIRED_DEFAULT_ON = /on by default once armed/i;

// Raw text, not stripped of comments: a comment re-asserting a superseded default misleads the next
// reader exactly as body copy does.
export function findRetiredDefaultAssertions(snapshot: PolicySnapshot): string[] {
  const offenders: string[] = [];
  for (const [path, text] of Object.entries(snapshot)) {
    text.split(/\r?\n/).forEach((line, i) => {
      if (RETIRED_DEFAULT_ON.test(line) && !line.includes(RETIRED_CLAIM_ALLOW)) {
        offenders.push(`${path}:${i + 1}`);
      }
    });
  }
  return offenders;
}

describe("Capability Exception policy coherence", () => {
  it("keeps every applicable live mirror aligned", () => {
    expect(LIVE_POLICY_PATHS.some((path) => path.startsWith("docs/archive/"))).toBe(false);
    expect(auditCapabilityExceptionPolicy(liveSnapshot)).toEqual([]);
  });

  // The owner's 2026-08-24 ruling (#207) put Tier 2 BACK to opt-in / default OFF after a five-day
  // amendment had had it default-ON once armed. A superseded default is the kind of wording that
  // creeps back by copy-paste, and it would creep back as a LOOSENING of a privacy default — so the
  // retired phrase may only appear where a doc is quoting it AS retired, which is what the marker
  // declares. The corpus must actually contain such a quotation, or this guard is watching nothing.
  it("no policy doc re-asserts the retired default-ON wording", () => {
    const quoted = Object.values(liveSnapshot).filter((text) => RETIRED_DEFAULT_ON.test(text));
    expect(quoted.length).toBeGreaterThan(0);
    expect(findRetiredDefaultAssertions(liveSnapshot)).toEqual([]);
  });

  it("catches the retired default-ON wording when it comes back unmarked (positive control)", () => {
    const snapshot = clone(liveSnapshot);
    snapshot["docs/PRIVACY.md"] += "\nReceipts sharing is on by default once armed.";
    expect(findRetiredDefaultAssertions(snapshot)).toHaveLength(1);
    expect(findRetiredDefaultAssertions(snapshot)[0]).toMatch(/^docs\/PRIVACY\.md:\d+$/);

    // ...and the marker is a real hatch, not a phrase the scanner ignores everywhere.
    const marked = clone(liveSnapshot);
    marked["docs/PRIVACY.md"] +=
      `\nRetired wording: "on by default once armed" <!-- ${RETIRED_CLAIM_ALLOW} -->`;
    expect(findRetiredDefaultAssertions(marked)).toEqual([]);
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
    snapshot["docs/PRODUCT_CONSTITUTION.md"] += "\nTier 1 authorizes Tier 2 and Tier 3.";
    expect(auditCapabilityExceptionPolicy(snapshot)).toContain(
      "forbidden policy: Tier 1 authorizes Tier 2",
    );
  });

  it("rejects a false current-runtime claim", () => {
    const snapshot = clone(liveSnapshot);
    snapshot["docs/RELEASE_STATE.md"] = snapshot["docs/RELEASE_STATE.md"].replace(
      "NO RUNTIME TRAFFIC, NOTHING ARMED",
      "LIVE / RUNTIME TRAFFIC ENABLED",
    );
    expect(auditCapabilityExceptionPolicy(snapshot)).toContain(
      "docs/RELEASE_STATE.md: missing policy marker: no runtime traffic, nothing armed",
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

// ── SHIPPED COPY MUST NOT OUTLIVE THE DECISION (#133) ──────────────────────────────────────────
//
// The block above pins the POLICY documents. This one pins what a user actually reads, because the
// 2026-08-09 decision moved a line the app's own copy was still standing on: a Compy driver is no
// longer categorically forbidden — it is policy-possible only through its own approved record, and
// the current build ships none.
//
// That makes two opposite failures possible, and this guard rejects both:
//
//   "Compy will never ship a kernel driver"  — a permanent promise the owner has not made, and one
//                                              that would have to be publicly broken later.
//   "Compy's driver reads your CPU temp"     — marketing a capability that does not exist.
//
// The honest form is the time-scoped fact: this build installs no kernel driver, so CPU temperature
// is external-monitor-only. Game/process injection is NOT in scope here — that ban stays absolute
// and its own guards keep it that way.

// join() rather than "a/b" literals: walk() emits child paths through join(), so on Windows a
// slash-literal top-level entry lands in the corpus spelled differently from everything under it,
// and the corpus assertion below then fails on a file that IS being scanned.
const COPY_ROOTS = [
  join("src", "i18n"), join("src", "data"), join("src", "surfaces"),
  join("site-app", "src", "pages"),
];
const COPY_DOCS = [
  join("docs", "BETA_TESTER_README.md"), join("docs", "PRIVACY.md"), join("docs", "EULA.md"),
];
const COPY_EXT = /\.(ts|tsx|json|astro|md)$/;

// A promise about the FUTURE of a driver, in the forms this repo has actually used.
const DRIVER_PROMISE = /(won't|will not|will never|never)\s+(ship|install|include|build|add)\s+(a\s+)?(kernel\s+)?driver/i;
// The same promise made with a pronoun — "CPU temperature needs a kernel driver, and Compy will
// never ship one" — which the noun form above walks straight past. This is how the setup tour said
// it, so it is not a hypothetical.
const DRIVER_PROMISE_PRONOUN = /(won't|will not|will never|never)\s+(ship|install|include|build|add)\s+one\b/i;
// A claim that a driver already exists and does something.
// `\b` on `our` matters more than it looks: without it, "y[our driver] tool" — which is the GPU
// VENDOR's driver, not Compy's — matches, and the guard reports five false defects in copy that was
// already correct. A guard that cries wolf gets weakened by the next person to hit it.
const DRIVER_CLAIM = /\b(our|compy's|the compy)\s+(kernel\s+)?driver\b/i;

function collectCopy(): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    let st;
    try { st = statSync(p); } catch { return; }
    if (st.isDirectory()) { for (const n of readdirSync(p)) walk(join(p, n)); return; }
    if (COPY_EXT.test(p) && !/\.(test|spec)\./.test(p)) out.push(p);
  };
  for (const r of COPY_ROOTS) walk(r);
  for (const d of COPY_DOCS) walk(d);
  return out;
}

export function findDriverOverclaims(text: string): string[] {
  const hits: string[] = [];
  text.split("\n").forEach((line, i) => {
    const pronounForm = /driver/i.test(line) && DRIVER_PROMISE_PRONOUN.test(line);
    if (DRIVER_PROMISE.test(line) || pronounForm) hits.push(`${i + 1}: permanent "no driver ever" promise`);
    if (DRIVER_CLAIM.test(line)) hits.push(`${i + 1}: claims a Compy driver exists`);
  });
  return hits;
}

describe("shipped copy matches the capability exception gate", () => {
  it("has a real corpus (a copy guard whose corpus emptied would pass loudest)", () => {
    const files = collectCopy();
    expect(files).toContain(join("src", "i18n", "locales", "en", "home.json"));
    expect(files).toContain(join("docs", "BETA_TESTER_README.md"));
    expect(files.length).toBeGreaterThan(30);
    // A root that no longer exists is walked past in silence, so the corpus shrinks and the guard
    // still passes — which is how `src/Onboarding.tsx` sat in this list after C-18b deleted it.
    // Coverage lost quietly is worse than coverage never claimed.
    const missing = [...COPY_ROOTS, ...COPY_DOCS].filter((p) => !existsSync(p));
    expect(
      missing,
      `these copy roots no longer exist, so nothing under them is scanned: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("catches both directions (positive controls)", () => {
    expect(findDriverOverclaims("Compy won't ship a kernel driver")).toHaveLength(1);
    expect(findDriverOverclaims("we will never install a driver")).toHaveLength(1);
    expect(findDriverOverclaims("our kernel driver reads the sensor")).toHaveLength(1);
    expect(findDriverOverclaims("CPU temp needs a kernel driver, and Compy will never ship one")).toHaveLength(1);
    // The honest, time-scoped form must stay legal, or the guard forces a lie in the other direction.
    expect(findDriverOverclaims("This build installs no kernel driver.")).toEqual([]);
    expect(findDriverOverclaims("Compy ships no kernel driver, so CPU temp is monitor-only.")).toEqual([]);
    // The GPU vendor s driver is not Compy s driver.
    expect(findDriverOverclaims("Capture your driver settings before and after a change.")).toEqual([]);
  });

  it("no shipped surface promises a driver will never exist, or claims one already does", () => {
    const offenders: string[] = [];
    for (const file of collectCopy()) {
      for (const hit of findDriverOverclaims(readFileSync(file, "utf8"))) offenders.push(`${file}:${hit}`);
    }
    expect(
      offenders,
      "The owner retired the categorical driver ban on 2026-08-09: a driver is policy-possible " +
        "only under its own approved record, and this build ships none. Say the time-scoped fact, " +
        "not a permanent promise and not a capability that does not exist:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });
});
