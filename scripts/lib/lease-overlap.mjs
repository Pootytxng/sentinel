// #517: a push that writes a path another lane's live lease already holds is refused at the push.
//
// Collision rule 2 (docs/WORK_CONTROL.md): overlapping write scopes serialize, so the earlier lease
// goes first. Dispatch checks that once, at launch (tools/entry/scope-overlap.mjs), and a lane that scans
// and then claims is checking a snapshot. On 2026-09-23 the #452 part 2 lane scanned, #513 claimed
// src/surfaces/HomeHud.tsx five minutes later, #452 claimed the same file without re-scanning, and
// wrote it. Nothing refused: scripts/scope-drift-gate.mjs compares a push only with the pusher's OWN
// claim. This is the decision the push gate (scripts/lease-overlap-gate.mjs) makes over the leases
// that exist when the write leaves the machine. Nothing here reads GitHub or git.
//
// Seniority is per path, and it is measured from the lease, not from the newest comment. A lane that
// refreshes its claim restates its lease; it does not start a new one, so a refresh must not hand
// the path to whoever claimed it in between. And a lane that widens its claim onto a path somebody
// else already holds does not become that path's earlier holder by pointing at when its lease began.
// So a path is held since the oldest claim in the unbroken tail of the run (threadLease's claims
// since the last release) that covers it.
//
// Unknown means locked (collision rule 5). A thread that could not be read refuses the push, and so
// does the open-issue list. A live claim that declares no paths holds every path: its scope is
// unknown, and "we could not tell" must not print the same verdict as "disjoint". Expiry is an alarm,
// not a takeover (rule 6): an expired claim still holds its paths, and the refusal says it expired.
// Paths are matched with claim-scope.mjs, the one scope parser (#408).

import { claimExpiry } from "../../tools/entry/claim.mjs";
import { coversPath, normalizePattern, parseScopePatterns } from "./claim-scope.mjs";

/** The paths a claim declares, or [] when it declares none. */
export const declaredPaths = (claim) => parseScopePatterns(claim?.scope ?? "");

/** Does this claim hold `path`? A claim that declares no paths holds all of them (rule 5). */
export function holds(claim, path) {
  const patterns = declaredPaths(claim);
  return patterns.length === 0 || patterns.some((p) => coversPath(p, path));
}

/**
 * The claim `path` has been held since, on one thread: the oldest claim of the unbroken tail of
 * `run` that covers it. null when the live claim (the run's last entry) does not cover it, or when
 * there is no live claim at all.
 */
export function heldSince(run, path) {
  let since = null;
  for (let i = (run ?? []).length - 1; i >= 0 && holds(run[i], path); i--) since = run[i];
  return since;
}

/** `theirs` wins the path unless it was provably taken after `mine`. Unreadable time is earlier. */
const earlierOrSame = (theirs, mine) => !(Date.parse(theirs) > Date.parse(mine));

/**
 * The verdict, over strings.
 *
 * @param {object} f
 * @param {string[]} f.changed    the paths the push carries, repo-relative
 * @param {number|null} f.own     the pusher's issue; null = this checkout holds no lease
 * @param {Array<{number:number, run?:object[], unreadable?:boolean, why?:string}>} f.threads
 *        every open issue with a thread, as read: `run` from threadLease (claims carry postedAt,
 *        scope, expires and the comment url); `unreadable` when GitHub did not answer
 * @param {string|null} f.listError  the open-issue list itself could not be read
 * @param {Date} f.now
 * @returns {{ok:boolean, findings:object[], unreadable:object[], own:number|null, ownLive:boolean}}
 */
export function leaseOverlapVerdict({ changed = [], own = null, threads = [], listError = null, now = new Date() } = {}) {
  const paths = [...new Set(changed.map(normalizePattern).filter(Boolean))].sort();
  const unreadable = [];
  if (listError) unreadable.push({ number: null, why: `the open-issue list could not be read: ${listError}` });
  for (const t of threads) if (t.unreadable) unreadable.push({ number: t.number, why: t.why ?? "its thread could not be read" });

  const ownRun = threads.find((t) => t.number === own && !t.unreadable)?.run ?? [];
  const mine = (path) => heldSince(ownRun, path)?.postedAt ?? null;

  const findings = [];
  for (const t of threads) {
    if (t.unreadable || t.number === own || !t.run?.length) continue;
    const live = t.run.at(-1);
    const held = [];
    for (const path of paths) {
      const since = heldSince(t.run, path);
      if (!since) continue;
      const myStart = mine(path);
      if (myStart === null || earlierOrSame(since.postedAt, myStart)) held.push({ path, since: since.postedAt, sinceUrl: since.url ?? null, mine: myStart });
    }
    if (!held.length) continue;
    const expiresAt = claimExpiry(live.expires, { anchor: live.postedAt });
    findings.push({
      number: t.number,
      url: live.url ?? null,
      postedAt: live.postedAt,
      held,
      undeclared: declaredPaths(live).length === 0,
      expired: expiresAt !== null && expiresAt.getTime() < now.getTime() ? expiresAt.toISOString() : null,
    });
  }
  findings.sort((a, b) => a.number - b.number);
  return { ok: findings.length === 0 && unreadable.length === 0, findings, unreadable, own, ownLive: ownRun.length > 0 };
}

/** The refusal a lane is given: the issue, the claim's comment URL, and every overlapping path. */
export function renderLeaseOverlap(verdict, { base = "origin/main", changed = [] } = {}) {
  const head = `lease overlap (#517): ${changed.length} pushed path${changed.length === 1 ? "" : "s"} since ${base}, checked against every open issue's live lease`;
  const whose = verdict.own ? `#${verdict.own}${verdict.ownLive ? "" : " (no live claim)"}` : "no issue (this checkout holds no lease)";
  if (verdict.ok) return `${head}\nOK: no other lane holds a pushed path from earlier than ${whose}`;
  const lines = [head];
  for (const f of verdict.findings) {
    const tags = [f.undeclared ? "its claim declares no paths, so it holds every path (collision rule 5)" : null, f.expired ? `claim expired ${f.expired}; expiry is an alarm, not a takeover (collision rule 6)` : null].filter(Boolean);
    lines.push(`REFUSED: #${f.number} holds ${f.held.length} pushed path${f.held.length === 1 ? "" : "s"} — ${f.url ?? "(claim comment URL unavailable)"}${tags.length ? ` [${tags.join("; ")}]` : ""}`);
    for (const h of f.held) {
      const from = h.sinceUrl && h.sinceUrl !== f.url ? `${h.since}, ${h.sinceUrl}` : h.since;
      lines.push(`  ${h.path}  held by #${f.number} since ${from}; ${whose} ${h.mine ? `since ${h.mine}` : "does not hold it"}`);
    }
  }
  for (const u of verdict.unreadable) {
    lines.push(`REFUSED: ${u.number ? `#${u.number}` : "open issues"} — ${u.why}; an unknown lease is a locked lease (collision rule 5)`);
  }
  if (verdict.findings.length) {
    lines.push(
      "Overlapping scopes serialize, so the earlier lease goes first (collision rule 2): take these paths out of this push, or wait for that lane's `### Handoff` with `- Claim: released`.",
    );
  }
  if (verdict.unreadable.length) lines.push("Re-run the push once GitHub answers; a lease nobody could read cannot be proven released or disjoint.");
  return lines.join("\n");
}
