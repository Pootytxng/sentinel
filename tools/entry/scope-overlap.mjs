// #358: a dispatch whose Write scope overlaps another Active writer's is refused before anything is
// written. The measurement existed (scripts/lib/claim-scope.mjs, #352); nothing acted on it, and the
// two tempting ways to wire it both fail silently — pattern-versus-pattern for two globs, and reading
// a disclaimed path as a grant. This module is the decision over strings; gather.mjs collects the
// facts (the other Active items' posted claims, the tracked paths) and preflight.mjs turns the verdict
// into a row. Nothing here reads GitHub or git.
//
// Two tiers, deliberately (see claim-scope.mjs): `overlappingPairs` decides literal containment and
// abstains on glob-versus-glob; `overlappingFiles` decides globs exactly, against the paths that
// actually exist. A dispatch has no changed set yet, so the exact tier is fed the tracked paths of
// the base commit — `git ls-tree -r --name-only origin/main` — which is the set a glob can claim.
//
// Unknown means locked (collision rule 4): a task with no readable scope while another writer is
// live is refused, and so is a live writer whose claim declares no paths, because "we could not
// tell" and "they are disjoint" must not print the same verdict. A board row that says Active with
// no live claim behind it (none posted, released, or expired) is not a verified writer: it is named
// in the row, and refused only when the paths it did declare overlap — the board's staleness is a
// hygiene finding, not a licence to double-write.

import { joinScopeBullet, overlappingFiles, overlappingPairs, parseWriteScope, scopeBulletLines } from "../../scripts/lib/claim-scope.mjs";

/** The paths a scope sentence declares, through the one parser every reader shares. */
export function scopeFromText(text) {
  if (!text || typeof text !== "string") return [];
  return parseWriteScope(`- Write scope: ${text.trim()}`);
}

/**
 * The `Write scope` bullet of an issue body, as the text after the colon (continuation lines
 * included, up to the next bullet, heading or blank line) — or null when the body has no such
 * bullet. This is where a task's scope lives before its first claim is posted.
 *
 * The continuation rule itself is `joinScopeBullet`, shared with `parseClaim` since #399: this
 * reader's rule was already documented and correct, and the claim reader's was one line, so a
 * wrapped bullet meant the two disagreed about the same text. Neither owns the rule now.
 */
export function scopeTextFromBody(body) {
  if (!body || typeof body !== "string") return null;
  const lines = scopeBulletLines(body);
  // `- Write scope: …`, `- **Write scope:** …` and `- **Write scope**: …` are all the same bullet.
  const bullet = /^\s*[-*]\s*(?:\*\*|__)?\s*Write scope\s*:?\s*(?:\*\*|__)?\s*:?\s*/i;
  const start = lines.findIndex((l) => bullet.test(l) && /:/.test(l));
  if (start < 0) return null;
  const text = joinScopeBullet(lines, start, lines[start].replace(bullet, ""));
  return text || null;
}

const hasGlob = (p) => /[*?]/.test(p);
const who = (o) => `#${o.number}${o.lane ? ` (${o.lane})` : ""}`;
const isLive = (o) => o.live !== false && o.expired !== true;
const staleNote = (o) => `${who(o)} (${o.live === false ? "no live claim" : `claim expired${o.expires ? ` ${o.expires}` : ""}`})`;

function compare(mine, theirs, files) {
  const pairs = overlappingPairs(mine, theirs);
  if (Array.isArray(files)) return { pairs, shared: overlappingFiles(mine, theirs, files), undecidable: false };
  // Two globs are decided only against real paths, and there are none to decide against.
  return { pairs, shared: [], undecidable: pairs.length === 0 && [...mine, ...theirs].some(hasGlob) };
}

/**
 * @param {object} f
 * @param {string[]|null} f.mine     this task's declared paths; null/[] = undeclared
 * @param {Array<{number:number, lane?:string|null, scope:string[]|null, live?:boolean, expired?:boolean, expires?:string|null}>} f.others
 *        every OTHER Active item: the paths its claim declares, and whether that claim is live
 *        (absent `live`/`expired` = a live claim, which is the conservative reading)
 * @param {string[]|null} f.files    the tracked paths a glob can claim; null = unavailable
 * @returns {{ok:boolean, reason:string, findings:Array<{number, lane, pairs:string[][], files:string[], stale:boolean}>, unknown:Array<{number, lane, why:string}>, stale:Array<{number, lane}>, undeclared:boolean}}
 */
export function scopeOverlapVerdict({ mine = null, others = [], files = null } = {}) {
  const known = (others ?? []).filter((o) => o && Number.isFinite(Number(o.number)));
  const writers = known.filter(isLive);
  const stale = known.filter((o) => !isLive(o));
  const declared = Array.isArray(mine) && mine.length > 0;
  const staleText = stale.length ? `; stale Active on the board, not a writer: ${stale.map(staleNote).join(", ")}` : "";
  const staleOut = stale.map((o) => ({ number: o.number, lane: o.lane ?? null }));

  if (!declared) {
    if (writers.length === 0) {
      return {
        ok: true,
        reason: `no other live writer; this task declares no write scope — narrow it before the first write${staleText}`,
        findings: [],
        unknown: [],
        stale: staleOut,
        undeclared: true,
      };
    }
    return {
      ok: false,
      reason: `this task declares no write scope while ${writers.map(who).join(", ")} ${writers.length === 1 ? "is" : "are"} live — unknown means locked (collision rule 4)${staleText}`,
      findings: [],
      unknown: [],
      stale: staleOut,
      undeclared: true,
    };
  }

  const findings = [];
  const unknown = [];
  for (const o of writers) {
    const theirs = Array.isArray(o.scope) ? o.scope.filter(Boolean) : [];
    if (theirs.length === 0) {
      unknown.push({ number: o.number, lane: o.lane ?? null, why: "its claim declares no paths" });
      continue;
    }
    const { pairs, shared, undecidable } = compare(mine, theirs, files);
    if (undecidable) {
      unknown.push({ number: o.number, lane: o.lane ?? null, why: "globbed scopes, and no tracked-path list to decide them" });
      continue;
    }
    if (pairs.length || shared.length) findings.push({ number: o.number, lane: o.lane ?? null, pairs, files: shared, stale: false });
  }
  // A stale row's declared paths still count when they overlap: the honest cure is to renew or
  // retire that claim, never to write past it.
  for (const o of stale) {
    const theirs = Array.isArray(o.scope) ? o.scope.filter(Boolean) : [];
    if (theirs.length === 0) continue;
    const { pairs, shared } = compare(mine, theirs, files);
    if (pairs.length || shared.length) findings.push({ number: o.number, lane: o.lane ?? null, pairs, files: shared, stale: true });
  }

  const ok = findings.length === 0 && unknown.length === 0;
  const parts = [];
  for (const f of findings) {
    const bits = [];
    if (f.pairs.length) bits.push(f.pairs.map(([a, b]) => `${a} ∩ ${b}`).join(", "));
    if (f.files.length) bits.push(`${f.files.length} shared file${f.files.length === 1 ? "" : "s"}: ${f.files.slice(0, 3).join(", ")}${f.files.length > 3 ? ", …" : ""}`);
    parts.push(`${f.stale ? staleNote(stale.find((s) => s.number === f.number) ?? f) : who(f)} — ${bits.join("; ")}`);
  }
  for (const u of unknown) parts.push(`${who(u)} — ${u.why}`);
  return {
    ok,
    reason: ok ? `${writers.length ? `disjoint from ${writers.map(who).join(", ")}` : "no other live writer"}${staleText}` : parts.join(" | "),
    findings,
    unknown,
    stale: staleOut,
    undeclared: false,
  };
}

/** The cure, in the sentence a refused lane deserves. */
export function overlapRemediation(verdict) {
  if (!verdict || verdict.ok) return null;
  if (verdict.undeclared) {
    return "Declare the Write scope — pass --scope \"`path`, `path`\" to the launcher, or add a `- Write scope:` bullet naming backticked paths to the issue body — then re-run.";
  }
  const lines = [];
  if (verdict.findings.some((f) => !f.stale) || verdict.unknown.length) {
    lines.push("Overlapping scopes serialize (collision rule 3): narrow this task's scope to paths the other writer does not claim, or wait for its handoff.");
  }
  const staleHits = verdict.findings.filter((f) => f.stale);
  if (staleHits.length) {
    lines.push(`${staleHits.map(who).join(", ")}: the claim is not live but its declared paths overlap — renew it with a current scope if that lane is still writing, or retire it (handoff comment, board status off Active) if it is done.`);
  }
  if (verdict.findings.some((f) => f.pairs.some(([a, b]) => a === b && hasGlob(a)))) {
    lines.push("A shared glob claims every file it matches — name the one file this lane owns (its own docs/dispositions/<ref>.json, not docs/dispositions/*.json).");
  }
  if (verdict.unknown.length) {
    lines.push(`Ask ${verdict.unknown.map(who).join(", ")} to renew its claim with a Write scope that names paths; an unreadable scope cannot be proven disjoint.`);
  }
  return lines.join(" ");
}
