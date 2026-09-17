import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import wire from "./test/fixtures/machine-model.wire.json";
import {
  EVIDENCE_CLASSES,
  FRESHNESS_VALUES,
  type AnswerEvidence,
  type ChangeChronology,
  type ChronologyEntry,
  type ComparedField,
  type CompyChangeFact,
  type CompyChangeTruth,
  type DomainVocabulary,
  type EvidenceSummary,
  type ExcludedProducer,
  type Fact,
  type IdentityClaim,
  type IdentityDisagreement,
  type IntelEventScope,
  type MachineIdentity,
  type MachineModel,
  type UnknownFact,
} from "./types";

// MACHINE MODEL WIRE CONTRACT (#449).
//
// Three links, each checked mechanically:
//   1. Rust → fixture: `wire_fixture_matches_what_serde_emits` (machine_model.rs) proves the fixture
//      is byte-for-byte what `get_machine_model` serializes.
//   2. TS types → key lists below: `Shape<T>` makes tsc fail if a list names a key the type lacks,
//      misses one it has, or marks an optional field required (or the reverse).
//   3. Key lists → fixture: this test walks every object in the fixture and fails on any key the
//      list does not declare, or any required key the object lacks.
//
// A field added in Rust therefore cannot reach the frontend untyped.
//
// Paths are repo-root-relative; vitest runs from the repo root (scripts/run-vitest.mjs).

type Presence<T> = { [K in keyof T]-?: object extends Pick<T, K> ? "optional" : "required" };

// Each node names its keys, whether each is optional, and how to descend into its children.
type Node = {
  name: string;
  keys: Record<string, "optional" | "required">;
  children?: Record<string, Node>;
};

function shape<T>(name: string, keys: Presence<T>, children?: Record<string, Node>): Node {
  return { name, keys, children };
}

const DOMAIN = shape<DomainVocabulary>("DomainVocabulary", {
  vocabulary: "required",
  value: "required",
});

const FACT = shape<Fact<unknown>>(
  "Fact",
  {
    value: "required",
    class: "required",
    source: "required",
    observed_at: "optional",
    freshness: "required",
    unknown_reason: "optional",
    not_applicable_reason: "optional",
    domain: "optional",
  },
  { domain: DOMAIN },
);

const CLAIM = shape<IdentityClaim>("IdentityClaim", {
  producer: "required",
  value: "required",
  observed_at: "optional",
  freshness: "required",
});

const IDENTITY = shape<MachineIdentity>(
  "MachineIdentity",
  {
    cpu: "required",
    gpu: "required",
    gpu_driver: "required",
    ram_gb: "required",
    display: "required",
    windows: "required",
    rig_hash: "required",
    canonical_rule: "required",
    contributing_producers: "required",
    excluded_producers: "required",
    compared_fields: "required",
    disagreements: "required",
  },
  {
    cpu: FACT,
    gpu: FACT,
    gpu_driver: FACT,
    ram_gb: FACT,
    display: FACT,
    windows: FACT,
    rig_hash: FACT,
    excluded_producers: shape<ExcludedProducer>("ExcludedProducer", {
      producer: "required",
      reason: "required",
    }),
    compared_fields: shape<ComparedField>("ComparedField", {
      field: "required",
      against: "required",
    }),
    disagreements: shape<IdentityDisagreement>(
      "IdentityDisagreement",
      { field: "required", left: "required", right: "required", interpretation: "required" },
      { left: CLAIM, right: CLAIM },
    ),
  },
);

const CHRONOLOGY = shape<ChangeChronology>(
  "ChangeChronology",
  {
    recorded_from: "optional",
    recorded_from_source: "optional",
    identity_history_from: "optional",
    identity_snapshots: "required",
    total_events: "required",
    coverage_note: "required",
    entries: "required",
    dropped_unparseable: "required",
    causation_note: "required",
    unknown_reason: "optional",
  },
  {
    entries: shape<ChronologyEntry>("ChronologyEntry", {
      observed_at: "required",
      summary: "required",
      detail: "optional",
      event_type: "required",
      source: "required",
      scope: "required",
      observed_between: "optional",
      class: "required",
    }),
  },
);

const CHANGES = shape<CompyChangeTruth>(
  "CompyChangeTruth",
  {
    total_recorded: "required",
    active_now: "required",
    in_effect_other_rig: "required",
    in_effect_rig_unknown: "required",
    in_effect_total: "required",
    applied_but_not_in_effect: "required",
    in_effect_unknown: "required",
    rolled_back: "required",
    on_this_rig: "required",
    not_on_this_rig: "required",
    rig_unknown: "required",
    changes: "required",
    ledger_note: "required",
    ledger_unreadable: "optional",
  },
  {
    changes: shape<CompyChangeFact>(
      "CompyChangeFact",
      {
        id: "required",
        title: "required",
        applied_at: "required",
        status: "required",
        still_active: "required",
        rolled_back_at: "required",
        on_this_rig: "required",
        reversible: "required",
        restores: "optional",
      },
      {
        applied_at: FACT,
        status: FACT,
        still_active: FACT,
        rolled_back_at: FACT,
        on_this_rig: FACT,
        reversible: FACT,
      },
    ),
  },
);

const EVIDENCE = shape<EvidenceSummary>(
  "EvidenceSummary",
  {
    built_at: "required",
    answers: "required",
    unknowns: "required",
    classes_present: "required",
    vocabulary: "required",
  },
  {
    answers: shape<AnswerEvidence>("AnswerEvidence", {
      answer: "required",
      classes: "required",
      oldest_observed_at: "optional",
      newest_observed_at: "optional",
      unstamped_facts: "required",
      unknown_facts: "required",
      not_applicable_facts: "required",
    }),
    unknowns: shape<UnknownFact>("UnknownFact", {
      field: "required",
      source: "required",
      reason: "required",
    }),
  },
);

const MODEL = shape<MachineModel>(
  "MachineModel",
  {
    schema_version: "required",
    built_at: "required",
    identity: "required",
    chronology: "required",
    compy_changes: "required",
    evidence: "required",
  },
  { identity: IDENTITY, chronology: CHRONOLOGY, compy_changes: CHANGES, evidence: EVIDENCE },
);

type Seen = Map<string, Set<string>>;

function check(node: Node, value: unknown, path: string, problems: string[], seen: Seen): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => check(node, item, `${path}[${i}]`, problems, seen));
    return;
  }
  if (value === null || typeof value !== "object") {
    problems.push(`${path}: expected a ${node.name} object, got ${JSON.stringify(value)}`);
    return;
  }
  const present = Object.keys(value);
  const keysSeen = seen.get(node.name) ?? new Set<string>();
  seen.set(node.name, keysSeen);
  for (const key of present) {
    keysSeen.add(key);
    if (!(key in node.keys)) problems.push(`${path}.${key}: not declared on ${node.name}`);
  }
  for (const [key, presence] of Object.entries(node.keys)) {
    if (presence === "required" && !present.includes(key)) {
      problems.push(`${path}.${key}: required on ${node.name} but missing`);
    }
  }
  for (const [key, child] of Object.entries(node.children ?? {})) {
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined) check(child, v, `${path}.${key}`, problems, seen);
  }
}

// Every value found at `key` anywhere in the tree.
function collectValues(value: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(value)) value.forEach((v) => collectValues(v, key, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === key) out.push(v);
      collectValues(v, key, out);
    }
  }
  return out;
}

// Rust enum variants, kebab-cased the way `#[serde(rename_all = "kebab-case")]` spells them.
function rustKebabVariants(file: string, enumName: string): string[] {
  const src = readFileSync(join("src-tauri", "src", file), "utf8");
  const body = new RegExp(
    String.raw`#\[serde\(rename_all = "kebab-case"\)\]\s*pub\(crate\) enum ${enumName} \{([\s\S]*?)\n\}`,
  ).exec(src);
  if (!body) throw new Error(`could not find kebab-case enum ${enumName} in ${file}`);
  return body[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[A-Z][A-Za-z0-9]*,?$/.test(line))
    .map((line) => line.replace(/,$/, "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase());
}

const SCOPES = ["compy-applied", "measurement", "observed"] as const satisfies readonly IntelEventScope[];
// Exhaustiveness: fails to compile if IntelEventScope gains a value SCOPES does not list.
const _scopesExhaustive: Exclude<IntelEventScope, (typeof SCOPES)[number]> extends never ? true : never = true;
void _scopesExhaustive;

describe("Machine Model wire contract", () => {
  it("every object in the fixture has exactly the keys its TS type declares", () => {
    const problems: string[] = [];
    check(MODEL, wire, "$", problems, new Map());
    expect(problems).toEqual([]);
  });

  it("the fixture exercises the optional fields a screen must handle", () => {
    const seen: Seen = new Map();
    check(MODEL, wire, "$", [], seen);
    expect(seen.get("Fact")).toContain("unknown_reason");
    expect(seen.get("Fact")).toContain("not_applicable_reason");
    expect(seen.get("Fact")).toContain("domain");
    expect(seen.get("ChronologyEntry")).toContain("observed_between");
    expect(seen.get("CompyChangeFact")).toContain("restores");
  });

  it("the fixture holds at least one unknown fact and one identity disagreement", () => {
    const m = wire as unknown as MachineModel;
    const facts = (Object.values(m.identity) as unknown[]).filter(
      (v): v is Fact<unknown> => !!v && typeof v === "object" && "freshness" in v,
    );
    expect(facts.some((f) => f.value === null && !!f.unknown_reason)).toBe(true);
    expect(m.identity.disagreements.length).toBeGreaterThan(0);
  });

  it("every enum value in the fixture is in its TS union", () => {
    const classes = [
      ...collectValues(wire, "class"),
      ...collectValues(wire, "classes").flat(),
      ...collectValues(wire, "classes_present").flat(),
      ...collectValues(wire, "vocabulary").filter(Array.isArray).flat(),
    ];
    expect(classes.length).toBeGreaterThan(0);
    for (const c of classes) expect(EVIDENCE_CLASSES).toContain(c);

    const freshness = collectValues(wire, "freshness");
    expect(freshness.length).toBeGreaterThan(0);
    for (const f of freshness) expect(FRESHNESS_VALUES).toContain(f);

    const scopes = collectValues(wire, "scope");
    expect(scopes.length).toBeGreaterThan(0);
    for (const s of scopes) expect(SCOPES).toContain(s);
  });

  it("the TS unions list exactly the Rust enum variants", () => {
    expect([...EVIDENCE_CLASSES].sort()).toEqual(
      rustKebabVariants("machine_model.rs", "EvidenceClass").sort(),
    );
    expect([...FRESHNESS_VALUES].sort()).toEqual(
      rustKebabVariants("machine_model.rs", "Freshness").sort(),
    );
    expect([...SCOPES].sort()).toEqual(rustKebabVariants("intelligence.rs", "EventScope").sort());
    // The model publishes its own vocabulary in order; the TS list must match it.
    expect((wire as unknown as MachineModel).evidence.vocabulary).toEqual([...EVIDENCE_CLASSES]);
  });
});
