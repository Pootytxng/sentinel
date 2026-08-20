import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
// (fs typed by src/test-node-shims.d.ts — the docs are read off disk, like every other state-drift
// guard here, so this grades what SHIPS rather than what a bundler resolves to.)

// SHIPPED-FEATURE ↔ DOC-STATUS DRIFT GUARD — a feature that is mounted and default-ON must not be
// recorded as parked or dropped in the docs the next reader plans from.
//
// Written 2026-08-19 closing backlog C-12. `docs/CONFORMANCE_AUDIT_2026-08-18.md` §C-12 found the
// command palette described in TWO living docs as "parked, then dropped — never mentioned again
// anywhere" while `src/design/CommandPalette.tsx` was mounted in `ShellV2` behind a DEFAULT-ON flag
// and had been for six weeks. `docs/OWNER_ACTION_CHECKLIST.md` still listed it under "still
// genuinely open," so it was also sitting on the owner's desk as work he owed.
//
// This is the INVERSE of the usual doc rot, and it is the expensive direction. A stale TODO wastes a
// reader's minute; a shipped feature filed as dropped gets RE-PROPOSED, re-specced, and possibly
// rebuilt beside the one that already exists. It was caught by hand, by an audit that happened to
// run — which is exactly the failure mode `docs/BRANCH_DISPOSITIONS.md` already learned: a state
// claim with no checker rots silently. So the claim gets a checker.
//
// SCOPE — LIVING docs only. Dated point-in-time records (`CONFORMANCE_AUDIT_*.md`, `CHANGELOG.md`,
// the `docs/superpowers/specs/*` that parked the feature in the first place, `BACKLOG_ARCHIVE.md`)
// are the repository's memory and are SUPPOSED to still say "parked" — they record what was true on
// their date. Grading them would force history to be rewritten every time the present moved.
//
// ESCAPE HATCH — `<!-- shipped-status-history -->` exempts the paragraph it appears in. A living doc
// legitimately needs to say "this was parked until <date>"; what it must not do is say so in the
// present tense. Greppable on purpose: `grep -rn shipped-status-history docs/` lists every place a
// living doc is allowed to speak about a dead status.
//
// ADDING A ROW is the point — this table is meant to grow. Any feature that has ever been recorded
// as not-shipped and then shipped belongs here.

type Feature = {
  /** How the docs refer to it. Any of these near a dead-status word is a violation. */
  readonly aliases: readonly RegExp[];
  /** The file that must exist for the feature to count as built. */
  readonly component: string;
  /** The parent that must import it for the feature to count as REACHABLE, not merely present. */
  readonly mountedIn: string;
  /** The import specifier `mountedIn` must carry. */
  readonly importSpecifier: string;
};

const FEATURES: Record<string, Feature> = {
  CommandPalette: {
    aliases: [/CommandPalette/, /command palette/i],
    component: "src/design/CommandPalette.tsx",
    mountedIn: "src/design/ShellV2.tsx",
    importSpecifier: "./CommandPalette",
  },
};

/** Docs that describe the CURRENT state of the product and are planned from. */
const LIVING_DOCS = ["docs/BACKLOG.md", "docs/UI_VISION_BACKLOG.md", "docs/OWNER_ACTION_CHECKLIST.md"];

/** Words that assert a feature is not shipped. Deliberately narrow — "search" or "palette" alone is
 *  not a status claim, and a guard that fires on ordinary prose gets disabled. */
const DEAD_STATUS = /\bparked\b|\bdropped\b|\bnot built\b|\bnever built\b|\bbacklog candidate\b|\bunbuilt\b/i;

const HISTORY_TOKEN = "shipped-status-history";

/** A markdown block and the 1-based line it starts on. Blocks break on a blank line AND on a new
 *  top-level list item or table row — without that second rule a dense ledger like `docs/BACKLOG.md`
 *  is ONE paragraph, and a single history marker anywhere in it would exempt the whole file. The
 *  continuation lines of a wrapped bullet stay with their bullet. */
export function paragraphs(text: string): { line: number; body: string }[] {
  const out: { line: number; body: string }[] = [];
  const lines = text.split(/\r?\n/);
  const startsBlock = (raw: string) => /^(?:[-*+] |\d+\. |\|)/.test(raw);
  let start = -1;
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) out.push({ line: start + 1, body: buf.join("\n") });
    buf = [];
    start = -1;
  };
  lines.forEach((raw, i) => {
    if (raw.trim() === "") return flush();
    if (startsBlock(raw)) flush();
    if (start < 0) start = i;
    buf.push(raw);
  });
  flush();
  return out;
}

/** The check itself, as a pure function over already-read text, so the disarm proof below can run it
 *  on a seeded tree rather than trusting that it *would* fail on a bad one. */
export function driftIn(
  feature: string,
  aliases: readonly RegExp[],
  docs: { path: string; text: string }[],
): string[] {
  const found: string[] = [];
  for (const doc of docs) {
    for (const para of paragraphs(doc.text)) {
      if (para.body.includes(HISTORY_TOKEN)) continue;
      if (!aliases.some((a) => a.test(para.body))) continue;
      const hit = para.body.match(DEAD_STATUS);
      if (!hit) continue;
      found.push(
        `${doc.path}:${para.line} calls ${feature} "${hit[0]}" — it is built, mounted and default-ON. ` +
          `Correct the claim, or mark the paragraph <!-- ${HISTORY_TOKEN} --> if it is deliberately describing the past.`,
      );
    }
  }
  return found;
}

describe("shipped features are not recorded as parked or dropped", () => {
  for (const [name, feature] of Object.entries(FEATURES)) {
    describe(name, () => {
      it("is genuinely built and reachable, so the doc claim below is the thing at fault", () => {
        expect(existsSync(feature.component), `${feature.component} is missing`).toBe(true);
        const parent = readFileSync(feature.mountedIn, "utf8");
        expect(
          parent.includes(feature.importSpecifier),
          `${feature.mountedIn} no longer imports ${feature.importSpecifier} — if the feature was genuinely ` +
            `removed, drop its row from FEATURES here rather than leaving a guard that grades a ghost.`,
        ).toBe(true);
      });

      it("is not called parked or dropped in any living doc", () => {
        const docs = LIVING_DOCS.map((path) => ({ path, text: readFileSync(path, "utf8") }));
        expect(driftIn(name, feature.aliases, docs)).toEqual([]);
      });
    });
  }

  // The green suite above proves nothing on its own — an alias that matches nothing, or a regex that
  // never fires, passes identically. These two run the same pure checker on text written to fail.
  describe("the checker can fail", () => {
    it("reports a living doc that calls the feature parked", () => {
      const docs = [{ path: "fixture.md", text: "### D. CommandPalette — parked, then dropped\nnothing more.\n" }];
      expect(driftIn("CommandPalette", FEATURES.CommandPalette.aliases, docs)).toEqual([
        expect.stringContaining("fixture.md:1 calls CommandPalette"),
      ]);
    });

    it("stays silent when that same paragraph is marked as history", () => {
      const docs = [
        {
          path: "fixture.md",
          text: "<!-- shipped-status-history -->\nCommandPalette was parked until 2026-08-11.\n",
        },
      ];
      expect(driftIn("CommandPalette", FEATURES.CommandPalette.aliases, docs)).toEqual([]);
    });

    it("does not let one marker in a dense list exempt its neighbours", () => {
      const docs = [
        {
          path: "fixture.md",
          text:
            "- CommandPalette was parked once. <!-- shipped-status-history -->\n" +
            "- **C-12** says CommandPalette is dropped.\n",
        },
      ];
      expect(driftIn("CommandPalette", FEATURES.CommandPalette.aliases, docs)).toEqual([
        expect.stringContaining("fixture.md:2 calls CommandPalette"),
      ]);
    });

    it("does not fire on a status word that is nowhere near the feature", () => {
      const docs = [{ path: "fixture.md", text: "The site overhaul is parked.\n\nCommandPalette ships default-ON.\n" }];
      expect(driftIn("CommandPalette", FEATURES.CommandPalette.aliases, docs)).toEqual([]);
    });
  });
});
