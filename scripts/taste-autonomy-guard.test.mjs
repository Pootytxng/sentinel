// Taste autonomy guard — the 2026-08-07 owner decree, mechanized.
//
// The owner: "i do not want taste calls to exclusively fall on me id like to see youre ideas and
// consider your taste calls as well ... i want you to be absoulutely sure they dont cause conflict
// again once you made these changes due to leaving behind anything else that may cause some sort of
// prohibition in doing so."
//
// The conflict he is describing was real and measurable. On 2026-08-07, docs/OWNER_ACTION_CHECKLIST.md
// already said Claude proceeds on tasteful polish autonomously — while THIRTEEN other places said the
// opposite ("taste = owner territory", "final taste sign-off stays with the owner", "aesthetic taste
// calls" listed as an owner gate in CLAUDE.md itself). Whichever doc an agent happened to read last
// decided the behaviour. Prose cannot enforce prose; a test can.
//
// So this guard does two things and only two things:
//   1. BANNED — the old owner-parking phrasings may not reappear in any live governance doc.
//   2. REQUIRED — each doc must still carry the sentence that opened the gate, so a well-meaning
//      "tidy up" cannot quietly delete the decree and leave nothing behind.
// Plus a MIRROR check, because the near-miss in this very sweep was the .codex/ copy of the design
// director agent: fixing .claude/ alone would have left the Codex lane still asking the owner.
//
// Deliberately NOT scanned: scripts/ (this file quotes the banned literals), docs/archive/**,
// docs/CHANGELOG.md, docs/BACKLOG_ARCHIVE.md — point-in-time records of what WAS true stay honest.
//
// Related: src/claude-md-laws-guard.test.ts (CLAUDE.md marker/byte/pointer integrity).

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, ...rel.split("/")), "utf8");
const exists = (rel) => existsSync(join(ROOT, ...rel.split("/")));

/** Live governance surfaces — the docs an agent actually reads to learn who decides what. */
const LIVE_DOCS = [
  "CLAUDE.md",
  "AGENTS.md",
  "docs/RELEASE_AUTONOMY.md",
  "docs/WORK_CONTROL.md",
  "docs/COUNCIL_PROTOCOL.md",
  "docs/COWORK_HANDOFF.md",
  "docs/OWNER_ACTION_CHECKLIST.md",
  "docs/HONESTY_AUDIT_TWEAKS.md",
  "docs/BACKLOG.md",
  "docs/UI_VISION_BACKLOG.md",
  "docs/BRANCH_DISPOSITIONS.md",
  ".claude/agents/web-design-director.md",
  ".codex/agents/web-design-director.toml",
];

/**
 * Phrasings that park taste on the owner. Literal and case-insensitive, matched against a
 * whitespace-collapsed copy so re-wrapping a paragraph can never fail the build.
 *
 * Literals, not heuristics, on purpose: an earlier attempt scanned a window around every
 * "taste"/"aesthetic" for owner tokens and negations, and markdown emphasis defeated it —
 * "**not** owner-gated" does not contain the substring "not owner", so correct text failed.
 */
const BANNED_PHRASES = [
  "taste = owner territory",
  "taste is owner territory",
  "taste call (owner territory)",
  "stays open as owner territory",
  "owner taste",
  "owner-taste",
  "taste sign-off stays with the owner",
  "final taste sign-off",
  "aesthetic taste calls",
  "theme-hex call (owner territory)",
  "where your eye is the authority",
  "theme hexes remain his call",
  // Found only by the completeness re-grep, not by the phrasings above — both routed taste to the
  // owner structurally rather than in a sentence: BACKLOG.md listed "🎨 taste" as a fourth
  // owner-gate category alongside money/mutation/telemetry, and UI_VISION_BACKLOG.md told every
  // new UI ask to cross-link the owner checklist "if it needs his hands/eyes/taste".
  "🎨 taste",
  "his hands/eyes/taste",
];

/** Per-file proof the decree actually landed, so deleting it fails loudly instead of silently. */
const REQUIRED = {
  "CLAUDE.md": [
    "TASTE IS MINE TO EXERCISE, HIS TO OVERRULE",
    "i do not want taste calls to exclusively fall on me",
  ],
  "docs/WORK_CONTROL.md": [
    "Aesthetic taste is not on that list",
    "An aesthetic call is not a gate",
  ],
  "docs/COUNCIL_PROTOCOL.md": ["Aesthetic taste is NOT owner territory"],
  "docs/RELEASE_AUTONOMY.md": ["aesthetic taste is NOT one"],
  "docs/COWORK_HANDOFF.md": ["Aesthetic taste is NOT his to carry"],
  "docs/OWNER_ACTION_CHECKLIST.md": ["Nothing aesthetic is parked on you by default"],
  ".claude/agents/web-design-director.md": ["Aesthetics are yours to call"],
  ".codex/agents/web-design-director.toml": ["Aesthetics are yours to call"],
};

/** Both copies of the design-director seat must carry the same taste sentence. */
const DIRECTOR_MIRROR = [
  ".claude/agents/web-design-director.md",
  ".codex/agents/web-design-director.toml",
];
const MIRRORED_SENTENCE =
  "its aesthetic calls are the lane's to make and ship, not the owner's to sign off";

const flatten = (s) => s.replace(/\s+/g, " ");

describe("taste autonomy guard", () => {
  it("every scanned doc exists — a renamed file must not silently drop out of the sweep", () => {
    const missing = LIVE_DOCS.filter((p) => !exists(p));
    expect(missing, "listed in LIVE_DOCS but not on disk").toEqual([]);
    expect(LIVE_DOCS.length).toBeGreaterThan(10);
  });

  it("no live governance doc parks aesthetic taste on the owner", () => {
    const broken = [];
    for (const rel of LIVE_DOCS) {
      const flat = flatten(read(rel)).toLowerCase();
      for (const phrase of BANNED_PHRASES) {
        if (flat.includes(phrase.toLowerCase())) {
          broken.push(
            `${rel} :: "${phrase}" — taste is not owner-gated since 2026-08-07 (CLAUDE.md, ` +
              `"TASTE IS MINE TO EXERCISE, HIS TO OVERRULE"). Decide it, ship it, show a before/after.`,
          );
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("the decree is still written where each doc needs it", () => {
    const broken = [];
    for (const [rel, phrases] of Object.entries(REQUIRED)) {
      const flat = flatten(read(rel));
      for (const phrase of phrases) {
        if (!flat.includes(flatten(phrase))) {
          broken.push(`${rel} :: missing "${phrase}"`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("the design-director seat says the same thing in both lanes", () => {
    const broken = DIRECTOR_MIRROR.filter(
      (rel) => !flatten(read(rel)).includes(MIRRORED_SENTENCE),
    ).map((rel) => `${rel} :: missing the mirrored taste sentence — the Codex lane would still ask`);
    expect(broken).toEqual([]);
  });

  it("BANNED_PHRASES is non-vacuous — it must still catch the original violation", () => {
    const original = flatten(
      "hand verdict-calls + voice/nits to content/owner (taste = owner territory)",
    ).toLowerCase();
    const caught = BANNED_PHRASES.some((p) => original.includes(p.toLowerCase()));
    expect(caught, "the guard no longer detects the 2026-08-07 phrasing it was written for").toBe(
      true,
    );
  });
});
