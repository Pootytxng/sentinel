// Guard for #468: the scope-drift hook's CLI asks the issue thread once per issue per ten minutes,
// whatever the thread answers.
//
// claimFor caches only a live claim with a scope. Every other answer -- a released claim, an issue
// never claimed, a claim with no scope, a GitHub that does not answer -- left nothing behind, so the
// hook asked the thread again after the next tool call. Measured on #468: about 0.4 s and one GraphQL
// request per call, or the hook's whole 10 s timeout while GitHub hangs. The fix wraps the CLI's
// reader in the library's boundedThread. The binding is in a hook entrypoint, which is owner-hands
// (#368), so it ships as a patch. The apply-check keeps the patch applicable until it lands; the tests
// behind `skipIf` run from the moment it has, and hold the hook to what it already said: through the
// bound it decides exactly what it decided through the raw reader, and only asks less often.
//
// They live in their own file because tools/entry/scope-drift-check.test.mjs is under #465's lease.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { canonicalizePath, writeLineage } from "../../.claude/hooks/session-root-assert.mjs";
import { claimFor, run } from "../../.claude/hooks/scope-drift-check.mjs";
// The whole module too, for an export that exists only once the owner applies the #468 patch.
import * as hook from "../../.claude/hooks/scope-drift-check.mjs";
import { CACHE_TTL_MS, readClaimCache, writeClaimCache } from "../../scripts/lib/scope-drift.mjs";

const REPO = join(import.meta.dirname, "..", "..");
const PATCH = join(REPO, "docs", "superpowers", "specs", "2026-09-18-scope-drift-hook-thread-bound.patch");
const applied = typeof hook.cliThread === "function";
const ISSUE = 468;
const T0 = new Date("2026-09-18T06:00:00Z");
const STALE = new Date(T0.getTime() - CACHE_TTL_MS - 60_000);
// One tool call after another: inside the TTL, just before its edge, just past it, inside the next.
const TIMELINE = [0, 1000, 5 * 60_000, CACHE_TTL_MS - 1000, CACHE_TTL_MS + 1000, 15 * 60_000];

// Every way a thread read comes back. Only the last is a claim the hook caches itself.
const READS = {
  "a released claim": () => ({ claim: null, handoff: { released: true, postedAt: "2026-09-18T03:29:00Z" }, unreadable: false }),
  "a thread that never held a claim": () => ({ claim: null, handoff: null, unreadable: false }),
  "a live claim with no scope text": () => ({ claim: { scope: null, folder: null, branch: null }, handoff: null, unreadable: false }),
  "an unreadable thread": () => ({ claim: null, handoff: null, unreadable: true }),
  "a thread that throws": () => {
    throw new Error("offline");
  },
  "a thread that answers nothing": () => undefined,
  "a live claim": () => ({ claim: { scope: "`docs/`", folder: null, branch: null }, handoff: null, unreadable: false }),
};
const SCOPED = "a live claim";

/** `answer`, counting the asks. */
function counted(answer) {
  const reader = (issue) => {
    reader.asked += 1;
    return answer(issue);
  };
  reader.asked = 0;
  return reader;
}

describe("#468: the scope-drift hook asks the thread once per issue per ten minutes, whatever it answers", () => {
  let base;
  const scratch = () => mkdtempSync(join(base, "c-"));
  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "compy-drift468-"));
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it("the owner-hand patch still applies to the hook as it is — and is gone once applied", () => {
    if (applied) {
      expect(existsSync(PATCH), "the patch is spent: delete it in the same commit that applies it").toBe(false);
      return;
    }
    expect(existsSync(PATCH), "the patch this block names must exist until it is applied").toBe(true);
    expect(() => execFileSync("git", ["apply", "--check", PATCH], { cwd: REPO, stdio: "pipe" })).not.toThrow();
  });

  describe.skipIf(!applied)("once applied", () => {
    it("the CLI hands run() the bounded reader, and no longer claims a bound it did not have", () => {
      const src = readFileSync(join(REPO, ".claude", "hooks", "scope-drift-check.mjs"), "utf8");
      expect(src).toContain("thread: cliThread({ read: readIssueThread })");
      expect(src).not.toContain("thread: readIssueThread }");
      expect(src).not.toContain("none when GitHub is down");
    });

    it("keeps what it was told beside the claim cache it was handed", () => {
      const cacheDir = scratch();
      const read = counted(READS["a released claim"]);
      hook.cliThread({ read, cacheDir, now: T0 })(ISSUE);
      hook.cliThread({ read, cacheDir, now: new Date(T0.getTime() + 1000) })(ISSUE);
      expect(read.asked).toBe(1);
      expect(existsSync(join(cacheDir, `thread-${ISSUE}.json`))).toBe(true);
    });

    // claimFor through the bound against claimFor through the raw reader: every read, from every cache
    // state, at every step of the timeline. The raw side is the control -- it shows the asks the bound
    // removes are real.
    it("claimFor reads every thread exactly as it did through the raw reader, from every cache state, and asks less", () => {
      const posture = (dir, c) => ({
        vacant: hook.VACANT !== undefined && c === hook.VACANT,
        scope: c?.scope ?? null,
        stale: Boolean(c?.stale),
        cacheKept: readClaimCache({ issue: ISSUE, dir }) !== null,
      });
      for (const [readName, answer] of Object.entries(READS)) {
        for (const [cacheName, cachedAt] of Object.entries({ "no cache": null, "a stale cache": STALE, "a fresh cache": T0 })) {
          const name = `${cacheName}, ${readName}`;
          const rawDir = scratch();
          const boundDir = scratch();
          for (const dir of [rawDir, boundDir]) if (cachedAt) writeClaimCache({ issue: ISSUE, scopeText: "`docs/`" }, { dir, now: cachedAt });
          const raw = counted(answer);
          const bound = counted(answer);
          for (const ms of TIMELINE) {
            const now = new Date(T0.getTime() + ms);
            const viaRaw = claimFor({ issue: ISSUE, cacheDir: rawDir, now, thread: raw });
            const viaBound = claimFor({ issue: ISSUE, cacheDir: boundDir, now, thread: hook.cliThread({ read: bound, cacheDir: boundDir, now }) });
            expect(posture(boundDir, viaBound), `${name}, +${ms} ms`).toEqual(posture(rawDir, viaRaw));
          }
          expect(bound.asked, name).toBeLessThanOrEqual(raw.asked);
          if (readName !== SCOPED) expect(bound.asked, name).toBeLessThanOrEqual(2);
          if (readName !== SCOPED && cachedAt !== T0) expect(raw.asked, `${name}: the control`).toBe(TIMELINE.length);
        }
      }
    });

    // The hook end to end, as a lane that has just posted its Handoff meets it: a session record that
    // still names the issue, the released claim's scope still cached, and a change outside it.
    it("run() says the same thing through the bound after every tool call, and asks twice in fifteen minutes instead of six times", () => {
      const lineageDir = scratch();
      const root = scratch();
      writeLineage(
        { issue: ISSUE, folder: canonicalizePath(root), branch: "lane/x", sessionId: "s-468", lastSeenAt: T0.toISOString(), expiresAt: new Date(T0.getTime() + 3_600_000).toISOString() },
        { dir: lineageDir },
      );
      const git = (cwd, args) => (args[0] === "status" ? "?? src/x.ts\0" : "");
      const input = { session_id: "s-468", tool_name: "Bash", tool_input: { command: "echo" }, cwd: root };
      const hookAt = (now, cacheDir, thread) => run({ hookInput: input, env: { CLAUDE_PROJECT_DIR: root }, dir: lineageDir, cacheDir, now, git, thread });
      for (const [readName, answer] of Object.entries(READS)) {
        const rawDir = scratch();
        const boundDir = scratch();
        for (const dir of [rawDir, boundDir]) writeClaimCache({ issue: ISSUE, scopeText: "`docs/`", folder: root, branch: "lane/x" }, { dir, now: STALE });
        const raw = counted(answer);
        const bound = counted(answer);
        const said = [];
        for (const ms of TIMELINE) {
          const now = new Date(T0.getTime() + ms);
          const viaRaw = hookAt(now, rawDir, raw);
          const viaBound = hookAt(now, boundDir, hook.cliThread({ read: bound, cacheDir: boundDir, now }));
          expect(viaBound, `${readName}, +${ms} ms`).toBe(viaRaw);
          said.push(viaRaw);
        }
        expect(raw.asked, `${readName}: the control`).toBe(readName === SCOPED ? 2 : TIMELINE.length);
        expect(bound.asked, readName).toBe(2);
        // The control for the comparison: this setup does say something, so equal outputs are not
        // two silences.
        if (readName === SCOPED || readName === "an unreadable thread") expect(said.filter(Boolean).length, readName).toBeGreaterThan(0);
      }
    });

    it("a hook killed mid-ask leaves the thread marked unreadable, so the next tool call does not wait on GitHub", () => {
      const cacheDir = scratch();
      writeClaimCache({ issue: ISSUE, scopeText: "`docs/`" }, { dir: cacheDir, now: STALE });
      const next = counted(READS["a released claim"]);
      let during = null;
      const slow = counted(() => {
        // A second tool call's hook, while the first is still waiting on GitHub.
        const now = new Date(T0.getTime() + 1000);
        during = claimFor({ issue: ISSUE, cacheDir, now, thread: hook.cliThread({ read: next, cacheDir, now }) });
        throw new Error("killed at the hook's timeout");
      });
      claimFor({ issue: ISSUE, cacheDir, now: T0, thread: hook.cliThread({ read: slow, cacheDir, now: T0 }) });
      expect(next.asked).toBe(0);
      expect(during?.scope).toEqual(["docs"]);
      expect(during?.stale).toBe(true);
      // ...and neither does the call after it.
      const now = new Date(T0.getTime() + 60_000);
      claimFor({ issue: ISSUE, cacheDir, now, thread: hook.cliThread({ read: next, cacheDir, now }) });
      expect(next.asked).toBe(0);
    });
  });
});
