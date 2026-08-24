// Doc-truth guard — a decision that supersedes wording must not leave the old wording alive.
//
// TWICE in one week a decision landed and a secondary doc kept contradicting it, silently:
//
//   * the Pro price band was decided 2026-08-22 ($4.99/mo · $39/yr · $89 lifetime). The next day
//     COMPY_OVERVIEW.md still read "~$3-4/mo or ~$25/yr" in TWO places, one of them under a heading
//     that called the price "still genuinely open". A reader starting from that file would have
//     quoted a dead number.
//   * RECEIPTS_DOCTRINE.md retired no-telemetry absolutism on 2026-08-18 and specified receipts
//     telemetry as ON BY DEFAULT once armed, disclosed at first run. COMPY_OVERVIEW.md described
//     the same feature as "opt-in, default-off" — the opposite, on a PRIVACY promise, for five days.
//
// Neither was caught by anything. `verify-release-state.mjs` checks the release contract; nothing
// checked whether a superseded phrase was still being asserted somewhere else. This is the same
// shape as check (8): a claim that outlived the decision it described.
//
// HOW IT WORKS. Each entry below is a phrase a decision RETIRED. If it appears in a live doc, this
// fails and names the decision that killed it. It is a RATCHET, not a fixed list: when a future
// decision supersedes wording, add the old wording here in the same commit, and the next doc that
// keeps asserting it goes red instead of quietly misinforming a reader.
//
// SCOPE IS DELIBERATELY NARROW. History must stay honest, so archives, reviews and dated specs are
// excluded wholesale — a review that RECORDS what was believed in July is not a live claim. And a
// live doc that discusses a retired claim in order to retire it carries an explicit allow marker,
// the same idiom this repo already uses for `<!-- outbound-claim-allow -->`.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Marker that lets one line name a retired claim in order to retire it. */
export const ALLOW_MARKER = "retired-claim-allow";

/**
 * Phrases a decision killed. `pattern` must match the DEAD wording only — never the live wording,
 * or every correct doc fails. Keep `why` specific enough to fix the file without re-research.
 */
export const RETIRED_CLAIMS = [
  {
    id: "pro-price-band-2026-08-22",
    pattern: /~?\$3\s*[-–]\s*4\s*\/\s*mo|~?\$25\s*\/\s*yr/i,
    why: "the Pro price band was decided 2026-08-22: $4.99/mo · $39/yr · $89 lifetime",
    supersededBy: "docs/RECEIPTS_DOCTRINE.md (owner decision 2026-08-22)",
  },
];

// NOT ADDED, on purpose, and the reason is the more useful half of this file.
//
// The first draft of this guard also banned "receipts telemetry … opt-in / default-off", on the
// premise that RECEIPTS_DOCTRINE.md's 2026-08-18 amendment ("on by default once armed, disclosed at
// first run") had settled it. Running the guard DISPROVED THE PREMISE: it flagged
// `docs/RECEIPTS_DOCTRINE.md:102` itself, which still specifies "opt-in results sharing … default
// OFF" for the same feature. The law contradicts itself, on a privacy default.
//
// A guard cannot adjudicate that, and a guard that encodes one side of an unsettled question is
// worse than no guard: it would have quietly enforced the more invasive reading of a privacy
// promise across every doc. So the contradiction was filed for the owner to rule on instead.
//
// It also flagged `CLAUDE.md:203` ("built dark, no send path, default-OFF"), which is an accurate
// description of the CURRENT CODE, not a policy claim at all — the pattern could not tell those
// apart. **Two different failure modes, one over-broad pattern.** Add the entry back only once the
// owner has ruled, and only with wording narrow enough to separate policy-after-arming from
// today's code state.

// SCOPE — the hard-won part of this guard, and the reason it is a short list rather than `*.md`.
//
// The first draft swept every tracked markdown file. It produced NINE hits and every one of them
// was honest history: `PRICING_RESEARCH.md` compares the old band to comparables (that is the
// document's entire job), `RECEIPTS_DOCTRINE.md` records what the band replaced, `SESSION_HANDOFF`
// and `OWNER_ACTION_CHECKLIST` explain why it moved. Banning the dead number everywhere would have
// meant sprinkling allow markers through five files and training everyone to add them reflexively —
// which is how a guard becomes a formality people route around.
//
// The defect was never "the old number appears somewhere". It was **the old number presented as
// current, in a document whose job is to say what is true right now.** So the sweep is exactly
// those documents. A file that narrates history is not in scope, because narrating history is not
// the defect.
export const STATE_DOCS = ["COMPY_OVERVIEW.md", "PRODUCT.md"];

const liveDocs = () => {
  const tracked = new Set(
    execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return STATE_DOCS.filter((p) => tracked.has(p));
};

/** Offending `path:line` hits for one retired claim, ignoring allow-marked lines. */
export function findRetired(claim, files, read = (p) => readFileSync(resolve(repoRoot, p), "utf8")) {
  const hits = [];
  for (const path of files) {
    let text;
    try { text = read(path); } catch { continue; }
    text.split(/\r?\n/).forEach((line, i) => {
      if (line.includes(ALLOW_MARKER)) return;
      if (claim.pattern.test(line)) hits.push(`${path}:${i + 1}`);
    });
  }
  return hits;
}

describe("doc truth: a superseded claim must not still be asserted", () => {
  const files = liveDocs();

  // A renamed or deleted state doc must break this, not silently empty the sweep.
  it("resolves every declared state doc — an empty sweep is a vacuous pass", () => {
    expect(files).toEqual(STATE_DOCS);
  });

  for (const claim of RETIRED_CLAIMS) {
    it(`no live doc still asserts: ${claim.id}`, () => {
      const hits = findRetired(claim, files);
      expect(
        hits,
        `${hits.join(", ")}\n\nRETIRED because ${claim.why}.\nSuperseded by ${claim.supersededBy}.\n` +
          `Fix the wording. If the line exists specifically to RECORD that the claim is dead, add ` +
          `an inline <!-- ${ALLOW_MARKER} --> marker to that line.`,
      ).toEqual([]);
    });
  }
});

// ── Falsification ────────────────────────────────────────────────────────────────────────────────
// A guard that has only ever passed has not been shown to be able to fail. Cases 1 and 2 are the
// literal wording that was live in COMPY_OVERVIEW.md on 2026-08-23, fed through the SAME
// findRetired() the real sweep uses — not a hand-built string matched against a bare regex, which
// is how `no-raw-select-guard` came to be falsifiable and blind at the same time.
describe("doc-truth guard: it fires on the wording that was actually live", () => {
  const claim = (id) => RETIRED_CLAIMS.find((c) => c.id === id);

  it("catches the dead price band, in both forms it appeared in", () => {
    const stub = (body) => findRetired(claim("pro-price-band-2026-08-22"), ["FAKE.md"], () => body);
    expect(stub("Compy Pro subscription (built dark, ~$3–4/mo or ~$25/yr, needs entity)")).toEqual(["FAKE.md:1"]);
    expect(stub("Compy Pro is scoped at ~$3-4/mo or ~$25/yr in the doctrine")).toEqual(["FAKE.md:1"]);
  });

  it("does NOT fire on the live price band", () => {
    const stub = (body) => findRetired(claim("pro-price-band-2026-08-22"), ["FAKE.md"], () => body);
    expect(stub("Compy Pro — $4.99/mo · $39/yr · $89 one-time lifetime")).toEqual([]);
  });

  it("respects the allow marker, so a doc can retire a claim by naming it", () => {
    const stub = (body) => findRetired(claim("pro-price-band-2026-08-22"), ["FAKE.md"], () => body);
    expect(stub(`the old ~$3-4/mo band is dead <!-- ${ALLOW_MARKER} -->`)).toEqual([]);
  });

  it("reports every offending line, not just the first", () => {
    const stub = (body) => findRetired(claim("pro-price-band-2026-08-22"), ["FAKE.md"], () => body);
    expect(stub("~$25/yr\nfiller\n~$3-4/mo")).toEqual(["FAKE.md:1", "FAKE.md:3"]);
  });
});
