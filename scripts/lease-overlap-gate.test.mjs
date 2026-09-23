// Guard for the push-time lease check (#517): scripts/lib/lease-overlap.mjs decides, and
// scripts/lease-overlap-gate.mjs is the push-gate step verify-local.ps1 runs on that decision.
//
// The incident it answers, 2026-09-23: #513 claimed src/surfaces/HomeHud.tsx at 04:39:55Z, the #452
// part 2 lane claimed the same file at 04:43:18Z on a scan taken five minutes earlier, and wrote it.
// No gate compared a push with another lane's lease, so it was caught by eye in a dev build.
//
// No live `gh` here. The threads are the real #452 and #513 threads, recorded verbatim in
// scripts/fixtures/lease-overlap/incident-2026-09-23.json, and served by a fake `gh` that answers the
// gate's own REST reads "as of" a moment in that morning: only the comments posted by then exist.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { threadLease } from "../tools/entry/claim.mjs";
import { GH_READ_TIMEOUT_MS } from "../tools/entry/gather.mjs";
import { asyncGhReader, gate, parseArgs, pushedPaths, readLeases, render } from "./lease-overlap-gate.mjs";
import { heldSince, leaseOverlapVerdict, renderLeaseOverlap } from "./lib/lease-overlap.mjs";

const ROOT = resolve(process.cwd());
const read = (rel) => readFileSync(join(ROOT, ...rel.split("/")), "utf8");
const FIXTURE = JSON.parse(read("scripts/fixtures/lease-overlap/incident-2026-09-23.json"));

const URL_513 = "https://github.com/Pootytxng/sentinel/issues/513#issuecomment-5789162469";
const URL_452_PART2 = "https://github.com/Pootytxng/sentinel/issues/452#issuecomment-5789188709";
const HOMEHUD = "src/surfaces/HomeHud.tsx";
const HOME_JSON = ["src/i18n/locales/en/home.json", "src/i18n/locales/zh-CN/home.json"];

/**
 * A `gh` that answers the gate's two REST reads from the recorded threads, as they stood at `asOf`.
 * `fail` maps an issue number to the error its thread read throws, as execFile would.
 */
function fakeGh({ asOf, threads = FIXTURE.threads, fail = {}, listFails = null, calls = [] }) {
  const upTo = (n) => (threads[n] ?? []).filter((c) => Date.parse(c.created_at) <= Date.parse(asOf));
  return async (args) => {
    calls.push(args);
    const path = args.find((a) => a.startsWith("repos/"));
    if (/\/issues\?state=open/.test(path)) {
      if (listFails) throw listFails;
      return Object.keys(threads)
        .map((n) => JSON.stringify({ number: Number(n), comments: upTo(n).length }))
        .join("\n");
    }
    const n = /\/issues\/(\d+)\/comments/.exec(path)?.[1];
    if (fail[n]) throw fail[n];
    return upTo(n).map((c) => JSON.stringify(c)).join("\n");
  };
}

const timedOut = () => Object.assign(new Error("Command failed: gh api"), { killed: true, signal: "SIGTERM" });
const fakeGit = (paths) => (cwd, args) => (args[0] === "rev-parse" ? "0".repeat(40) : paths.join("\0"));
const noLineage = () => null;

async function pushAs({ own, asOf, paths, ...rest }) {
  return gate({ issue: own, git: fakeGit(paths), lineage: noLineage, gh: fakeGh({ asOf, ...rest }), now: new Date(asOf) });
}

describe("the five cases, on the recorded 2026-09-23 threads", () => {
  it("refuses an overlap: #452 pushing HomeHud at 04:50Z, which #513 has held since 04:39:55Z", async () => {
    const r = await pushAs({ own: 452, asOf: "2026-09-23T04:50:00Z", paths: [HOMEHUD, ...HOME_JSON] });
    expect(r.ok).toBe(false);
    expect(r.verdict.findings).toHaveLength(1);
    const [f] = r.verdict.findings;
    expect(f).toMatchObject({ number: 513, url: URL_513 });
    expect(f.held.map((h) => h.path)).toEqual([HOMEHUD, ...HOME_JSON].sort());
    // The message names the issue, the claim comment URL and every overlapping path.
    const text = render(r);
    expect(text).toContain("REFUSED: #513");
    expect(text).toContain(URL_513);
    for (const p of [HOMEHUD, ...HOME_JSON]) expect(text).toContain(p);
  });

  it("ignores a released claim: #452's 00:21Z claim on Benchmark.tsx blocks at 02:00Z and not after its 02:31Z release", async () => {
    const paths = ["src/surfaces/Benchmark.tsx"];
    const live = await pushAs({ own: 513, asOf: "2026-09-23T02:00:00Z", paths });
    expect(live.ok).toBe(false);
    expect(live.verdict.findings.map((f) => f.number)).toEqual([452]);
    const released = await pushAs({ own: 513, asOf: "2026-09-23T03:00:00Z", paths });
    expect(released.ok).toBe(true);
  });

  it("ignores the pusher's own issue: #513's claim does not block #513, and does block anyone else", async () => {
    const own = await pushAs({ own: 513, asOf: "2026-09-23T04:40:00Z", paths: [HOMEHUD] });
    expect(own.ok).toBe(true);
    const other = await pushAs({ own: null, asOf: "2026-09-23T04:40:00Z", paths: [HOMEHUD] });
    expect(other.verdict.findings.map((f) => f.number)).toEqual([513]);
  });

  it("does not let a later-timestamped claim block the earlier holder: #452's 04:43Z claim leaves #513 free", async () => {
    const r = await pushAs({ own: 513, asOf: "2026-09-23T04:50:00Z", paths: [HOMEHUD, ...HOME_JSON] });
    expect(r.ok).toBe(true);
    // #452 does hold those paths at 04:50; it is simply later.
    expect(heldSince(threadRun(452, "2026-09-23T04:50:00Z"), HOMEHUD)?.postedAt).toBe("2026-09-23T04:43:18Z");
  });

  it("refuses when a thread cannot be read, naming it: an unknown lease is a locked one", async () => {
    const r = await pushAs({ own: 452, asOf: "2026-09-23T05:10:00Z", paths: ["src/surfaces/HomeV2.tsx"], fail: { 513: timedOut() } });
    expect(r.ok).toBe(false);
    expect(r.verdict.findings).toEqual([]);
    expect(r.verdict.unreadable).toEqual([{ number: 513, why: `its thread could not be read (no answer in ${GH_READ_TIMEOUT_MS / 1000} s)` }]);
    expect(render(r)).toMatch(/REFUSED: #513 .*collision rule 5/);
  });
});

/** One recorded thread's claim run as it stood at `asOf`, folded the way the gate folds it. */
function threadRun(n, asOf) {
  const comments = FIXTURE.threads[n].filter((c) => Date.parse(c.created_at) <= Date.parse(asOf));
  return threadLease(comments.map((c) => ({ body: c.body, createdAt: c.created_at, url: c.html_url }))).run;
}

describe("replay: what the gate would have said to #452 that morning", () => {
  it("after #452 narrowed its claim at 05:03Z, a push still carrying HomeHud is refused: #452 no longer holds it at all", async () => {
    const r = await pushAs({ own: 452, asOf: "2026-09-23T05:10:00Z", paths: [HOMEHUD, "src/surfaces/HomeV2.tsx"] });
    expect(r.verdict.findings.map((f) => [f.number, f.held.map((h) => [h.path, h.mine])])).toEqual([[513, [[HOMEHUD, null]]]]);
    expect(render(r)).toContain("#452 does not hold it");
  });

  it("the narrowed #452 push that leaves HomeHud alone passes", async () => {
    const r = await pushAs({ own: 452, asOf: "2026-09-23T05:10:00Z", paths: ["src/surfaces/HomeV2.tsx", "src/surfaces/HomeConsole.tsx"] });
    expect(r.ok).toBe(true);
  });

  it("dates #452's hold on HomeV2 from its 04:43Z claim, through the 05:03Z refresh, and links the claim it started in", async () => {
    const r = await pushAs({ own: null, asOf: "2026-09-23T05:10:00Z", paths: ["src/surfaces/HomeV2.tsx"] });
    const [f] = r.verdict.findings;
    expect(f.url).toBe("https://github.com/Pootytxng/sentinel/issues/452#issuecomment-5789371265");
    expect(f.held).toEqual([{ path: "src/surfaces/HomeV2.tsx", since: "2026-09-23T04:43:18Z", sinceUrl: URL_452_PART2, mine: null }]);
  });
});

describe("leaseOverlapVerdict, over strings", () => {
  const claim = (postedAt, scope, extra = {}) => ({ postedAt, scope, url: `u:${postedAt}`, ...extra });
  const A = "src/a.ts";

  it("a refresh does not reset seniority: a path held across two claims is held from the first", () => {
    const run = [claim("2026-01-01T00:00:00Z", "`src/a.ts`"), claim("2026-01-02T00:00:00Z", "`src/a.ts`, `src/b.ts`")];
    expect(heldSince(run, A).postedAt).toBe("2026-01-01T00:00:00Z");
    expect(heldSince(run, "src/b.ts").postedAt).toBe("2026-01-02T00:00:00Z");
    expect(heldSince(run, "src/c.ts")).toBeNull();
  });

  it("a gap breaks the hold: a path dropped and re-claimed is held from the re-claim", () => {
    const run = [claim("2026-01-01T00:00:00Z", "`src/a.ts`"), claim("2026-01-02T00:00:00Z", "`src/b.ts`"), claim("2026-01-03T00:00:00Z", "`src/a.ts`")];
    expect(heldSince(run, A).postedAt).toBe("2026-01-03T00:00:00Z");
  });

  it("widening onto a held path does not make the widener its earlier holder", () => {
    const threads = [
      { number: 1, run: [claim("2026-01-01T00:00:00Z", "`src/b.ts`"), claim("2026-01-03T00:00:00Z", "`src/b.ts`, `src/a.ts`")] },
      { number: 2, run: [claim("2026-01-02T00:00:00Z", "`src/a.ts`")] },
    ];
    expect(leaseOverlapVerdict({ changed: [A], own: 1, threads }).findings.map((f) => f.number)).toEqual([2]);
    expect(leaseOverlapVerdict({ changed: [A], own: 2, threads }).ok).toBe(true);
  });

  it("covers a file through a claimed directory and a glob, through claim-scope's coversPath", () => {
    const threads = [{ number: 9, run: [claim("2026-01-01T00:00:00Z", "`src/`, `docs/**/*.md`")] }];
    expect(leaseOverlapVerdict({ changed: ["src/x/y.ts", "docs/a/b.md", "README.md"], own: null, threads }).findings[0].held.map((h) => h.path)).toEqual(["docs/a/b.md", "src/x/y.ts"]);
  });

  it("a tie goes to the other lane: two claims in the same second cannot both write", () => {
    const threads = [
      { number: 1, run: [claim("2026-01-01T00:00:00Z", "`src/a.ts`")] },
      { number: 2, run: [claim("2026-01-01T00:00:00Z", "`src/a.ts`")] },
    ];
    expect(leaseOverlapVerdict({ changed: [A], own: 1, threads }).ok).toBe(false);
    expect(leaseOverlapVerdict({ changed: [A], own: 2, threads }).ok).toBe(false);
  });

  it("an expired claim still holds its paths, and the refusal says it expired (rule 6)", () => {
    const threads = [{ number: 3, run: [claim("2026-01-01T00:00:00Z", "`src/a.ts`", { expires: "2026-01-01T12:00:00Z (alarm only)" })] }];
    const v = leaseOverlapVerdict({ changed: [A], own: null, threads, now: new Date("2026-02-01T00:00:00Z") });
    expect(v.findings[0].expired).toBe("2026-01-01T12:00:00.000Z");
    expect(renderLeaseOverlap(v, { changed: [A] })).toContain("expiry is an alarm, not a takeover");
  });

  it("a live claim that declares no paths holds every path: its scope is unknown (rule 5)", () => {
    const threads = [{ number: 4, run: [claim("2026-01-01T00:00:00Z", "the home surfaces")] }];
    const v = leaseOverlapVerdict({ changed: [A], own: null, threads });
    expect(v.findings[0]).toMatchObject({ number: 4, undeclared: true });
    // ...but it is still a lease with a date, so it cannot block an earlier holder.
    const earlier = [...threads, { number: 5, run: [claim("2025-12-31T00:00:00Z", "`src/a.ts`")] }];
    expect(leaseOverlapVerdict({ changed: [A], own: 5, threads: earlier }).ok).toBe(true);
  });

  it("an unreadable own thread refuses too: this lane's seniority is unknown", () => {
    const v = leaseOverlapVerdict({ changed: [A], own: 7, threads: [{ number: 7, unreadable: true }] });
    expect(v.ok).toBe(false);
    expect(v.unreadable.map((u) => u.number)).toEqual([7]);
  });

  it("an unreadable open-issue list refuses, with no issue to name", () => {
    const v = leaseOverlapVerdict({ changed: [A], listError: "HTTP 502" });
    expect(v.ok).toBe(false);
    expect(renderLeaseOverlap(v, { changed: [A] })).toContain("REFUSED: open issues — the open-issue list could not be read: HTTP 502");
  });
});

describe("the reads: bounded, concurrent, and never a pass on failure", () => {
  it("hands every gh read GH_READ_TIMEOUT_MS through ghReader() (#474, #514)", async () => {
    const seen = [];
    const exec = async (cmd, args, opts) => {
      seen.push({ cmd, opts });
      return fakeGh({ asOf: "2026-09-23T05:10:00Z" })(args);
    };
    const { threads, listError } = await readLeases({ gh: asyncGhReader({ exec }) });
    expect(listError).toBeNull();
    expect(threads.map((t) => t.number)).toEqual([452, 513]);
    expect(seen).toHaveLength(3);
    for (const s of seen) expect(s).toMatchObject({ cmd: "gh", opts: { timeout: GH_READ_TIMEOUT_MS } });
    expect(GH_READ_TIMEOUT_MS).toBe(20_000);
  });

  it("spawns gh nowhere else: no execFile/execFileSync of gh outside ghReader", () => {
    const src = read("scripts/lease-overlap-gate.mjs");
    expect(src).toContain('from "../tools/entry/gather.mjs"');
    expect(src).not.toMatch(/["']gh["']/);
  });

  it("skips an issue with no comments, and reads none at all for an empty push", async () => {
    const calls = [];
    const empty = await gate({ git: fakeGit([]), lineage: noLineage, gh: fakeGh({ asOf: "2026-09-23T05:10:00Z", calls }) });
    expect(empty.ok).toBe(true);
    expect(calls).toEqual([]);
    const r = await pushAs({ own: 452, asOf: "2026-09-23T04:00:00Z", paths: [HOMEHUD], calls });
    // At 04:00 #513 has no comments yet: only the list and #452 were read.
    expect(calls.map((a) => a.find((x) => x.startsWith("repos/")))).toEqual([
      "repos/Pootytxng/sentinel/issues?state=open&per_page=100",
      "repos/Pootytxng/sentinel/issues/452/comments?per_page=100",
    ]);
    expect(r.ok).toBe(true);
  });

  it("refuses when the open-issue list times out, and when a thread answers with something that is not JSON", async () => {
    const list = await pushAs({ own: 452, asOf: "2026-09-23T05:10:00Z", paths: [HOMEHUD], listFails: timedOut() });
    expect(list.ok).toBe(false);
    expect(render(list)).toContain(`no answer in ${GH_READ_TIMEOUT_MS / 1000} s`);
    const garbled = { ...FIXTURE.threads };
    const gh = fakeGh({ asOf: "2026-09-23T05:10:00Z", threads: garbled });
    const bad = async (args) => (args.some((a) => a.includes("/issues/513/")) ? "<html>502</html>" : gh(args));
    const r = await gate({ issue: 452, git: fakeGit(["src/surfaces/HomeV2.tsx"]), lineage: noLineage, gh: bad });
    expect(r.verdict.unreadable.map((u) => u.number)).toEqual([513]);
  });

  it("takes this folder's issue from its session record when --issue is absent", async () => {
    const r = await gate({ git: fakeGit([HOMEHUD]), lineage: () => ({ issue: 513 }), gh: fakeGh({ asOf: "2026-09-23T04:50:00Z" }) });
    expect(r.verdict.own).toBe(513);
    expect(r.ok).toBe(true);
  });

  it("refuses when the base does not resolve: an unmeasured push is not a clean one", async () => {
    const git = (cwd, args) => {
      if (args[0] === "rev-parse") throw new Error("fatal: Needed a single revision");
      return "";
    };
    const r = await gate({ git, lineage: noLineage, gh: fakeGh({ asOf: "2026-09-23T05:10:00Z" }) });
    expect(r.ok).toBe(false);
    expect(render(r)).toContain("origin/main is not a commit here");
  });

  it("parses its arguments", () => {
    expect(parseArgs(["--issue", "517", "--base", "origin/x", "--json"])).toMatchObject({ issue: 517, base: "origin/x", json: true });
    expect(() => parseArgs(["--nope"])).toThrow(/unknown argument/);
  });
});

describe("pushedPaths, over a real temporary repository", () => {
  let dir;
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "lease-overlap-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "t");
    writeFileSync(join(dir, "held.ts"), "a\n");
    writeFileSync(join(dir, "kept.ts"), "k\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("mv", "held.ts", "moved.ts");
    git("commit", "-q", "-m", "rename");
    writeFileSync(join(dir, "uncommitted.ts"), "u\n");
  }, 60_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reports both names of a rename, and nothing uncommitted: a push carries commits", () => {
    expect(pushedPaths({ cwd: dir })).toEqual(["held.ts", "moved.ts"]);
  });

  it("returns null for a base that is not a commit", () => {
    expect(pushedPaths({ cwd: dir, base: "origin/nope" })).toBeNull();
  });
});

describe("residency: verify-local.ps1 runs the gate before the test suite", () => {
  const gateCode = read("scripts/verify-local.ps1")
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");

  it("invokes scripts/lease-overlap-gate.mjs through Invoke-Check, with no argument that could narrow it", () => {
    expect(gateCode).toMatch(/Invoke-Check -Name "lease overlap \(#517\)" -Command \$node -Arguments @\("scripts\/lease-overlap-gate\.mjs"\)\s*$/m);
  });

  it("runs it after the scope-drift gate and before the frontend tests", () => {
    const at = gateCode.indexOf("lease-overlap-gate.mjs");
    expect(at).toBeGreaterThan(gateCode.indexOf("scope-drift-gate.mjs"));
    expect(at).toBeLessThan(gateCode.indexOf('"frontend tests"'));
  });

  it("the gate decides through the shared fold and the one scope parser", () => {
    expect(existsSync(join(ROOT, "scripts", "lease-overlap-gate.mjs"))).toBe(true);
    expect(read("scripts/lease-overlap-gate.mjs")).toContain('import { threadLease } from "../tools/entry/claim.mjs"');
    expect(read("scripts/lib/lease-overlap.mjs")).toContain('from "./claim-scope.mjs"');
  });
});
