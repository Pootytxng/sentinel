# Project Doctor Read-Only Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete read-only Project Doctor preview with stable findings, deterministic recommendations, zero-token monitoring, and the Checkup / Problems / Repairs interface while leaving the current Console default untouched.

**Architecture:** Reuse the existing canonical Git, worktree, process, hook, Work Control, PR, and CI readers. A new pure finding normalizer converts structured facts into stable codes and a deterministic playbook; a separate scanner exposes only an allowlisted, agent-free snapshot; a new standalone Doctor page consumes that endpoint at `/doctor` so the existing `/` journey remains recoverable during this train.

**Tech Stack:** Node.js ESM with built-in modules only, Vitest 4, plain semantic HTML/CSS/JavaScript, existing `tools/entry` readers, loopback HTTP server.

## Global Constraints

- Add no npm, Rust, PowerShell module, browser-extension, or system dependency.
- `tools/console/server.mjs` remains bound to `127.0.0.1`; do not add configurable network exposure.
- Automatic checks use no Claude or Codex tokens.
- The automatic path must not launch `claude`, `codex`, `/api/chat`, a model host, or any model/API endpoint.
- Run one light scan on open and at most once per 60 seconds while visible; never overlap scans.
- PR/CI reads run only on the initial scan, every fifth light interval, or explicit **Scan now**.
- The full release audit remains explicit and is never scheduled.
- The Doctor stores no project truth, notification database, or durable repair history.
- Raw terminal/error prose is evidence only; it never selects a finding or action.
- No runtime repair, launcher start, process stop, `src/`, or `src-tauri/` change belongs to this plan; the only server change is the isolated read-only preview boundary.
- Preserve the existing `/`, `/api/state`, `/api/chat`, `/api/chats`, `/api/launcher`, and `/api/audit` behavior until the later default-migration plan.
- Every defect found during implementation becomes a failing guard before its fix.

---

## File map

| File | Responsibility |
|---|---|
| `tools/console/doctor-findings.mjs` | Stable finding codes, fingerprints, severity ordering, normalization, and change comparison. |
| `tools/console/doctor-playbook.mjs` | Exhaustive deterministic owner copy, authority, and one primary action for every code. |
| `tools/console/doctor-findings.test.mjs` | Pure taxonomy, deduplication, ordering, change-state, and playbook-coverage guards. |
| `tools/console/doctor-scan.mjs` | Allowlisted local/board/slow source orchestration and one in-flight scan gate. |
| `tools/console/doctor-scan.test.mjs` | Zero-agent call, cadence-group, reachability, and no-overlap guards. |
| `tools/entry/processes.mjs` | Backward-compatible process list plus one reachability-aware snapshot for Doctor scans. |
| `tools/entry/processes.test.mjs` | Process-probe failure disclosure and compatibility guards. |
| `tools/console/sources.mjs` | Composes checkout facts from one shared process snapshot and narrows stale-lock proof. |
| `tools/console/doctor-view.mjs` | Pure accessible markup renderers for the three Doctor views. |
| `tools/console/doctor-ui.mjs` | Browser state, polling, change announcements, navigation, and explicit scan events. |
| `tools/console/doctor.html` | Standalone preview document at `/doctor`. |
| `tools/console/doctor.css` | Restrained Doctor layout, state colors, focus, responsive, and reduced-motion rules. |
| `tools/console/doctor-ui.test.mjs` | Primary-navigation, no-chat, status grammar, polling, transient-state, and accessibility contracts. |
| `tools/console/server.mjs` | Serves the preview assets and injects the read-only `/api/doctor/scan` endpoint. |
| `tools/console/server-contract.test.mjs` | Loopback/origin, preview revision, injection, and legacy-route preservation guards. |

## Dependency order

```text
Task 1 finding contract
  -> Task 2 zero-token scanner
    -> Task 3 server preview boundary
      -> Task 4 Checkup / Problems / Repairs UI
        -> foundation review gate
```

### Task 1: Stable finding contract and exhaustive resolution playbook

**Files:**

- Create: `tools/console/doctor-findings.mjs`
- Create: `tools/console/doctor-playbook.mjs`
- Create: `tools/console/doctor-findings.test.mjs`

**Interfaces:**

- Consumes: a structured snapshot shaped as `{ generatedAt, sources, checkouts, work, ci, lostAndFound }`.
- Produces: `FINDING_CODES`, `PRIORITY_ORDER`, `findingFingerprint(subject)`, `normalizeDoctorFindings(snapshot, { previous })`, `PLAYBOOK`, and `resolveDoctorFinding(finding)`.
- `DoctorFinding` fields are exactly `code`, `fingerprint`, `project`, `scope`, `priority`, `state`, `summary`, `impact`, `recommendation`, `action`, `authority`, `evidence`, `subject`, and `observedAt`; `state` is `new`, `worsened`, `unchanged`, or `improved`.
- `subject` is structured as `{ issue?: number, folder?: string, branch?: string, pr?: number, source?: string, repairEligible?: boolean }`; Foundation always emits `repairEligible: false`, and the later repair plan may promote it only after the complete canonical read-only preflight proves that hooks are the sole failure.
- `evidence` contains only bounded `{ kind, detail, measure? }` references. Optional numeric `measure` supports prose-independent improved/worsened comparison. Evidence never carries process samples, command lines, environment variables, authorization data, raw board objects, or raw remote responses.
- `action` is structured as `{ kind, label, provider?: "claude" | "codex" }`; Foundation emits only `inspect`, `scan`, `run-audit`, `owner-decision`, `open-claude`, or `open-codex`.

- [ ] **Step 1: Write the failing taxonomy, ordering, fingerprint, and playbook tests**

Create `tools/console/doctor-findings.test.mjs` with fixtures that never touch the real machine:

```js
import { describe, expect, it } from "vitest";
import { FINDING_CODES, normalizeDoctorFindings } from "./doctor-findings.mjs";
import { PLAYBOOK, resolveDoctorFinding } from "./doctor-playbook.mjs";

const snapshot = (over = {}) => ({
  generatedAt: "2026-08-02T12:00:00.000Z",
  sources: { local: { ok: true }, board: { ok: true }, slow: { ok: true } },
  checkouts: [],
  work: { ok: true, items: [] },
  ci: { ok: true, value: { meaningful: true, runs: [] } },
  lostAndFound: [],
  ...over,
});

describe("Project Doctor finding contract", () => {
  it("gives every code exactly one deterministic playbook entry", () => {
    expect(Object.keys(PLAYBOOK).sort()).toEqual([...FINDING_CODES].sort());
    for (const code of FINDING_CODES) {
      const entry = PLAYBOOK[code];
      expect(entry.summary).toBeTruthy();
      expect(entry.impact).toBeTruthy();
      expect(entry.recommendation).toBeTruthy();
      expect(entry.action.label).toBeTruthy();
      expect(entry.authority).toMatch(/^(read|safe-local|owner|agent|external)$/);
    }
  });

  it("uses stable identity rather than copy to deduplicate a dirty folder", () => {
    const input = snapshot({ checkouts: [{
      path: "C:\\Users\\Kuya\\code\\sentinel-a",
      project: "sentinel-a",
      git: { ok: true, clean: false, workingTreeClean: false, modified: 1, staged: 0, untracked: 0, unmerged: 0, stashed: 0, ahead: 0, behind: 0 },
      hooks: { ok: true }, processes: [],
    }] });
    const [first] = normalizeDoctorFindings(input);
    const [second] = normalizeDoctorFindings(input, { previous: [{ ...first, summary: "copy changed" }] });
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.state).toBe("unchanged");
  });

  it("derives improved and worsened from structured measures, never copy", () => {
    const dirty = (modified) => snapshot({ checkouts: [{ path: "C:\\fixture", project: "fixture",
      git: { ok: true, workingTreeClean: false, modified, staged: 0, untracked: 0, unmerged: 0, stashed: 0, ahead: 0, behind: 0 },
      hooks: { ok: true }, processes: [] }] });
    const [three] = normalizeDoctorFindings(dirty(3));
    expect(normalizeDoctorFindings(dirty(1), { previous: [three] })[0].state).toBe("improved");
    const [one] = normalizeDoctorFindings(dirty(1));
    expect(normalizeDoctorFindings(dirty(3), { previous: [one] })[0].state).toBe("worsened");
  });

  it("orders collision before broken, owner, and advisory", () => {
    const findings = normalizeDoctorFindings(snapshot({
      checkouts: [
        { path: "C:\\a", project: "a", git: { ok: true, clean: false, workingTreeClean: false, modified: 1, stashed: 0, unmerged: 0 }, hooks: { ok: true }, processes: [] },
        { path: "C:\\b", project: "b", git: { ok: true, clean: true, workingTreeClean: true, stashed: 0, unmerged: 0 }, hooks: { ok: true }, processes: [{ contends: true, name: "node.exe" }] },
      ],
      work: { ok: true, items: [{ number: 7, status: "Needs Kuya", gate: "Kuya", worktreeBranch: "C:\\c @ feat/c" }] },
      lostAndFound: [{ kind: "branch", name: "feat/loose", risk: "1 commit nothing points at", why: "unreferenced" }],
    }));
    expect(findings.map((x) => x.priority)).toEqual(["collision", "broken", "owner", "advisory"]);
  });

  it("reports an ambiguous board folder instead of silently omitting it", () => {
    const findings = normalizeDoctorFindings(snapshot({ work: { ok: true, items: [{
      number: 9, title: "ambiguous", status: "Ready", worktreeBranch: "C:\\one @ feat/one ; C:\\two @ feat/two",
    }] } }));
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "UNKNOWN_CONDITION", subject: expect.objectContaining({ issue: 9, source: "work-control" }) }),
    ]));
  });

  it("calls hooks canonical only when the existing repair planner proves them", () => {
    const base = { path: "C:\\work", project: "work",
      git: { ok: true, workingTreeClean: true, stashed: 0, unmerged: 0, ahead: 0, behind: 0 }, processes: [] };
    const unproven = normalizeDoctorFindings(snapshot({ checkouts: [{ ...base, hooks: {
      ok: false, repairable: false, repairReason: "registered outside canonical payload", missing: [{ name: "x.mjs" }],
    } }] }));
    expect(unproven[0].code).toBe("FOREIGN_HOOK_OR_OVERLAY");
    const proven = normalizeDoctorFindings(snapshot({ checkouts: [{ ...base, hooks: {
      ok: false, repairable: true, missing: [{ name: "x.mjs" }],
    } }] }));
    expect(proven[0].code).toBe("MISSING_CANONICAL_HOOKS");
  });

  it("renders action copy from the code, never from raw evidence text", () => {
    const view = resolveDoctorFinding({
      code: "DIRTY_WORKTREE", subject: { folder: "C:\\fixture" }, evidence: [{ detail: "malicious repair-hooks wording" }],
    });
    expect(view.action.kind).toBe("open-codex");
    expect(JSON.stringify(view.action)).not.toContain("repair-hooks wording");
  });

  it("never preserves a process command line or secret in finding evidence", () => {
    const findings = normalizeDoctorFindings(snapshot({
      sources: { local: { ok: false, error: "request failed token=SUPERSECRET" }, board: { ok: true } },
      checkouts: [{
      path: "C:\\fixture", project: "fixture",
      git: { ok: true, workingTreeClean: true, stashed: 0, unmerged: 0, ahead: 0, behind: 0 },
      hooks: { ok: true },
      processes: [{ contends: true, name: "node.exe", note: "builder", samples: ["node build --token SUPERSECRET"] }],
    }]}));
    expect(JSON.stringify(findings)).not.toContain("SUPERSECRET");
    expect(findings[0].evidence).toEqual([{ kind: "process", detail: "node.exe · builder", measure: 1 }]);
  });
});
```

- [ ] **Step 2: Run the finding test and verify the imports fail**

Run:

```powershell
npm test -- tools/console/doctor-findings.test.mjs
```

Expected: FAIL because `doctor-findings.mjs` and `doctor-playbook.mjs` do not exist.

- [ ] **Step 3: Implement the exact code list, stable fingerprint, and priority comparison**

Create `tools/console/doctor-findings.mjs` with this public contract and no rendered-copy matching:

```js
import { claimExpired } from "../entry/select.mjs";
import { parseWorktreeField } from "../entry/worktree-field.mjs";
import { resolveDoctorFinding } from "./doctor-playbook.mjs";

export const FINDING_CODES = Object.freeze([
  "WORKTREE_MULTI_WRITER", "PROCESS_COLLISION", "BOARD_FOLDER_COLLISION",
  "DIRTY_WORKTREE", "DIVERGED_BRANCH", "MISSING_CANONICAL_HOOKS",
  "FOREIGN_HOOK_OR_OVERLAY", "CLAIM_EXPIRED", "OWNER_DECISION",
  "WAITING_EXTERNAL", "CI_NO_EXECUTION", "CI_FAILED", "SOURCE_UNREACHABLE",
  "UNPUBLISHED_WORK", "ORPHAN_FOLDER", "STALE_IDE_LOCK", "UNKNOWN_CONDITION",
]);

export const PRIORITY_ORDER = Object.freeze({ collision: 0, broken: 1, owner: 2, advisory: 3 });

const canonical = (value) => String(value ?? "").replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
const ref = (kind, detail, measure = null) => ({
  kind,
  detail: String(detail ?? "")
    .replace(/\b(token|authorization|api[-_ ]?key|secret)\b\s*[:=]?\s*\S+/gi, "$1 [redacted]")
    .replace(/\s+/g, " ")
    .slice(0, 240),
  ...(Number.isFinite(measure) ? { measure } : {}),
});
const identity = (subject = {}) => [subject.source, subject.issue, canonical(subject.folder), subject.branch, subject.pr]
  .map((value) => value ?? "-").join("|");

export const findingFingerprint = ({ code, subject }) => `${code}|${identity(subject)}`;

const previousState = (finding, previous) => {
  const prior = previous.find((item) => item.fingerprint === finding.fingerprint);
  if (!prior) return "new";
  const priorityDelta = PRIORITY_ORDER[finding.priority] - PRIORITY_ORDER[prior.priority];
  if (priorityDelta < 0) return "worsened";
  if (priorityDelta > 0) return "improved";
  const magnitude = (item) => (item.evidence ?? []).reduce((sum, evidence) => sum + (Number(evidence.measure) || 0), 0);
  if (magnitude(finding) > magnitude(prior)) return "worsened";
  if (magnitude(finding) < magnitude(prior)) return "improved";
  return "unchanged";
};

const finish = (drafts, previous) => drafts
  .map((draft) => {
    const resolved = resolveDoctorFinding(draft);
    const finding = { ...resolved, fingerprint: findingFingerprint(resolved) };
    return { ...finding, state: previousState(finding, previous) };
  })
  .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    || a.project.localeCompare(b.project)
    || a.fingerprint.localeCompare(b.fingerprint));

export function normalizeDoctorFindings(snapshot, { previous = [], codeRoot = null } = {}) {
  const drafts = [];
  const observedAt = snapshot.generatedAt;
  const add = (code, subject, evidence = []) => drafts.push({
    code, subject, evidence, observedAt,
    project: subject.project ?? subject.folder?.split("\\").at(-1) ?? "Compy",
    scope: subject.folder ?? (subject.issue ? `#${subject.issue}` : subject.source ?? "project"),
  });

  const workItems = snapshot.work?.items ?? [];
  const parsedFor = (item) => parseWorktreeField(item.worktreeBranch, { codeRoot });
  const folderFor = (item) => {
    const parsed = parsedFor(item);
    return parsed.ok && parsed.entries.length === 1 ? parsed.entries[0].path : "";
  };
  const workByFolder = new Map();
  for (const item of workItems) {
    const parsed = parsedFor(item);
    const field = String(item.worktreeBranch ?? "").trim();
    if (field && field.toLowerCase() !== "none" && (!parsed.ok || parsed.entries.length !== 1)) {
      add("UNKNOWN_CONDITION", { issue: item.number, source: "work-control", project: item.title ?? `#${item.number}` },
        [ref("work-control", parsed.ok ? "the item names more than one worktree" : `${parsed.code}: ${parsed.reason}`)]);
    }
    const folder = folderFor(item);
    if (folder) workByFolder.set(canonical(folder), [...(workByFolder.get(canonical(folder)) ?? []), item]);
  }

  for (const [source, result] of Object.entries(snapshot.sources ?? {})) {
    if (!result?.ok) add("SOURCE_UNREACHABLE", { source, project: "Project Doctor" }, [ref("source", result?.error ?? "unreachable")]);
  }
  for (const checkout of snapshot.checkouts ?? []) {
    const matchingWork = workByFolder.get(canonical(checkout.path)) ?? [];
    const subject = { folder: checkout.path, branch: checkout.git?.branch, project: checkout.project,
      issue: matchingWork.length === 1 ? matchingWork[0].number : undefined,
      repairEligible: false };
    if (!checkout.git?.ok) add("SOURCE_UNREACHABLE", { ...subject, source: "git" });
    else {
      if (checkout.git.ahead > 0 && checkout.git.behind > 0) add("DIVERGED_BRANCH", subject, [ref("git", `ahead ${checkout.git.ahead}, behind ${checkout.git.behind}`, checkout.git.ahead + checkout.git.behind)]);
      const workDirty = !checkout.git.workingTreeClean || checkout.git.stashed > 0 || checkout.git.unmerged > 0;
      const workMagnitude = ["modified", "staged", "untracked", "stashed", "unmerged"].reduce((sum, key) => sum + (Number(checkout.git[key]) || 0), 0);
      if (workDirty) add("DIRTY_WORKTREE", subject, [ref("git", `${checkout.git.modified} modified · ${checkout.git.staged} staged · ${checkout.git.untracked} untracked · ${checkout.git.stashed} stashed · ${checkout.git.unmerged} unmerged`, workMagnitude)]);
      if (checkout.git.detached) add("UNKNOWN_CONDITION", subject, [ref("git", "detached HEAD")]);
    }
    if (checkout.hooks && !checkout.hooks.ok && checkout.hooks.repairable !== true) add("FOREIGN_HOOK_OR_OVERLAY", subject, [ref("hooks", checkout.hooks.repairReason ?? "ownership or canonical location could not be proven", checkout.hooks.missing?.length ?? 1)]);
    else if (checkout.hooks && !checkout.hooks.ok) add("MISSING_CANONICAL_HOOKS", subject, [ref("hooks", `${checkout.hooks.missing.length} missing: ${checkout.hooks.missing.map((item) => item.name).join(", ")}`, checkout.hooks.missing.length)]);
    if (checkout.processes?.some((item) => item.contends)) add("PROCESS_COLLISION", subject, checkout.processes
      .filter((item) => item.contends)
      .map((item) => ref("process", `${item.name ?? "process"} · ${item.note ?? "uses this folder"}`, 1)));
  }

  const activeByFolder = new Map();
  for (const item of workItems) {
    const folder = folderFor(item);
    if (item.status === "Active" && folder) {
      const key = canonical(folder);
      activeByFolder.set(key, [...(activeByFolder.get(key) ?? []), item]);
    }
    const subject = { issue: item.number, folder, project: item.title ?? `#${item.number}` };
    if (item.status === "Needs Kuya" || item.gate === "Kuya") add("OWNER_DECISION", subject, [ref("work-control", `status ${item.status} · gate ${item.gate}`)]);
    if (item.status === "Active" && claimExpired(item, new Date(observedAt))) add("CLAIM_EXPIRED", subject, [ref("work-control", `claim expired ${item.claimExpires ?? "without an expiry date"}`)]);
    if (item.status === "Blocked") add("WAITING_EXTERNAL", subject, [ref("work-control", "status Blocked")]);
  }
  for (const items of activeByFolder.values()) {
    if (items.length > 1) add("BOARD_FOLDER_COLLISION", { folder: folderFor(items[0]), project: "Work Control" }, [ref("work-control", `active items ${items.map((item) => `#${item.number}`).join(", ")}`, items.length)]);
  }

  const ci = snapshot.ci?.value ?? snapshot.ci;
  if (ci && ci.meaningful === false && /no job has started|0 billable/i.test(ci.reason ?? "")) add("CI_NO_EXECUTION", { source: "ci", project: "GitHub checks" }, [ref("ci", ci.reason)]);
  else if (ci?.runs?.some((run) => run.conclusion === "failure")) add("CI_FAILED", { source: "ci", project: "GitHub checks" }, ci.runs
    .filter((run) => run.conclusion === "failure")
    .map((run) => ref("ci", `${run.workflowName ?? run.displayTitle ?? "workflow"} · failure`, 1)));

  for (const item of snapshot.lostAndFound ?? []) {
    const subject = { branch: item.kind === "branch" ? item.name : undefined, folder: item.kind !== "branch" ? item.name : undefined, project: "Loose work" };
    if (item.kind === "branch") add("UNPUBLISHED_WORK", subject, [ref("branch", item.why ?? item.risk)]);
    else if (item.kind === "orphan") add("ORPHAN_FOLDER", subject, [ref("folder", item.why ?? item.risk)]);
    else if (item.kind === "stale" && item.provenDead === true) add("STALE_IDE_LOCK", subject, [ref("lock", `${item.why ?? item.risk} · pid ${item.pid ?? "missing"}`)]);
  }
  return finish(drafts, previous);
}
```

- [ ] **Step 4: Implement the exhaustive playbook**

Create `tools/console/doctor-playbook.mjs`. Use one frozen entry per `FINDING_CODES` value. The action and authority assignments are exact:

```js
const entry = (priority, authority, summary, impact, recommendation, kind, label, provider) => Object.freeze({
  priority, authority, summary, impact, recommendation,
  action: Object.freeze({ kind, label, ...(provider ? { provider } : {}) }),
});

export const PLAYBOOK = Object.freeze({
  WORKTREE_MULTI_WRITER: entry("collision", "agent", "Two sessions point at the same worktree.", "They could overwrite each other's work.", "Return to the session that already owns it.", "open-claude", "Return to Claude", "claude"),
  PROCESS_COLLISION: entry("collision", "read", "A live process is using this folder.", "Starting another write could collide with work already running.", "Inspect the running owner and wait or return to it.", "inspect", "Inspect owner"),
  BOARD_FOLDER_COLLISION: entry("collision", "owner", "Two active work items name the same folder.", "The ownership ledger cannot guarantee one writer.", "Choose one owner before either item continues.", "owner-decision", "Review ownership"),
  DIRTY_WORKTREE: entry("broken", "agent", "This worktree contains unsaved work.", "Automatic cleanup could discard or hide someone else's changes.", "Preserve it and inspect the exact changes before deciding.", "open-codex", "Open in Codex", "codex"),
  DIVERGED_BRANCH: entry("broken", "agent", "This branch and its upstream have diverged.", "A blind pull, reset, or rebase could lose history.", "Review both histories and choose a recovery deliberately.", "open-codex", "Open in Codex", "codex"),
  MISSING_CANONICAL_HOOKS: entry("broken", "read", "Required workflow guards are missing.", "A session could start without the protections its settings register.", "Restore only the tracked canonical set and recheck everything.", "inspect", "Review repair"),
  FOREIGN_HOOK_OR_OVERLAY: entry("broken", "agent", "A workflow hook points outside the owned canonical location.", "Compy cannot prove that overwriting it is safe.", "Preserve it and inspect who owns the registration.", "open-claude", "Open in Claude", "claude"),
  CLAIM_EXPIRED: entry("owner", "owner", "A work claim has expired.", "Expiry is an alarm, not permission to take over.", "Inspect the real worktree and process before assigning a new owner.", "owner-decision", "Inspect claim"),
  OWNER_DECISION: entry("owner", "owner", "Work is waiting for your decision.", "No tool can honestly choose this product or approval gate for you.", "Review the recorded recommendation and accept or redirect it.", "owner-decision", "Review decision"),
  WAITING_EXTERNAL: entry("owner", "external", "Work is waiting on something outside the project.", "Repeating the same work cannot change that dependency.", "Refresh the dependency and continue only when its state changes.", "scan", "Check again"),
  CI_NO_EXECUTION: entry("owner", "external", "GitHub checks did not run.", "A red mark with zero executed jobs proves nothing about the code.", "Use the local verification gate and handle the account state separately.", "run-audit", "Run local check"),
  CI_FAILED: entry("broken", "agent", "A real CI job ran and failed.", "The branch does not have a clean hosted verification result.", "Open the exact failure and repair the cause without bypassing it.", "open-codex", "Open in Codex", "codex"),
  SOURCE_UNREACHABLE: entry("broken", "read", "A required project source is unreachable.", "Compy cannot safely infer the missing state.", "Restore the source and scan again.", "scan", "Scan again"),
  UNPUBLISHED_WORK: entry("advisory", "agent", "Work exists only on this machine or has no durable pointer.", "A disk failure or forgotten folder could lose it.", "Inspect it and decide whether to preserve or retire it.", "open-codex", "Open in Codex", "codex"),
  ORPHAN_FOLDER: entry("advisory", "read", "A folder is no longer a known checkout.", "It may be harmless debris or preserved work; the name alone cannot decide.", "Inspect its contents before any cleanup.", "inspect", "Inspect folder"),
  STALE_IDE_LOCK: entry("advisory", "read", "An editor lock appears stale.", "It can confuse handoff detection, but age alone does not prove it is dead.", "Verify its endpoint and process before cleanup.", "inspect", "Verify lock"),
  UNKNOWN_CONDITION: entry("advisory", "agent", "Compy found a condition it does not yet recognize.", "Guessing a repair would be less safe than preserving the evidence.", "Send the structured evidence to Claude for diagnosis.", "open-claude", "Open in Claude", "claude"),
});

export function resolveDoctorFinding(finding) {
  const base = PLAYBOOK[finding.code] ?? PLAYBOOK.UNKNOWN_CONDITION;
  return { ...finding, ...base, action: { ...base.action } };
}
```

- [ ] **Step 5: Run the focused tests and prove red became green**

Run:

```powershell
npm test -- tools/console/doctor-findings.test.mjs
```

Expected: the new file passes with zero failures. Mutation-check at least these two changes manually: remove one `PLAYBOOK` entry and invert the priority sort; each mutation must fail a named test before restoring the source.

- [ ] **Step 6: Commit the finding contract**

```powershell
git add tools/console/doctor-findings.mjs tools/console/doctor-playbook.mjs tools/console/doctor-findings.test.mjs
git commit -m "feat(console): define project doctor findings"
```

### Task 2: Allowlisted zero-token scanner with one in-flight run

**Files:**

- Create: `tools/console/doctor-scan.mjs`
- Create: `tools/console/doctor-scan.test.mjs`
- Modify: `tools/console/sources.mjs`
- Modify: `tools/entry/processes.mjs`
- Modify: `tools/entry/processes.test.mjs`

**Interfaces:**

- Consumes: `discoverCheckouts()`, `inspectGitState(dir)`, `verifyHooks({ dir })`, one `readProcessSnapshot()` shared across all checkouts, `readWork()`, `readPulls()`, `readCi()`, and a narrowed lost-and-found reader.
- Produces: `AUTOMATIC_SOURCE_NAMES`, `SLOW_SOURCE_NAMES`, `scanDoctor({ includeSlow, now, readers })`, and `createDoctorScanner({ scan })`.
- `scanDoctor()` returns the exact snapshot consumed by Task 1.
- `createDoctorScanner().run()` returns `{ busy: true }` when a prior scan is in flight; it never starts a second scan.

- [ ] **Step 1: Write the failing zero-token and no-overlap tests**

Create `tools/console/doctor-scan.test.mjs`:

```js
import { describe, expect, it, vi } from "vitest";
import { AUTOMATIC_SOURCE_NAMES, createDoctorScanner, scanDoctor } from "./doctor-scan.mjs";

const fixtureReaders = () => ({
  checkouts: vi.fn(() => []),
  processes: vi.fn(() => ({ ok: true, value: [], error: null })),
  work: vi.fn(() => ({ ok: true, items: [] })),
  pulls: vi.fn(() => ({ ok: true, value: [] })),
  ci: vi.fn(() => ({ ok: true, value: { meaningful: true, runs: [] } })),
  lostAndFound: vi.fn(() => []),
});

describe("zero-token Doctor scans", () => {
  it("has an explicit automatic allowlist with no agent or chat source", () => {
    expect(AUTOMATIC_SOURCE_NAMES).toEqual(["processes", "checkouts", "work"]);
    expect(AUTOMATIC_SOURCE_NAMES.join(" ")).not.toMatch(/agent|claude|codex|chat|audit/i);
  });

  it("does not call PR or CI readers during a light scan", () => {
    const readers = fixtureReaders();
    scanDoctor({ includeSlow: false, readers, now: new Date("2026-08-02T12:00:00Z") });
    expect(readers.pulls).not.toHaveBeenCalled();
    expect(readers.ci).not.toHaveBeenCalled();
    expect(readers.processes).toHaveBeenCalledOnce();
  });

  it("reports a failed process probe instead of treating it as no processes", () => {
    const readers = fixtureReaders();
    readers.processes.mockReturnValue({ ok: false, value: [], error: "CIM unavailable" });
    const result = scanDoctor({ includeSlow: false, readers, now: new Date("2026-08-02T12:00:00Z") });
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "SOURCE_UNREACHABLE", subject: expect.objectContaining({ source: "processes" }) }),
    ]));
  });

  it("coalesces overlapping requests instead of starting another scan", async () => {
    let release;
    const scan = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const scanner = createDoctorScanner({ scan });
    const first = scanner.run();
    expect(await scanner.run()).toEqual({ busy: true });
    release({ generatedAt: "now", findings: [] });
    await first;
    expect(scan).toHaveBeenCalledOnce();
  });

  it("keeps finding state across scans only in process memory", async () => {
    const scan = vi.fn(({ previous }) => ({ generatedAt: "now", findings: previous.length
      ? [{ fingerprint: "x", state: "unchanged" }]
      : [{ fingerprint: "x", state: "new" }] }));
    const scanner = createDoctorScanner({ scan });
    const first = await scanner.run();
    const second = await scanner.run();
    expect(first.findings[0].state).toBe("new");
    expect(scan.mock.calls[1][0].previous).toEqual(first.findings);
    expect(second.findings[0].state).toBe("unchanged");
  });

  it("retains slow-finding identity across intervening light scans", async () => {
    const scan = vi.fn(({ includeSlow, previous }) => ({ generatedAt: "now", findings: includeSlow
      ? [{ code: "CI_FAILED", fingerprint: "ci", state: previous.some((item) => item.fingerprint === "ci") ? "unchanged" : "new" }]
      : [] }));
    const scanner = createDoctorScanner({ scan });
    expect((await scanner.run({ includeSlow: true })).findings[0].state).toBe("new");
    await scanner.run({ includeSlow: false });
    expect((await scanner.run({ includeSlow: true })).findings[0].state).toBe("unchanged");
  });
});
```

Also extend the source import in `tools/entry/processes.test.mjs` to include `readProcessSnapshot` and its Vitest import to include `vi`, then add:

```js
it("reports a process-probe failure without changing list compatibility", () => {
  const run = () => { throw new Error("CIM unavailable\nsecret detail"); };
  expect(readProcessSnapshot({ run })).toEqual({ ok: false, value: [], error: "CIM unavailable" });
});

it("includes machine-wide installer names in the live probe", () => {
  const run = vi.fn(() => "");
  readProcessSnapshot({ run });
  expect(run.mock.calls[0][1].at(-1)).toMatch(/Name LIKE '%setup\.exe'|Name LIKE '%installer\.exe'/);
  expect(run.mock.calls[0][1].at(-1)).toContain("Name='msiexec.exe'");
});
```

- [ ] **Step 2: Run both tests and verify the missing contracts are red**

```powershell
npm test -- tools/console/doctor-scan.test.mjs tools/entry/processes.test.mjs
```

Expected: FAIL on the missing `doctor-scan.mjs` import and missing `readProcessSnapshot` export.

- [ ] **Step 3: Add one reachability-aware process snapshot and checkout-safe local source**

In `tools/entry/processes.mjs`, keep `listProcesses()` backward compatible but move its probe into this exported result:

```js
export function readProcessSnapshot({ names = WATCHED, run = execFileSync } = {}) {
  const filter = [...names.map((name) => `Name='${name}'`), "Name LIKE '%setup.exe'", "Name LIKE '%installer.exe'", "Name='msiexec.exe'"].join(" or ");
  const command = `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object Name,CommandLine | ConvertTo-Json -Compress`;
  try {
    const out = run("pwsh", ["-NoProfile", "-NonInteractive", "-Command", command], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
    }).trim();
    if (!out) return { ok: true, value: [], error: null };
    const parsed = JSON.parse(out);
    const rows = (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({ name: row.Name, commandLine: row.CommandLine ?? "" }));
    return { ok: true, value: rows, error: null };
  } catch (error) {
    return { ok: false, value: [], error: String(error?.message ?? error).split("\n")[0].slice(0, 240) };
  }
}

export function listProcesses({ names = WATCHED } = {}) {
  return readProcessSnapshot({ names }).value;
}
```

In `tools/console/sources.mjs`, export a pure `readCheckoutHealth()` that composes existing readers without calling `readAgents()`:

```js
import { inspectGitState } from "../entry/git-state.mjs";
import { classifyProcesses, readProcessSnapshot } from "../entry/processes.mjs";
import { hookRepairPlan, verifyHooks } from "../entry/hooks-verify.mjs";
import { readLocks, isAlive } from "../entry/ide-bridge.mjs";

export { readProcessSnapshot };

export function readCheckoutHealth({ checkouts = discoverCheckouts({ roots: [CODE_ROOT] }), processRows = [] } = {}) {
  return checkouts.map((checkout) => {
    const hooks = verifyHooks({ dir: checkout.path });
    const repair = hooks.ok ? null : hookRepairPlan({ verify: hooks, canonicalDir: join(CONTROL_DIR, ".claude", "hooks") });
    return {
      ...checkout,
      project: basename(checkout.path),
      git: inspectGitState(checkout.path),
      hooks: { ...hooks, repairable: repair?.ok === true, repairReason: repair?.reason ?? null },
      processes: classifyProcesses(processRows, { folder: checkout.path }),
    };
  });
}

export function readProvenStaleIdeLocks({ locks = readLocks(), alive = isAlive } = {}) {
  return locks.filter((lock) => lock.pid === null || !alive(lock.pid)).map((lock) => ({
    kind: "stale", name: lock.file, risk: "dead editor lock", why: "Its recorded process is not alive.",
    provenDead: true, pid: lock.pid,
  }));
}
```

Do not add `readAgents`, `resolveAgent`, `planAgentSpawn`, `exec claude`, or `exec codex` anywhere in this call graph.
Keep `WORKTREE_MULTI_WRITER` dormant until a supported source can prove session-to-folder identity. Process names, editor locks, and guessed Claude/Codex ownership are not enough to emit it.
Replace the current blanket "all lock files are stale" contribution in `readLostAndFound()` with `readProvenStaleIdeLocks()`. Add a regression fixture proving a live PID is excluded and a dead PID is included; Project Doctor never classifies age or file existence alone as stale evidence.

- [ ] **Step 4: Implement the scanner and in-flight gate**

Create `tools/console/doctor-scan.mjs`:

```js
import { CODE_ROOT, readCheckoutHealth, readProcessSnapshot, readWork, readPulls, readCi, readLostAndFound } from "./sources.mjs";
import { normalizeDoctorFindings } from "./doctor-findings.mjs";

export const AUTOMATIC_SOURCE_NAMES = Object.freeze(["processes", "checkouts", "work"]);
export const SLOW_SOURCE_NAMES = Object.freeze(["pulls", "ci", "lostAndFound"]);

const DEFAULT_READERS = Object.freeze({
  processes: readProcessSnapshot,
  checkouts: readCheckoutHealth,
  work: readWork,
  pulls: readPulls,
  ci: readCi,
  lostAndFound: readLostAndFound,
});

const reached = (fn, fallback) => {
  try {
    const value = fn();
    return value && typeof value === "object" && "ok" in value ? value : { ok: true, value, error: null };
  }
  catch (error) { return { ok: false, value: fallback, error: String(error?.message ?? error).split("\n")[0] }; }
};

export function scanDoctor({ includeSlow = false, now = new Date(), readers = DEFAULT_READERS, previous = [] } = {}) {
  const processes = reached(() => readers.processes(), []);
  const local = reached(() => readers.checkouts({ processRows: processes.value }), []);
  const board = reached(() => readers.work({ now }), { ok: false, items: [] });
  const pulls = includeSlow ? reached(() => readers.pulls(), []) : null;
  const ci = includeSlow ? reached(() => readers.ci(), { meaningful: false, runs: [] }) : null;
  const lost = includeSlow ? reached(() => readers.lostAndFound({
    work: board, pulls,
  }), []) : { ok: true, value: [] };
  const snapshot = {
    generatedAt: now.toISOString(),
    sources: { processes: { ok: processes.ok, error: processes.error }, local: { ok: local.ok, error: local.error }, board: { ok: board.ok, error: board.error }, ...(includeSlow ? { slow: { ok: pulls.ok && ci.ok && lost.ok, error: pulls.error ?? ci.error ?? lost.error } } : {}) },
    checkouts: local.value,
    work: board,
    ci,
    lostAndFound: lost.value,
  };
  return { ...snapshot, findings: normalizeDoctorFindings(snapshot, { previous, codeRoot: CODE_ROOT }) };
}

export function createDoctorScanner({ scan = scanDoctor } = {}) {
  let inFlight = null, previous = [];
  const slowCode = new Set(["CI_NO_EXECUTION", "CI_FAILED", "UNPUBLISHED_WORK", "ORPHAN_FOLDER", "STALE_IDE_LOCK"]);
  const cameFromSlowScan = (finding) => slowCode.has(finding.code) || finding.subject?.source === "slow" || finding.subject?.source === "ci";
  return {
    run(options = {}) {
      if (inFlight) return Promise.resolve({ busy: true });
      inFlight = Promise.resolve()
        .then(() => scan({ ...options, previous }))
        .then((result) => {
          if (Array.isArray(result.findings)) previous = options.includeSlow
            ? result.findings
            : [...result.findings, ...previous.filter(cameFromSlowScan)];
          return result;
        })
        .finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}
```

Preserve `readLostAndFound()`'s current nullish defaulting: an explicitly supplied failed/empty `pulls` wrapper is data and must not trigger a second `readPulls()` call. Add that fixture to `tools/console/workflow.test.mjs`. A light scan remains structurally unable to call `readPulls()` or `readCi()` because it never calls `readLostAndFound()`.

- [ ] **Step 5: Run the scanner, source, and existing workflow tests**

```powershell
npm test -- tools/console/doctor-scan.test.mjs tools/console/workflow.test.mjs tools/entry/processes.test.mjs tools/entry/git-state.test.mjs tools/entry/hooks-verify.test.mjs
```

Expected: all selected files pass. Mutation-check by adding `readers.ci()` to the light branch, converting a failed process probe to `{ ok: true }`, and removing the `inFlight` guard; the named tests must fail before restoring all three.

- [ ] **Step 6: Commit the scanner**

```powershell
git add tools/console/doctor-scan.mjs tools/console/doctor-scan.test.mjs tools/console/sources.mjs tools/console/workflow.test.mjs tools/entry/processes.mjs tools/entry/processes.test.mjs
git commit -m "feat(console): add zero-token doctor scan"
```

### Task 3: Read-only Doctor preview endpoint and asset boundary

**Files:**

- Modify: `tools/console/server.mjs`
- Modify: `tools/console/server-contract.test.mjs`
- Create initially as minimal fixtures: `tools/console/doctor.html`, `tools/console/doctor.css`, `tools/console/doctor-ui.mjs`, `tools/console/doctor-view.mjs`

**Interfaces:**

- Consumes: `createDoctorScanner().run({ includeSlow })` from Task 2.
- Produces: `GET /doctor`, `GET /doctor.css`, `GET /doctor-ui.mjs`, `GET /doctor-view.mjs`, `GET /doctor-findings.mjs`, `GET /doctor-playbook.mjs`, and `GET /api/doctor/scan?slow=0|1`.
- `createConsoleServer()` gains injectable `doctorScanner`; no test reaches the real filesystem, board, or GitHub unless explicitly exercising the real reader.
- `/api/meta?surface=doctor` returns the revision embedded in `doctor.html`; the legacy `/api/meta` contract remains unchanged in this plan.

- [ ] **Step 1: Add failing endpoint, revision, origin, and legacy-preservation tests**

Append to `tools/console/server-contract.test.mjs`:

```js
describe("the Project Doctor preview is isolated and read-only", () => {
  it("serves the preview and its matching revision without changing the legacy root", async () => {
    const doctorScanner = { run: vi.fn(async () => ({ generatedAt: "now", findings: [] })) };
    const { port } = await start({ doctorScanner });
    const legacy = await request(port, { path: "/", method: "GET" });
    const doctor = await request(port, { path: "/doctor", method: "GET" });
    const meta = await request(port, { path: "/api/meta?surface=doctor", method: "GET" });
    expect(legacy.text).toContain("Continue");
    expect(doctor.text).toContain("Project Doctor");
    expect(JSON.parse(meta.text).revision).toBe(/PAGE_REVISION = "([0-9a-f]{12})"/.exec(doctor.text)?.[1]);
  });

  it("rejects a foreign browser before the scanner runs", async () => {
    const doctorScanner = { run: vi.fn(async () => ({ findings: [] })) };
    const { port } = await start({ doctorScanner });
    const response = await request(port, { path: "/api/doctor/scan", method: "GET", origin: "https://attacker.invalid" });
    expect(response.status).toBe(403);
    expect(doctorScanner.run).not.toHaveBeenCalled();
  });

  it("maps only slow=1 to the slow source group", async () => {
    const doctorScanner = { run: vi.fn(async () => ({ generatedAt: "now", findings: [] })) };
    const { port } = await start({ doctorScanner });
    await request(port, { path: "/api/doctor/scan?slow=0", method: "GET" });
    await request(port, { path: "/api/doctor/scan?slow=1", method: "GET" });
    expect(doctorScanner.run.mock.calls.map(([x]) => x.includeSlow)).toEqual([false, true]);
  });
});
```

Update the `request()` test helper so GET requests do not send a JSON body or `content-length`; keep its existing POST behavior.

- [ ] **Step 2: Run the contract test and verify the preview routes fail**

```powershell
npm test -- tools/console/server-contract.test.mjs
```

Expected: FAIL with `/doctor` or `/api/doctor/scan` returning 404.

- [ ] **Step 3: Generalize static revision rendering and add an explicit asset allowlist**

In `tools/console/server.mjs`, replace the one-file helpers with filename-aware helpers and an allowlist:

```js
const pageSource = (name = "index.html") => readFileSync(join(HERE, name), "utf8");
const pageRevision = (name = "index.html") => createHash("sha256").update(pageSource(name)).digest("hex").slice(0, 12);
const renderedPage = (name = "index.html") => pageSource(name).replace("__COMPY_PAGE_REVISION__", pageRevision(name));

const DOCTOR_ASSETS = Object.freeze({
  "/doctor.css": ["doctor.css", "text/css; charset=utf-8"],
  "/doctor-ui.mjs": ["doctor-ui.mjs", "text/javascript; charset=utf-8"],
  "/doctor-view.mjs": ["doctor-view.mjs", "text/javascript; charset=utf-8"],
  "/doctor-findings.mjs": ["doctor-findings.mjs", "text/javascript; charset=utf-8"],
  "/doctor-playbook.mjs": ["doctor-playbook.mjs", "text/javascript; charset=utf-8"],
});
```

Do not accept a requested filesystem path from the URL; only serve keys in `DOCTOR_ASSETS`.

- [ ] **Step 4: Inject the scanner and add the guarded read-only routes**

Add `doctorScanner = createDoctorScanner()` to `createConsoleServer()` and route in this order:

```js
if (url.pathname === "/doctor") return send(res, 200, renderedPage("doctor.html"), "text/html; charset=utf-8");
if (DOCTOR_ASSETS[url.pathname]) {
  const [name, type] = DOCTOR_ASSETS[url.pathname];
  return send(res, 200, readFileSync(join(HERE, name), "utf8"), type);
}
if (url.pathname === "/api/meta" && url.searchParams.get("surface") === "doctor") {
  return send(res, 200, { revision: pageRevision("doctor.html") });
}
if (url.pathname === "/api/doctor/scan" && req.method === "GET") {
  const result = await doctorScanner.run({ includeSlow: url.searchParams.get("slow") === "1" });
  return send(res, result.busy ? 409 : 200, result);
}
```

Change the origin check to a predicate that treats every `/api/doctor/` route as guarded. Preserve origin-less local clients and the current same-origin behavior.

- [ ] **Step 5: Create minimal preview assets that make the route contract real**

Create `doctor.html` with the required stylesheet/module links and `const PAGE_REVISION = "__COMPY_PAGE_REVISION__";`. Create syntactically valid `doctor.css`, `doctor-ui.mjs`, and `doctor-view.mjs` exports even though Task 4 supplies the complete UI. The preview must say **Project Doctor**, not claim a scan is working yet, and include no model call.

- [ ] **Step 6: Run the server contract and syntax checks**

```powershell
node --check tools/console/server.mjs
node --check tools/console/doctor-ui.mjs
node --check tools/console/doctor-view.mjs
npm test -- tools/console/server-contract.test.mjs
```

Expected: all commands exit 0, `/` still contains Continue, and `/doctor` carries its own revision.

- [ ] **Step 7: Commit the preview boundary**

```powershell
git add tools/console/server.mjs tools/console/server-contract.test.mjs tools/console/doctor.html tools/console/doctor.css tools/console/doctor-ui.mjs tools/console/doctor-view.mjs
git commit -m "feat(console): isolate project doctor preview"
```

### Task 4: Checkup, Problems, and Repairs read-only interface

**Files:**

- Modify: `tools/console/doctor.html`
- Modify: `tools/console/doctor.css`
- Modify: `tools/console/doctor-ui.mjs`
- Modify: `tools/console/doctor-view.mjs`
- Create: `tools/console/doctor-ui.test.mjs`

**Interfaces:**

- Consumes: `{ generatedAt, findings }` from `/api/doctor/scan` and `resolveDoctorFinding()` from Task 1.
- Produces: `renderCheckup(model)`, `renderProblems(findings)`, `renderRepairs(findings, receipts)`, `createDoctorController(deps)`, and browser initialization.
- Browser-only transient state is exactly `{ snapshot, receipts, scanCount, inFlight, activeView }`; finding continuity lives only in the server scanner's process memory and neither side writes it to storage.

- [ ] **Step 1: Write failing primary-navigation, copy-grammar, token, timer, and accessibility tests**

Create `tools/console/doctor-ui.test.mjs`:

```js
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createDoctorController } from "./doctor-ui.mjs";
import { renderProblems } from "./doctor-view.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(join(here, "doctor.html"), "utf8");
const CSS = readFileSync(join(here, "doctor.css"), "utf8");

describe("Project Doctor owner journey", () => {
  it("has exactly Checkup, Problems, and Repairs as primary navigation", () => {
    const nav = /<nav[^>]*aria-label="Project Doctor"[^>]*>([\s\S]*?)<\/nav>/.exec(PAGE)?.[1] ?? "";
    expect(nav.match(/data-view=/g)).toHaveLength(3);
    expect(nav).toMatch(/Checkup/); expect(nav).toMatch(/Problems/); expect(nav).toMatch(/Repairs/);
    expect(nav).not.toMatch(/Continue|Start|History|Chat/);
  });

  it("renders the four-part problem grammar and exactly one primary action", () => {
    const html = renderProblems([{ code: "DIRTY_WORKTREE", fingerprint: "x", project: "sentinel", scope: "folder", priority: "broken", state: "new", subject: {}, evidence: [] }]);
    for (const copy of ["What happened", "Why it matters", "Compy recommends"]) expect(html).toContain(copy);
    expect((html.match(/data-primary-action=/g) ?? [])).toHaveLength(1);
  });

  it("runs light scans at 60 seconds and slow scans every fifth cycle without overlap", async () => {
    vi.useFakeTimers();
    const scan = vi.fn(async () => ({ generatedAt: "now", findings: [] }));
    const controller = createDoctorController({ scan, render: vi.fn(), announce: vi.fn(), visible: () => true });
    await controller.start();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(scan.mock.calls.map(([x]) => x.slow)).toEqual([true, false, false, false, false, true]);
    controller.stop(); vi.useRealTimers();
  });

  it("contains no automatic agent or chat request", () => {
    const source = readFileSync(join(here, "doctor-ui.mjs"), "utf8");
    expect(source).not.toMatch(/\/api\/chat|claude(?:\.exe)?|codex(?:\.exe)?|localStorage|sessionStorage|showNotification|new Notification/i);
  });

  it("does not announce an unchanged finding again", async () => {
    const announce = vi.fn();
    const scan = vi.fn(async () => ({ generatedAt: "now", findings: [{ fingerprint: "x", priority: "owner", state: "unchanged" }] }));
    const controller = createDoctorController({ scan, render: vi.fn(), announce, visible: () => true, setTimer: vi.fn() });
    await controller.start();
    expect(announce).not.toHaveBeenCalled();
  });

  it("shows existing findings on first open without calling them newly discovered", async () => {
    const announce = vi.fn();
    const snapshots = [
      { generatedAt: "one", findings: [{ fingerprint: "old", state: "new" }] },
      { generatedAt: "two", findings: [{ fingerprint: "old", state: "unchanged" }, { fingerprint: "new", state: "new" }] },
    ];
    const controller = createDoctorController({ scan: vi.fn(async () => snapshots.shift()), render: vi.fn(), announce, visible: () => true, setTimer: vi.fn() });
    await controller.start();
    expect(announce).not.toHaveBeenCalled();
    await controller.scanNow();
    expect(announce).toHaveBeenCalledWith("1 thing needs attention.");
  });

  it("has visible focus, reduced motion, and color-independent state labels", () => {
    expect(CSS).toMatch(/:focus-visible/);
    expect(CSS).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(PAGE).toMatch(/id="doctorAnnouncer"[^>]*aria-live="polite"/);
    expect(PAGE).toMatch(/id="scanStatus"[^>]*role="status"/);
  });
});
```

- [ ] **Step 2: Run the UI test and verify the minimal fixtures fail the contract**

```powershell
npm test -- tools/console/doctor-ui.test.mjs
```

Expected: FAIL on missing navigation, renderer output, or controller behavior.

- [ ] **Step 3: Build the semantic three-view document**

`doctor.html` must contain this structure and no chat/history composer:

```html
<body data-view="checkup">
  <div class="doctor-shell">
    <aside class="doctor-rail">
      <a class="doctor-brand" href="/doctor" aria-label="Compy Project Doctor home">Compy <span>Project Doctor</span></a>
      <nav aria-label="Project Doctor">
        <button type="button" data-view="checkup" aria-current="page">Checkup</button>
        <button type="button" data-view="problems">Problems <span id="problemCount" aria-hidden="true">0</span></button>
        <button type="button" data-view="repairs">Repairs <span id="repairCount" aria-hidden="true">0</span></button>
      </nav>
      <button id="scanNow" type="button">Scan now</button>
      <div id="scanStatus" role="status">Not checked yet</div>
      <details><summary>Details</summary><div id="sourceDetails"></div></details>
    </aside>
    <main id="doctorMain" tabindex="-1">
      <section id="checkup" data-pane="checkup"></section>
      <section id="problems" data-pane="problems" hidden></section>
      <section id="repairs" data-pane="repairs" hidden></section>
    </main>
  </div>
  <div id="doctorAnnouncer" class="sr-only" aria-live="polite" aria-atomic="true"></div>
  <script>const PAGE_REVISION = "__COMPY_PAGE_REVISION__";</script>
  <script type="module" src="/doctor-ui.mjs"></script>
</body>
```

- [ ] **Step 4: Implement pure escaped renderers**

In `doctor-view.mjs`, export `escapeHtml`, `renderCheckup`, `renderProblems`, and `renderRepairs`. `renderProblems()` calls `resolveDoctorFinding()` and renders one `<button data-primary-action="...">`; raw evidence appears only inside `<details>` after escaping. Healthy Checkup copy is exactly **Everything looks healthy.** Attention copy is exactly **N things need attention.** with correct singular. Repairs renders **No safe repairs are ready.** until the later plan adds an executable `safe-local` action.

Use this action renderer so one card cannot grow several competing primary buttons:

```js
const actionButton = (finding) => `<button type="button" class="primary-action"
  data-primary-action="${escapeHtml(finding.action.kind)}"
  data-fingerprint="${escapeHtml(finding.fingerprint)}">${escapeHtml(finding.action.label)}</button>`;
```

- [ ] **Step 5: Implement the controller, visibility behavior, and change announcements**

In `doctor-ui.mjs`, export a testable controller and initialize it only when `document` exists:

```js
export const LIGHT_SCAN_MS = 60_000;
export const SLOW_EVERY = 5;

export function createDoctorController({ scan, render, announce, visible, setTimer = setInterval, clearTimer = clearInterval }) {
  let snapshot = null, receipts = [], scanCount = 0, inFlight = false, timer = null;
  const run = async ({ forceSlow = false } = {}) => {
    if (inFlight || !visible()) return { skipped: true };
    inFlight = true;
    const slow = forceSlow || scanCount % SLOW_EVERY === 0;
    try {
      const next = await scan({ slow });
      if (next.busy) return next;
      const attention = next.findings.filter((x) => x.state === "new" || x.state === "worsened");
      const firstRender = snapshot === null;
      snapshot = next; scanCount += 1;
      render({ snapshot, receipts });
      if (!firstRender && attention.length) announce(`${attention.length} ${attention.length === 1 ? "thing needs" : "things need"} attention.`);
      return next;
    } finally { inFlight = false; }
  };
  return {
    start: async () => { await run({ forceSlow: true }); timer = setTimer(() => run(), LIGHT_SCAN_MS); },
    stop: () => { if (timer) clearTimer(timer); timer = null; },
    scanNow: () => run({ forceSlow: true }),
    snapshot: () => snapshot,
  };
}
```

The browser `scan` dependency fetches `/api/doctor/scan?slow=${slow ? 1 : 0}`. On HTTP 409 it returns `{ busy: true }`. On `visibilitychange`, do not accumulate missed timers; when the page becomes visible, run one light scan.

- [ ] **Step 6: Apply the calm instrument-panel CSS**

`doctor.css` must use the existing local Geist fonts and Compy dark token family, one-column exception hierarchy, and these non-negotiable rules:

```css
:root{color-scheme:dark;--bg:#090b10;--panel:#10141c;--line:#242a36;--text:#f2f4f8;--muted:#9da6b7;--accent:#a78bfa;--danger:#ff6b75;--owner:#f2b84b;--advisory:#7f91aa;--ok:#6fd19a}
*{box-sizing:border-box}
body{margin:0;min-width:320px;background:var(--bg);color:var(--text);font-family:Geist,system-ui,sans-serif}
button:focus-visible,summary:focus-visible,a:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.finding[data-priority="collision"],.finding[data-priority="broken"]{border-inline-start-color:var(--danger)}
.finding[data-priority="owner"]{border-inline-start-color:var(--owner)}
.finding[data-priority="advisory"]{border-inline-start-color:var(--advisory)}
@media(max-width:760px){.doctor-shell{grid-template-columns:1fr}.doctor-rail{position:static}.doctor-rail nav{display:grid;grid-template-columns:repeat(3,1fr)}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
```

Do not use gradients, glow fields, serif type, text smaller than 12 CSS pixels, color-only labels, or cards for healthy zeroes.

- [ ] **Step 7: Run focused UI and endpoint tests**

```powershell
node --check tools/console/doctor-ui.mjs
node --check tools/console/doctor-view.mjs
npm test -- tools/console/doctor-findings.test.mjs tools/console/doctor-scan.test.mjs tools/console/doctor-ui.test.mjs tools/console/server-contract.test.mjs
```

Expected: all selected files pass with zero failures. Mutation-check the timer from `60_000` to `6_000`, add `/api/chat` to the scan function, and remove the reduced-motion block; each change must fail a named guard before restoration.

- [ ] **Step 8: Run the preview and perform the foundation capture review**

Run the server on a non-live port so the current Console on 4517 is untouched:

```powershell
$env:COMPY_CONSOLE_PORT='4527'
node tools/console/server.mjs
```

Open `http://127.0.0.1:4527/doctor`. Capture and inspect these states at 1440×900 and 760×900: healthy, collision first, source unreachable, owner decision, and a scan in progress. Verify keyboard-only navigation, visible focus, no horizontal overflow at 200% zoom, and reduced motion. Any visible defect becomes a failing source/rubric guard before repair. Stop only the server started on 4527 after recording its PID.

- [ ] **Step 9: Commit the read-only Doctor UI**

```powershell
git add tools/console/doctor.html tools/console/doctor.css tools/console/doctor-ui.mjs tools/console/doctor-view.mjs tools/console/doctor-ui.test.mjs
git commit -m "feat(console): add read-only project doctor"
```

## Foundation completion gate

Do not begin the repairs/handoffs plan until all are true:

- The focused Doctor tests pass.
- Existing Console server/workflow tests pass.
- The old root `/` and every existing endpoint remain behaviorally unchanged.
- `/doctor` renders healthy and all four priority classes from deterministic fixtures.
- Five automatic timer cycles prove no call to agent/chat/model/audit paths.
- Those five cycles record duration, call the live process probe exactly once per cycle, finish each light scan before the next 60-second tick on this machine, and never overlap.
- The preview capture review is PASS at desktop, narrow, 200% zoom, keyboard-only, and reduced motion.
- `git diff origin/main...HEAD -- src-tauri src` is empty.
- An independent review accepts the foundation commit range before Task 1 of the next plan.
