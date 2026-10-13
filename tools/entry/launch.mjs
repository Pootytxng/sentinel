// The launch sequence, in the order that makes a half-finished run recoverable (spec §7):
//
//   preliminary verdict -> [refresh -> final verdict] -> worktree -> claim -> token -> overlay -> (window)
//
// Every prefix of that is a legal state with a printed next command. Nothing before a verdict
// writes anything at all, so a REFUSE leaves the machine exactly as it found it.
//
// The bracketed stage runs ONLY when a worktree is to be created, and only after the preliminary
// verdict passed (spec §5.6, #21). Creating needs a current base, refreshing one is a fetch, and a
// fetch between the check and the use is precisely what let the launcher verify commit A and create
// commit B. So the fetch is staged: it touches remote-tracking refs and the object store only — no
// worktree, no branch, no claim, no file — and preflight then runs AGAIN, in full, against the
// pinned commit that will actually be used. The last verdict before any write is a complete one.
//
// Prints one JSON object on stdout for the launcher to consume. Human-facing narration goes to
// stderr so the two never get mixed up.
//
// `--renew --issue N --session <id>` is the other entry (#648): it renews the lease a session already
// holds, through the same claim step, and starts nothing. See `renew` below.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { userInfo } from "node:os";
import { basename, dirname, join, win32 } from "node:path";
import {
  FULL_SHA,
  HOST_DIR,
  REPO,
  gatherFacts,
  loadPolicy,
  readBoard,
  readProjectIds,
  refetchSnapshotFacts,
  refreshCreateBase,
  CODE_ROOT,
} from "./gather.mjs";
import { CALLER_MAX_HOPS, callerWitness, isIdentified, isInstallerProgram, isSessionProgram, reconcile, reconcileHolder, selectTask } from "./preflight.mjs";
import { classifyProcesses, WATCHED } from "./processes.mjs";
import { verdictLines } from "./render.mjs";
import { hookRepairPlan, repairHooks, verifyHooks } from "./hooks-verify.mjs";
import { contextLabel } from "./select.mjs";
import { postClaim } from "./claim.mjs";
import { writeBrief } from "./brief.mjs";
import { resolveWindow } from "./settings-resolve.mjs";
import { establishTier, restampTier } from "./tier.mjs";
import {
  canonicalizePath,
  CORRUPT,
  invalidateBoardCache,
  makeToken,
  readLineage,
  samePath,
  writeToken,
} from "./session-assert.mjs";
import { pruneDeadOverlay, writeOverlay } from "./overlay.mjs";

// Narration goes to stderr so stdout stays exactly one JSON line — and, when a log file is named, to
// that file as well. The two are deliberately separate: on a successful launch the terminal CLOSES
// (the owner should not be left with a window to tidy up), so the only durable account of what the
// run did is the log. `--quiet` silences the terminal copy and never the log. "Glance first, proof on
// demand" is only true if the proof outlives the glance.
const ANSI = /\u001b\[[0-9;]*m/g;
let narrate = (line) => console.error(line);
const say = (...a) => narrate(a.map((x) => String(x)).join(" "));
/** The brief narration names the FILE. `${brief}` printed "[object Object]" (measured 2026-09-03, #362). */
export const briefWrittenLine = (brief) => `  launch brief written to ${brief?.file ?? brief}`;

/**
 * Whether the log actually received anything, and why not when it did not.
 *
 * A healthy launch must not depend on optional logging -- that part was right. What was wrong is
 * that every failure was swallowed in silence while the shell went on to tell Kuya "the full check
 * table is in <path>", unconditionally, on the quiet path where the terminal copy had been
 * suppressed. So a refusal could destroy the only detailed account of itself and then point at a
 * file that was never created. Losing the evidence is survivable; claiming it exists is not.
 */
let sink = { file: null, wrote: false, error: null };
export const narrationHealth = () => ({ ...sink });

export function setNarration({ quiet = false, logFile = null, now = () => new Date() } = {}) {
  let ready = false;
  sink = { file: logFile, wrote: false, error: null };
  narrate = (line) => {
    if (!quiet) console.error(line);
    if (!logFile) return;
    // A log that cannot be written is a worse thing to fail a launch over than to lose. It is
    // evidence, not a precondition -- but its health is now a fact the caller can read.
    try {
      if (!ready) {
        mkdirSync(dirname(logFile), { recursive: true });
        ready = true;
      }
      // A blank line is the table's spacing, not an event. Stamping it would put a timestamp on
      // nothing and cost the log the shape that makes it readable in the first place.
      const text = line.replace(ANSI, "");
      appendFileSync(logFile, text.trim() === "" ? "\n" : `${now().toISOString()} ${text}\n`);
      sink.wrote = true;
    } catch (e) {
      // First failure wins: it is the one that explains the gap.
      if (!sink.error) sink.error = String(e?.message ?? e);
    }
  };
}

/**
 * A refusal's evidence, put where it can still be read after the window is gone.
 *
 * The whole check table goes through `say`, so a quiet run still writes every row to the log while
 * the shortcut prints its own one-line sentence. The owner reads the sentence; the table is there for
 * whoever asks. Nothing is suppressed, only placed — "glance first, proof on demand" is a promise
 * about WHERE the proof is, not about whether it was produced.
 *
 * It lives here, exported, rather than inline in the dispatch block below, because a report only the
 * real process can produce is a report no guard can check.
 */
export function reportRefusal(payload) {
  if (!payload?.checks?.length) return false;
  for (const line of verdictLines(payload.task, payload)) say(line);
  // The table went to `say`. Whether any of it reached disk is a different question, and the shell
  // needs the answer before it promises a file.
  return { reported: true, durable: Boolean(sink.file) ? sink.wrote && !sink.error : false, log: sink.file, error: sink.error };
}

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

class Refused extends Error {
  constructor(payload) {
    super(payload.reason ?? "preflight refused");
    this.payload = payload;
  }
}

/**
 * What this run has actually done to the machine, in the order it did it.
 *
 * `launch` is a legal-prefix sequence: every stage leaves a state that is recoverable, and any of
 * them can refuse. The shell printed "#N was not started, and nothing was written." for EVERY
 * nonzero exit -- true only of a refusal before the first write, and false after a worktree was
 * created, a tier established, a claim posted, or a token, brief or overlay written. Telling the
 * owner nothing happened while a claim sits on the board with his name on it is the launcher lying
 * about the one thing he would need to clean up.
 *
 * So the effects are recorded as they happen and travel with the refusal. "Nothing was written" is
 * now something the payload can PROVE rather than something the shell assumes.
 */
export class Effects {
  constructor() {
    this.done = [];
  }
  record(what, detail = null) {
    this.done.push(detail ? { what, detail } : { what });
    return this;
  }
  get wroteAnything() {
    return this.done.length > 0;
  }
  payload() {
    return { effects: this.done, wroteAnything: this.wroteAnything };
  }
}

/**
 * Create the worktree from the COMMIT ID the final verdict was about — never from a ref name.
 *
 * No ref is resolved here and no fetch happens here (#21). Both were the defect: the settings were
 * verified against one resolution of `origin/main` and the worktree was created from a second one
 * taken after a fetch, so "verified" and "created" could name different commits while the launcher
 * printed them as the same thing. This function cannot re-resolve anything — it is handed an id, and
 * it refuses anything that is not one, rather than falling back to a movable name.
 */
export function createWorktree({ path, branch, base, hostDir = HOST_DIR }) {
  if (!base?.ok || !FULL_SHA.test(base.sha ?? "")) {
    throw new Error(`Refusing to create a worktree from an unpinned base (${base?.ref ?? "no ref"}: ${base?.error ?? "no commit id"}).`);
  }
  if (existsSync(path)) throw new Error(`Refusing to create over an existing path: ${path}`);
  say(`  creating worktree ${path} on ${branch}`);
  say(`  base: ${base.sha} (${base.ref}, as verified)`);
  git(hostDir, ["worktree", "add", "-b", branch, path, base.sha]);
  return base.sha;
}

/**
 * STAGE 2 (spec §5.6). Refresh the base, run the FULL preflight again against the refreshed commit,
 * and create only from that exact id.
 *
 * Split out of `launch()` so the sequence a real launch runs is the sequence the guards can drive
 * against a repository whose base actually moves — a source-text assertion that two call sites
 * mention the same constant cannot tell you whether the commit verified is the commit created.
 *
 * Creates nothing on a REFUSE: it returns `created:null` and the verdict that stopped it.
 */
export function refreshAndCreate({ facts, target, base = null, hostDir = HOST_DIR, env = process.env }) {
  const refreshed = refreshCreateBase({ hostDir });
  if (base?.sha && refreshed.sha && refreshed.sha !== base.sha) {
    say(`  ${refreshed.ref} moved ${base.sha.slice(0, 7)} -> ${refreshed.sha.slice(0, 7)} while preflight ran — re-verifying against the commit that will be used`);
  }
  const verdict = reconcile(refetchSnapshotFacts({ facts, base: refreshed, hostDir, env }));
  if (verdict.verdict !== "PASS") return { created: null, verdict, base: refreshed };
  return {
    created: createWorktree({ path: target.path, branch: target.branch, base: refreshed, hostDir }),
    verdict,
    base: refreshed,
  };
}

/**
 * The one repair the launcher performs on its own: hook files a folder REGISTERS but does not have.
 *
 * It is bounded on both sides. It only runs when `hooks.present` is the ONLY failing row — a folder
 * that is also dirty, or claimed elsewhere, or on the wrong branch has a problem repair does not
 * address, and repairing into it would be writing to a folder we just refused. And it only runs when
 * `hookRepairPlan` can prove every clause (inside the folder, at the registered path, present in the
 * canonical set, tracked by git); anything short of that refuses with the reason, unrepaired.
 *
 * Afterwards the FULL preflight runs again — not just the hooks row. The repair wrote files into the
 * folder, and the honest question after a write is "does everything still hold", not "did my write
 * land". Same discipline as the base refresh: the last verdict before the next write is a complete one.
 *
 * That paragraph used to be untrue. The code re-measured `facts.hooks` and spread every other key
 * from the object captured BEFORE the write — so board, folder, git, settings, claim and process
 * state were all re-used unread, and `reconcile` is a pure function over whatever it is handed. A
 * comment claiming a full preflight is not a full preflight. `regather` is now how the caller hands
 * back a genuinely fresh reading, and it is injected so the guard can prove it was called.
 */
export function repairHooksIfSafe({ facts, verdict, controlDir, dryRun = false, canonicalDir = null, regather = null }) {
  const failed = (verdict.checks ?? []).filter((c) => !c.ok);
  // `preflight.mjs` builds every row with mk(name, ...) -> { name, expected, actual, ok, ... }. There
  // is no `id` on a check, and reading one compared `undefined` against a string on every launch --
  // always true, so this returned `{attempted:false}` on its first line and the repair below had
  // never run once. Keyed on `name`, and repair-gate.test.mjs asserts the row shape it keys on.
  if (failed.length !== 1 || failed[0].name !== "hooks.present") return { attempted: false, verdict, facts };

  const canonical = canonicalDir ?? join(controlDir ?? "", ".claude", "hooks");
  const plan = hookRepairPlan({ verify: facts.hooks, canonicalDir: canonical });
  if (!plan.ok) return { attempted: true, ok: false, verdict, facts, reason: plan.reason };

  if (dryRun) {
    say(`  ${plan.files.length} hook${plan.files.length === 1 ? "" : "s"} missing and safely repairable (${plan.files.join(", ")}) — a real launch would copy ${plan.files.length === 1 ? "it" : "them"} and re-verify.`);
    return { attempted: true, ok: false, verdict, facts, reason: "dry run: nothing was written" };
  }

  repairHooks({ dir: facts.hooks.dir, canonicalDir: canonical, only: plan.files });

  // A fresh reading of everything, not of the one row we touched.
  const fresh = regather ? regather() : null;
  const repairedFacts = fresh
    ? (fresh.facts ?? fresh)
    : { ...facts, hooks: verifyHooks({ dir: facts.hooks.dir, env: process.env, canonicalDir: canonical }) };
  return { attempted: true, ok: true, verdict: reconcile(repairedFacts), facts: repairedFacts, disclosure: plan.disclosure, regathered: Boolean(fresh) };
}

const UNDECLARED_SCOPE = "not declared at launch — narrow it before the first write (#358)";

/**
 * The claim step. A first claim and a renewal are the same write (#648).
 *
 * A renewal used to post one line saying the date had moved. That line has no claim header, so
 * nothing that reads the thread could see it: the board showed the new date while the thread, which
 * is where a lease is read from, kept the old one. A renewal now re-posts the whole claim through the
 * writer a first claim uses, measured verdict included, and that writer still refuses any verdict
 * that is not PASS.
 *
 * The writer posts the comment first and the board follows it, and the effect is recorded only once
 * the writer returns: a comment that fails leaves nothing for a later stage to act on.
 *
 * A renewal restates the lease's own scope, never the scope this run was handed. A different scope
 * is a different claim.
 */
export function postLeaseClaim({ task, target, facts, verdict, self, effects, post = postClaim, projectIds = readProjectIds }) {
  const ids = projectIds(task.itemId);
  const expires = new Date(facts.now.getTime() + 12 * 3600_000).toISOString().slice(0, 10);
  const renewing = Boolean(facts.claim);
  say(renewing ? "  renewing the existing claim" : "  posting the ownership claim");
  post({
    issue: task.number,
    verdict,
    ids,
    facts: {
      lane: self.lane,
      executor: self.executor ?? self.lane,
      repository: REPO,
      folder: target.path,
      branch: target.branch,
      // The scope the drift readers and the next dispatch will be measured against (#358) —
      // never the title, which names no path and so claims nothing.
      scope: renewing ? (facts.claim.scope ?? UNDECLARED_SCOPE) : (facts.scope?.text ?? UNDECLARED_SCOPE),
      started: facts.now.toISOString().slice(0, 10),
      expires,
      nextAction: task.nextAction ?? "(set by the session)",
      processes: facts.processes,
    },
  });
  const detail = `#${task.number} until ${expires}`;
  if (renewing) effects.record("renewed the ownership claim", detail);
  else effects.record("posted the ownership claim", detail);
  return { expires, renewing };
}

export async function launch({ issue = null, dryRun = false, noOverlay = false, controlDir, self = { lane: "Claude Code" }, scope = null }) {
  // Every refusal below carries this, so "nothing was written" is proven rather than assumed.
  const effects = new Effects();

  const board = readBoard();
  if (!board.reachable) throw new Refused({ verdict: "REFUSE", reason: `Work Control unreachable: ${board.error}`, ...effects.payload() });

  const picked = selectTask(board.items, { issue, self, policy: loadPolicy(), codeRoot: CODE_ROOT });
  if (picked.kind !== "task") {
    throw new Refused({ verdict: picked.kind.toUpperCase(), reason: picked.reason, options: picked.options ?? [], unavailable: picked.unavailable ?? [], ...effects.payload() });
  }

  const task = picked.task;
  // No issue was named and one was already ours — say which, and why nobody was asked (#23).
  if (picked.auto) say(`  resuming #${task.number} — it is already yours and still claimed, so there was nothing to choose`);
  // STAGE 1 — the preliminary verdict. Read-only: no fetch, no writes, and it already names the
  // exact commit an absent worktree would be created from.
  const gathered = gatherFacts({ issue: task.number, task, board, self, scopeText: scope });
  const { target, base } = gathered;
  let facts = gathered.facts;
  let verdict = reconcile(facts);

  // A folder missing its own registered hooks is a chore the owner should never be handed — it is
  // the launcher's payload, and the launcher can prove it. Repair, disclose in one line, re-verify.
  if (verdict.verdict !== "PASS") {
    const repair = repairHooksIfSafe({
      facts,
      verdict,
      controlDir,
      dryRun,
      // The same call that produced the pre-write facts, run again against the folder as it is now.
      regather: () => gatherFacts({ issue: task.number, task, board, self, scopeText: scope }),
    });
    if (repair.attempted) {
      if (repair.ok) {
        effects.record("repaired missing hooks", repair.disclosure);
        say(`  ${repair.disclosure}`);
        ({ facts, verdict } = repair);
      } else {
        say(`  hooks are missing and the launcher will not repair them: ${repair.reason}`);
      }
    }
  }

  if (verdict.verdict !== "PASS") {
    throw new Refused({ ...verdict, task, reason: `preflight refused #${task.number}`, ...effects.payload() });
  }
  if (!target) throw new Refused({ verdict: "REFUSE", reason: "No target folder resolved from the board field.", ...effects.payload() });

  // Say the window out loud before anything is written. A marathon-tier launch that looks like a
  // standard one is the confusion the addendum on #18 closed; the label is not decoration. The tier
  // is accepted (#19), so the line states which tier it is and that it is not the default — it no
  // longer describes an experiment.
  const intended = facts.window.intended;
  const label = contextLabel(intended.window, { marathon: intended.marathon });
  say(`  context window: ${label}${intended.marathon ? "  (accepted tier, scoped to this issue — not the default)" : ""}`);

  if (dryRun) {
    say("  dry run: preliminary verdict PASS, stopping before any write.");
    if (verdict.actions.includes("create-worktree")) {
      say("  (a real launch would refresh origin and re-run preflight against the refreshed commit before creating anything.)");
    }
    return { dryRun: true, issue: task.number, folder: target.path, branch: target.branch, window: intended.window, contextLabel: label, marathon: intended.marathon, verdict };
  }

  // 1. worktree — refresh, RE-VERIFY, then create from the commit that final verdict was about.
  let createdFrom = null;
  if (verdict.actions.includes("create-worktree")) {
    // The only fetch in the toolchain, and it is followed by a full second preflight; the
    // preliminary verdict above authorized the fetch, never the creation.
    const staged = refreshAndCreate({ facts, target, base });
    verdict = staged.verdict;
    if (!staged.created) {
      throw new Refused({ ...verdict, task, reason: `preflight refused #${task.number} against the refreshed base — nothing was created`, ...effects.payload() });
    }
    createdFrom = staged.created;
    effects.record("created the worktree", `${target.path} @ ${target.branch} from ${String(createdFrom).slice(0, 7)}`);
  }

  // 2. tier -- keep the promise the `settings.window` row made.
  //
  // The row may now PASS on an intended window nothing configures yet, because this step is what
  // configures it (#23): the launcher writes the tier into its own gitignored layer, in a file it can
  // prove it wrote, and refuses anybody else's. That is a stronger guarantee than the old comparison,
  // not a weaker one — but only if the write is CHECKED. So the effective window is resolved again
  // from disk afterwards, and a launch that did not actually get its tier stops here, before the
  // claim is posted and before VS Code opens on a session the root assert would hard-stop.
  const tier = establishTier({ dir: target.path, intended });
  if (tier.wrote) effects.record("established the context tier", `${target.path}\\.claude\\settings.local.json → ${intended.window}`);
  if (tier.action === "refuse") {
    throw new Refused({ ...verdict, verdict: "REFUSE", task, reason: tier.reason, remediation: [tier.reason], ...effects.payload() });
  }
  if (tier.wrote) say(`  ${tier.disclosure}`);
  const settled = resolveWindow({ dir: target.path });
  if (settled.window !== intended.window) {
    const from = settled.configured ? settled.file : "nothing — that is the documented fallback";
    throw new Refused({
      ...verdict,
      verdict: "REFUSE",
      task,
      reason: `This train intends ${intended.window} (${intended.reason}), but ${target.path} still resolves ${settled.window} from ${from}. Refusing to start a session at a window the launch did not establish.`,
    });
  }

  // 3. claim -- refuses on its own if the verdict is not PASS. A claim already on the thread is
  //    renewed by the same write: the whole claim again, never a one-line note (#648).
  const { expires } = postLeaseClaim({ task, target, facts, verdict, self, effects });

  // The claim IS the thing the session about to start will be verified against (#216), and the board
  // is cached for ten minutes so the write guard can ask on every keystroke. Against a cache written
  // before this claim, the session would read its own brand-new worktree as a folder nobody claimed.
  invalidateBoardCache();

  // 4. brief -- the durable instructions, written BEFORE the token that admits a session.
  //
  // The token is what lets a session start; the brief is what the session starts with. Written in
  // this order, a session can never be admitted to a task whose instructions are not on disk yet —
  // and that is the whole point of the brief, because the thing it replaces is Kuya pasting a prompt.
  const brief = writeBrief({
    issue: task.number,
    title: task.title,
    lane: self.lane,
    folder: target.path,
    branch: target.branch,
    base: createdFrom,
    window: intended.window,
    marathon: intended.marathon,
    claimExpires: expires,
    nextAction: task.nextAction ?? null,
  });
  say(briefWrittenLine(brief));
  effects.record("wrote the durable task brief", brief.file);

  // 5. token -- what the in-session assert checks the real root against
  //
  // The conversation id is assigned HERE, before anything is written, so one value reaches the CLI
  // (`--session-id`), the launch token and the lineage record. That is what lets the SessionStart
  // hook ask "is this the session I started" instead of only "is this the right folder".
  const sessionId = randomUUID();
  const token = makeToken({
    issue: task.number,
    repo: REPO,
    folder: target.path,
    branch: target.branch,
    window: intended.window,
    sessionId,
    // Written before the token on purpose (step 4), so the digest exists by the time the record that
    // vouches for it does. A session can never be admitted to a brief that is not on disk yet.
    briefHash: brief.hash,
    now: facts.now,
  });
  writeToken(token);
  effects.record("wrote the launch token", "%LOCALAPPDATA%\\CompyEntry\\launch.json");
  say(`  launch token written (expires ${token.expiresAt})`);

  // 6. overlay -- Class A only: the assert hook, never behaviour. Skipped entirely when the branch
  //    already registers the assert in its own tracked settings (owner decision 3): two copies would
  //    run the assert twice and the second would refuse the token the first consumed.
  if (!noOverlay) {
    const o = writeOverlay({ dir: target.path, controlDir });
    if (o.wrote) effects.record("installed the session-root assert overlay", o.file);
    if (o.wrote) say(`  installed the session-root assert into ${o.file}`);
    else if (o.removed) say(`  removed a leftover session-assert overlay from ${o.file} — ${o.reason}`);
    else say(`  session-root assert not installed — ${o.reason}`);
    // The overlay just rewrote the same file `establishTier` recorded a hash for. Both are the
    // launcher; only one kept the record. Re-stamp it, or the strong exact-hash proof is stale from
    // the moment this launch ends and every later tier change leans on the content fallback instead.
    if (o.wrote) restampTier({ dir: target.path });
  } else {
    // Opting out of INSTALLING the assert is not opting out of clearing a dead one we left behind.
    const p = pruneDeadOverlay({ dir: target.path });
    if (p.pruned.length > 0) say(`  removed ${p.pruned.length} dead session-assert entr${p.pruned.length === 1 ? "y" : "ies"} from ${p.file}`);
    say("  --no-overlay: the in-session root assert will NOT run for this launch");
  }

  // Everything the launcher needs to finish the journey without asking again. `title`, `action` and
  // `brief` are here so the shortcut can name the task, say Resume or Start, and point at the durable
  // instructions from ONE run of this sequence — the old script ran preflight a second time for
  // facts it had already been told, and a second read is a second chance to disagree with itself.
  return {
    issue: task.number,
    title: task.title,
    action: picked.auto ? "Resume" : "Start",
    auto: Boolean(picked.auto),
    folder: target.path,
    branch: target.branch,
    base: createdFrom,
    window: intended.window,
    contextLabel: label,
    marathon: intended.marathon,
    // The conversation the launcher named. The shell hands it to the CLI so the session that starts
    // IS the session the token was written for.
    sessionId,
    brief: brief.file,
    ...effects.payload(),
    verdict,
  };
}

/**
 * How a renewing command asks the machine about itself (#648). Each reader below runs one bounded,
 * read-only command and hands back a list. A reader that fails, times out or answers with anything
 * else THROWS: a reading that was not taken is never an empty one, and the holder check refuses on it.
 *
 * The stock sweep (`listProcesses`) answers [] when it cannot run, because a fresh entry is not held
 * up by a probe. A renewal is admitted on these readings, so the same silence here is a refusal.
 */
const probe = (file, args) => execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000, windowsHide: true });
const powershell = (script) => probe("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script]);

function listOf(text) {
  const parsed = JSON.parse(String(text ?? "").trim());
  if (!Array.isArray(parsed)) throw new Error("the reader did not answer with a list");
  return parsed;
}

/**
 * The native session program: the per-user install, and only that file. PATH is not searched and no
 * environment variable is read, the home folder included, so nothing a command can be handed decides
 * which program is asked for the session list, or which file a session program must be running from.
 */
export function nativeCli({ exists = existsSync, home = null } = {}) {
  let base = home;
  if (base === null) {
    try {
      // From the account itself. `os.homedir()` would take an environment variable's word first.
      base = userInfo().homedir;
    } catch {
      base = null;
    }
  }
  if (typeof base !== "string" || base.trim() === "") return null;
  const file = win32.join(base, ".local", "bin", "claude.exe");
  return exists(file) ? file : null;
}

/**
 * The one script that reads a command's ancestry: from one process id upward, a process at a time,
 * stopping at the first session program or after as many steps as the check will read. It asks who
 * each process is (id, parent, creation instant, name, the file it runs from) and never for a command
 * line. The id is the only thing put into the script, and only a positive whole number is.
 */
export function chainScript(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("a chain is read from one process id: a positive whole number, and nothing else");
  return [
    "$ErrorActionPreference = 'Stop'",
    `$id = ${pid}`,
    "$rows = @()",
    `for ($i = 0; $i -lt ${CALLER_MAX_HOPS}; $i++) { $p = Get-CimInstance Win32_Process -Filter "ProcessId = $id"; if ($null -eq $p) { break }; $c = $null; if ($null -ne $p.CreationDate) { $c = $p.CreationDate.ToUniversalTime().ToString('o') }; $rows += [pscustomobject]@{ pid = [int]$p.ProcessId; parentPid = [int]$p.ParentProcessId; created = $c; name = $p.Name; executable = $p.ExecutablePath }; if ($p.Name -ieq 'claude.exe') { break }; $id = [int]$p.ParentProcessId }`,
    "ConvertTo-Json -InputObject @($rows) -Compress",
  ].join("; ");
}

/** A command's process chain, the command first and whatever the read stopped at last. */
export function readChain({ pid, run = powershell }) {
  return listOf(run(chainScript(pid)));
}

/** The native program's own list of live sessions, asked of the program itself: no shell, no folder and no session id in the question. */
export function readSessions({ cli, run = probe }) {
  if (typeof cli !== "string" || cli.trim() === "") throw new Error("there is no native session program to ask");
  return listOf(run(cli, ["agents", "--json"]));
}

/**
 * Which processes the by-process reading asks for: everything the stock sweep watches, and the
 * installers it does not. An install is machine-wide, and the stock list asks for none by name.
 */
export function snapshotFilter() {
  return [...WATCHED.map((name) => `Name='${name}'`), "Name='msiexec.exe'", "Name LIKE '%setup.exe'", "Name LIKE '%installer.exe'"].join(" or ");
}

/**
 * One reading of every watched process, each with its id and creation instant, so one process can be
 * told from another of the same name. Command lines are read here to classify each process, and
 * `observeHolder` drops them as soon as it has.
 */
export function readSnapshot({ run = powershell } = {}) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$rows = @(Get-CimInstance Win32_Process -Filter "${snapshotFilter()}" | ForEach-Object { $c = $null; if ($null -ne $_.CreationDate) { $c = $_.CreationDate.ToUniversalTime().ToString('o') }; [pscustomobject]@{ pid = [int]$_.ProcessId; created = $c; name = $_.Name; commandLine = $_.CommandLine } })`,
    "ConvertTo-Json -InputObject $rows -Compress",
  ].join("; ");
  return listOf(run(script));
}

/**
 * One process of a by-process reading, classified on its own by the stock classifier, its command
 * line dropped. `contends` is true, false, or null where the machine did not say enough to tell: a
 * builder or a session whose command line could not be read may be running anywhere, and unknown is
 * not "elsewhere".
 */
function judgeProcess(p, { folder, classify }) {
  const row = p && typeof p === "object" ? p : {};
  const name = typeof row.name === "string" ? row.name : "";
  const line = typeof row.commandLine === "string" ? row.commandLine : "";
  const seen = { pid: Number.isInteger(row.pid) ? row.pid : null, created: typeof row.created === "string" ? row.created : null, name };
  const as = (commandLine) => classify([{ name, commandLine }], { folder })[0] ?? null;
  const group = as(line);
  if (!group) return { ...seen, contends: null, note: "it could not be classified" };
  if (group.contends) return { ...seen, contends: true, note: group.note };
  if (line.trim() === "" && as(folder)?.contends) return { ...seen, contends: null, note: "its command line could not be read" };
  return { ...seen, contends: false, note: null };
}

/**
 * What a renewing command measures about itself (#648). Nothing here is taken from an argument or
 * from the environment: the session id it is handed is only carried, for `callerWitness` to check.
 *
 *   1. Its own process chain, from `process.pid` up to the first session program.
 *   2. The native session list, asked of the native program, kept only where it names that program's
 *      process or the session id handed in. Nobody else's session leaves this function.
 *   3. If, and only if, those establish the command (`callerWitness`): the root the native list gives
 *      that session, and one by-process reading of what is running, each process classified on its
 *      own. Kept: the command's own chain, whatever contends or could not be told, and whatever the
 *      check refuses on sight (a process named twice, one not identified, an installer). The rest is
 *      a count, and every command line is dropped.
 *   4. The session record kept for that root, and whether it is live. Live is what was just measured
 *      and nothing more is read for it: the command established under its session, and that root's
 *      record naming the same session and the same folder. A record with no established command
 *      behind it, or one that names another session or folder, is unknown. A process id written in a
 *      record, the age of any file and whatever the command was handed are not readings of this session.
 *
 * Without an established command there is no native root. The work tree the command stands in is then
 * read so a refusal can show it, and it is reported as the guess it is: `reconcileHolder` never admits
 * on it. A reader that fails leaves its reading marked unread, never empty. Nothing is decided here,
 * and a reading is one moment: `renew` takes it again immediately before the write.
 */
export function observeHolder({
  sessionId,
  cwd = process.cwd(),
  pid = process.pid,
  cli = nativeCli(),
  chain = readChain,
  sessions = readSessions,
  sweep = readSnapshot,
  classify = classifyProcesses,
  clock = () => new Date(),
  toplevel = (dir) => git(dir, ["rev-parse", "--show-toplevel"]),
  read = readLineage,
} = {}) {
  // A reader that threw, or answered with something that is not a list, took no reading.
  const taken = (reader) => {
    try {
      const answer = reader();
      return Array.isArray(answer) ? answer : null;
    } catch {
      return null;
    }
  };
  const isRow = (x) => Boolean(x) && typeof x === "object";

  const traced = taken(() => chain({ pid }));
  const hops = (traced ?? []).map((p) => (isRow(p) ? { pid: p.pid, parentPid: p.parentPid, created: p.created, name: p.name, executable: p.executable } : null));
  const host = hops.length ? hops[hops.length - 1] : null;
  const program = typeof cli === "string" && cli.trim() !== "" ? cli : null;

  // Asked only once the chain has reached a session program, and only of the native program.
  const fleet = host && isSessionProgram(host.name) && program ? taken(() => sessions({ cli: program })) : null;
  const hostPid = Number.isInteger(host?.pid) ? host.pid : null;
  const handed = typeof sessionId === "string" && sessionId !== "" ? sessionId : null;
  const entries = (fleet ?? [])
    .filter((e) => isRow(e) && ((hostPid !== null && e.pid === hostPid) || (handed !== null && e.sessionId === handed)))
    .map((e) => ({ pid: e.pid, sessionId: e.sessionId, kind: e.kind, cwd: e.cwd, startedAt: e.startedAt }));

  const measured = { pid, cli: program, chain: { ok: traced !== null, rows: hops }, sessions: { ok: fleet !== null, entries } };
  const witness = callerWitness({ sessionId, caller: measured });

  let root = { path: null, source: null };
  let snapshot = { ok: false, takenAt: null, rows: [], others: null };
  if (witness.verified) {
    const folder = canonicalizePath(witness.root) || null;
    root = { path: folder, source: "native session list" };
    const raw = folder ? taken(() => sweep()) : null;
    if (raw !== null) {
      const judged = raw.map((p) => judgeProcess(p, { folder, classify }));
      // What the check must see is never folded into the count, however quiet it was judged: a process
      // named twice, one the reading did not identify, and an installer.
      const times = new Map();
      for (const p of judged) times.set(p.pid, (times.get(p.pid) ?? 0) + 1);
      const telling = (p) => times.get(p.pid) > 1 || !isIdentified(p) || isInstallerProgram(p.name);
      const kept = judged.filter((p) => witness.pids.includes(p.pid) || p.contends !== false || telling(p));
      // Stamped once the reading is in hand: it says what was running at about this moment, and nothing about later.
      snapshot = { ok: true, takenAt: clock().toISOString(), rows: kept, others: judged.length - kept.length };
    }
  } else {
    // An inferred working directory may be a folder inside the work tree, and the session record is
    // kept per work tree. Outside any work tree there is no root, and no record to look for.
    try {
      const top = canonicalizePath(toplevel(cwd));
      if (top) root = { path: top, source: "git toplevel of the working directory" };
    } catch {
      // Left unmeasured: the holder check refuses a root nobody could read.
    }
  }

  const found = root.path ? read({ root: root.path }) : null;
  const record = found && found !== CORRUPT && typeof found === "object" ? found : null;
  // Live is this measurement and no other: the command established under its session, and the record
  // kept for that session's root naming the same session and the same folder. No reader is asked.
  const own = witness.verified && record !== null && record.sessionId === witness.session.sessionId && typeof record.folder === "string" && samePath(record.folder, root.path);
  return {
    sessionId,
    caller: { ...measured, snapshot },
    root,
    record,
    recordState: found === CORRUPT ? "corrupt" : record ? "ok" : "absent",
    liveness: record === null ? "none" : own ? "live" : "unknown",
    // The program running this command. A process sweep that answered lists it.
    sweeper: basename(process.execPath),
  };
}

/**
 * Renew the lease this session already holds (#648). The holder's own entry, and a narrow one.
 *
 * `launch` asks whether a session may BEGIN in a folder, and a session at work there fails that by
 * working: its alarm may have passed, and its folder is not clean. This asks the holder question
 * instead (`reconcileHolder`), creates nothing, opens nothing, and writes in the one order a failure
 * cannot leave half-true: the full claim comment, then the board, then the cached board answer.
 *
 * It takes an issue and a session id, and nothing else that could move a lease. There is no folder,
 * root or environment argument: the command is traced from its own process to its session
 * (`observeHolder`), and the folder is that session's native root. There is no scope argument,
 * because a renewal restates the scope the lease already has.
 *
 * The command is measured twice from the same seat: once to decide, and again immediately before the
 * comment is posted. The second measurement must pass in full AND be the same witness the first one
 * admitted, or nothing is posted. That narrows the gap between the check and the write; it does not
 * close it, and the board and git facts are the ones gathered for the first decision.
 */
export function renew({
  issue = null,
  sessionId = null,
  self = { lane: "Claude Code" },
  cwd,
  board = readBoard,
  policy = loadPolicy,
  gather = gatherFacts,
  observe = observeHolder,
  post = postClaim,
  projectIds = readProjectIds,
  invalidate = invalidateBoardCache,
} = {}) {
  // Every refusal below carries this, so "nothing was written" is proven rather than assumed.
  const effects = new Effects();
  const refused = (payload) => new Refused({ verdict: "REFUSE", ...payload, ...effects.payload() });

  if (!Number.isInteger(issue) || issue <= 0) {
    throw refused({ code: "RENEW_NO_ISSUE", reason: "A renewal names the issue its lease is on (--issue <number>). Nothing was read and nothing was written." });
  }
  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    throw refused({ code: "RENEW_NO_SESSION", reason: "A renewal names the session that holds the lease (--session <id>). Nothing was read and nothing was written." });
  }

  const theBoard = board();
  if (!theBoard.reachable) throw refused({ reason: `Work Control unreachable: ${theBoard.error}` });

  const picked = selectTask(theBoard.items, { issue, self, policy: policy(), codeRoot: CODE_ROOT });
  if (picked.kind !== "task") throw refused({ reason: picked.reason });
  const task = picked.task;

  // No scope is handed to the gatherer, so the scope it measures is the lease's own.
  const { target, facts } = gather({ issue: task.number, task, board: theBoard, self });
  // One seat, measured from twice. No folder, root or environment is in it: the observer reads those from the machine.
  const seat = { sessionId: sessionId.trim(), cwd, now: facts.now };
  const holder = observe(seat);
  const verdict = reconcileHolder({ ...facts, holder });
  if (verdict.verdict !== "PASS") {
    throw new Refused({ ...verdict, task, reason: `renewal refused for #${task.number}`, ...effects.payload() });
  }
  if (!target) throw refused({ reason: "No target folder resolved from the board field." });

  // What was admitted, as itself: the chain by process id and creation instant, its session and its root.
  const admitted = callerWitness(holder).identity;
  let posted = verdict;
  // The last thing before the comment. A command that ended, was replaced or was raced, a reading that
  // failed, or a contender that started since: each refuses here, with nothing posted.
  const measuredPost = (claim) => {
    const again = observe(seat);
    posted = reconcileHolder({ ...facts, holder: again && typeof again === "object" ? { ...again, since: admitted } : null });
    if (posted.verdict !== "PASS") {
      throw new Refused({
        ...posted,
        task,
        code: "RENEW_WITNESS_CHANGED",
        reason: `renewal refused for #${task.number} at the write: what this command measured about itself immediately before posting did not pass, or was not the witness it was admitted on. Nothing was posted.`,
        ...effects.payload(),
      });
    }
    return post({ ...claim, verdict: posted });
  };

  const { expires } = postLeaseClaim({ task, target, facts, verdict, self, effects, post: measuredPost, projectIds });

  // The claim just posted is what the write guard reads next, and the board answer is cached for ten
  // minutes. Cleared only here: a comment that failed threw above and left the cache alone.
  invalidate();

  return { renewed: true, issue: task.number, folder: target.path, branch: target.branch, expires, ...effects.payload(), verdict: posted };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
  setNarration({ quiet: argv.includes("--quiet"), logFile: arg("--log") });
  try {
    // `--renew` is the holder's entry (#648): it renews the lease this session already holds and
    // starts nothing. Every other invocation is a launch.
    const result = argv.includes("--renew")
      ? renew({ issue: arg("--issue") ? Number(arg("--issue")) : null, sessionId: arg("--session") })
      : await launch({
          issue: arg("--issue") ? Number(arg("--issue")) : null,
          dryRun: argv.includes("--dry-run"),
          noOverlay: argv.includes("--no-overlay"),
          scope: arg("--scope"),
          controlDir: arg("--control") ?? process.cwd(),
        });
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (e) {
    if (e instanceof Refused) {
      const sink = reportRefusal(e.payload);
      // The shell decides whether to promise the log, so it needs to know whether the log happened.
      console.log(JSON.stringify({ ...e.payload, logDurable: sink === false ? false : Boolean(sink.durable), logError: sink === false ? null : sink.error }));
      process.exit(1);
    }
    console.log(JSON.stringify({ verdict: "ERROR", reason: String(e.message ?? e) }));
    process.exit(3);
  }
}
