# Project Doctor Repairs and Desktop Handoffs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first proven one-click repair, deterministic Claude/Codex desktop handoffs, explicit heavy verification, and transient repair receipts to the accepted read-only Doctor preview.

**Architecture:** A server-side action service re-scans and revalidates the exact finding immediately before any write, then delegates only to the canonical hook verifier/repair engine and performs a complete relevant recheck. A separate handoff planner creates provider-specific, escaped briefs; explicit POST endpoints may open registered desktop protocols, but no timer or scan path can reach them.

**Tech Stack:** Node.js ESM with built-in modules only, Vitest 4, existing `tools/entry` gather/preflight/hook-repair contracts, Windows registered URL protocols, plain browser JavaScript.

## Global Constraints

- This plan depends on every Foundation completion gate in `2026-08-02-project-doctor-foundation.md` passing first.
- Add no dependency and no `src/` or `src-tauri/` change.
- Automatic checks use no Claude or Codex tokens.
- A scan, timer, page load, focus event, or notification may never execute a repair or desktop handoff.
- The only initial `safe-local` repair is `MISSING_CANONICAL_HOOKS` when it is the sole failing preflight row and the existing canonical repair plan proves every target.
- Never duplicate hook copying, preflight reconciliation, board parsing, or Work Control authority.
- The browser sends `fingerprint`, `code`, and structured subject identity; the server re-scans and refuses stale or changed identity.
- No action automatically handles dirty work, divergence, foreign hooks, expired claims, live writers, merges, releases, processes, security/system settings, or owner decisions.
- Every mutation reports plan, result, and recheck; partial/failed work never renders as repaired.
- Repair receipts remain in page memory only. Do not use `localStorage`, `sessionStorage`, a JSON ledger, or a new database.
- Claude uses the documented `claude://code/new` route and discloses folder confirmation.
- Do not invent a Codex folder/prompt deep link. Until a supported contract is proven, Codex means open the app root and copy the brief.
- Every defect found during implementation becomes a failing guard before its fix.

---

## File map

| File | Responsibility |
|---|---|
| `tools/console/doctor-actions.mjs` | Exact repair allowlist, stale-finding validation, canonical hook repair delegation, and full recheck result. |
| `tools/console/doctor-actions.test.mjs` | Wrong/stale/foreign/dirty/collision refusal and successful red-to-green repair guards. |
| `tools/console/doctor-handoffs.mjs` | Provider-neutral brief, official Claude URI, honest Codex fallback, clipboard, and registered-protocol opener. |
| `tools/console/doctor-handoffs.test.mjs` | URI encoding, folder-confirmation copy, no invented Codex route, and no automatic provider execution guards. |
| `tools/console/doctor-playbook.mjs` | Promotes only missing canonical hooks from inspect to the executable repair action. |
| `tools/console/doctor-playbook.test.mjs` | Exact authority/action assignment and forbidden-auto-action guards. |
| `tools/console/server.mjs` | Guarded POST repair/handoff endpoints and existing explicit audit endpoint. |
| `tools/console/server-contract.test.mjs` | Origin, method, stale result, injection, and no-call-on-refusal contracts. |
| `tools/console/doctor-ui.mjs` | Explicit action dispatch, busy state, focus restoration, and transient receipt list. |
| `tools/console/doctor-view.mjs` | Repair-ready, decision, receipt, handoff, and explicit full-check markup. |
| `tools/console/doctor-ui.test.mjs` | One-primary-action, no-timer mutation, no-persistent-receipt, and accessibility guards. |

## Dependency order

```text
Foundation PASS
  -> Task 1 canonical repair service
    -> Task 2 guarded repair endpoint
  -> Task 3 desktop handoff planner and endpoint
    -> Task 4 action UI and transient receipts
      -> repairs/handoffs review gate
```

### Task 1: Fail-closed canonical hook repair service

**Files:**

- Create: `tools/console/doctor-actions.mjs`
- Create: `tools/console/doctor-actions.test.mjs`
- Modify: `tools/console/doctor-playbook.mjs`
- Create: `tools/console/doctor-playbook.test.mjs`
- Modify: `tools/console/doctor-scan.mjs`
- Modify: `tools/console/doctor-scan.test.mjs`

**Interfaces:**

- Consumes: `DoctorFinding.subject.issue`, `.folder`, `fingerprint`, and `code`; `readBoard()`, `gatherFacts()`, `reconcile()`, and `repairHooksIfSafe()`.
- Produces: `SAFE_REPAIR_CODES`, pure/read-only `inspectDoctorRepair(deps)`, scanner repair-readiness enrichment, `createDoctorRepairService(deps)`, and `service.execute({ code, fingerprint, subject })`.
- Success result is `{ ok: true, code, fingerprint, disclosure, before, after }` where `after.verdict === "PASS"`.
- Refusal result is `{ ok: false, status: 400|409|423, code, reason, before?, after?, changed?: true }`; `changed: true` is mandatory when the canonical write succeeded but its recheck did not, and callers use `status` as HTTP status.

- [ ] **Step 1: Write failing repair-authority and stale-evidence tests**

Create `tools/console/doctor-actions.test.mjs`:

```js
import { describe, expect, it, vi } from "vitest";
import { createDoctorRepairService, inspectDoctorRepair, SAFE_REPAIR_CODES } from "./doctor-actions.mjs";

const finding = (over = {}) => ({
  code: "MISSING_CANONICAL_HOOKS", fingerprint: "MISSING_CANONICAL_HOOKS|21|c:\\work|feat/x|-",
  subject: { issue: 21, folder: "C:\\work", branch: "feat/x", repairEligible: true }, ...over,
});

const deps = (over = {}) => ({
  scan: vi.fn(async () => ({ findings: [finding()] })),
  readBoard: vi.fn(() => ({ reachable: true, items: [{ number: 21, status: "Active" }] })),
  gather: vi.fn(() => ({ facts: { hooks: { dir: "C:\\work" } } })),
  reconcile: vi.fn(() => ({ verdict: "REFUSE", checks: [{ name: "hooks.present", ok: false }] })),
  planHooks: vi.fn(() => ({ ok: true, files: ["stop-continue.mjs"] })),
  repair: vi.fn(() => ({ attempted: true, ok: true, disclosure: "restored 7 canonical hooks", facts: {} })),
  recheck: vi.fn(() => ({ verdict: "PASS", checks: [] })),
  controlDir: "C:\\control",
  ...over,
});

describe("Project Doctor repair authority", () => {
  it("allowlists only missing canonical hooks", () => {
    expect([...SAFE_REPAIR_CODES]).toEqual(["MISSING_CANONICAL_HOOKS"]);
  });

  it("promotes repair only when the full preflight has exactly one repairable hook failure", () => {
    const d = deps();
    expect(inspectDoctorRepair({ finding: finding(), board: d.readBoard(), ...d })).toMatchObject({ ok: true });
    const blocked = deps({ reconcile: vi.fn(() => ({ verdict: "REFUSE", checks: [
      { name: "git.clean", ok: false }, { name: "hooks.present", ok: false },
    ] })) });
    expect(inspectDoctorRepair({ finding: finding(), board: blocked.readBoard(), ...blocked }).ok).toBe(false);
  });

  it("refuses a fingerprint that changed after the button was rendered", async () => {
    const d = deps({ scan: vi.fn(async () => ({ findings: [finding({ fingerprint: "new" })] })) });
    const result = await createDoctorRepairService(d).execute(finding());
    expect(result).toMatchObject({ ok: false, status: 409, code: "STALE_FINDING" });
    expect(d.repair).not.toHaveBeenCalled();
  });

  it.each(["DIRTY_WORKTREE", "DIVERGED_BRANCH", "FOREIGN_HOOK_OR_OVERLAY", "CLAIM_EXPIRED", "PROCESS_COLLISION"])(
    "never executes a repair for %s", async (code) => {
      const requested = finding({ code, fingerprint: `${code}|x` });
      const d = deps({ scan: vi.fn(async () => ({ findings: [requested] })) });
      const result = await createDoctorRepairService(d).execute(requested);
      expect(result.ok).toBe(false);
      expect(d.repair).not.toHaveBeenCalled();
    },
  );

  it("requires the canonical repair to turn a full recheck green", async () => {
    const d = deps();
    const result = await createDoctorRepairService(d).execute(finding());
    expect(d.repair).toHaveBeenCalledOnce();
    expect(d.recheck).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, after: { verdict: "PASS" } });
  });

  it("re-reads Work Control and all preflight facts after the write", async () => {
    const reconcile = vi.fn()
      .mockReturnValueOnce({ verdict: "REFUSE", checks: [{ name: "hooks.present", ok: false }] })
      .mockReturnValueOnce({ verdict: "PASS", checks: [] });
    const d = deps({ recheck: null, reconcile });
    const result = await createDoctorRepairService(d).execute(finding());
    expect(result.ok).toBe(true);
    expect(d.readBoard).toHaveBeenCalledTimes(2);
    expect(d.gather).toHaveBeenCalledTimes(2);
  });

  it("reports a failed recheck as still broken", async () => {
    const d = deps({ recheck: vi.fn(() => ({ verdict: "REFUSE", reason: "hooks still missing" })) });
    const result = await createDoctorRepairService(d).execute(finding());
    expect(result).toMatchObject({ ok: false, code: "RECHECK_FAILED", changed: true });
    expect(result.reason).toMatch(/restored 7 canonical hooks.*hooks still missing/i);
  });
});
```

- [ ] **Step 2: Write the failing playbook promotion/forbidden-action tests**

Create `tools/console/doctor-playbook.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import { PLAYBOOK, resolveDoctorFinding } from "./doctor-playbook.mjs";

describe("Doctor action authority", () => {
  it("offers one executable repair only when one available Work Control item owns the folder", () => {
    expect(resolveDoctorFinding({ code: "MISSING_CANONICAL_HOOKS", subject: { issue: 21, folder: "C:\\work", repairEligible: true } })).toMatchObject({
      authority: "safe-local", action: { kind: "repair-hooks", label: "Repair setup" },
    });
    expect(resolveDoctorFinding({ code: "MISSING_CANONICAL_HOOKS", subject: { issue: 22, folder: "C:\\gated", repairEligible: false } })).toMatchObject({
      authority: "read", action: { kind: "inspect", label: "Review repair" },
    });
    expect(PLAYBOOK.MISSING_CANONICAL_HOOKS.authority).toBe("read");
  });

  it("never assigns a mutating action to protected conditions", () => {
    for (const code of ["DIRTY_WORKTREE", "DIVERGED_BRANCH", "FOREIGN_HOOK_OR_OVERLAY", "CLAIM_EXPIRED", "OWNER_DECISION", "PROCESS_COLLISION"]) {
      expect(PLAYBOOK[code].action.kind).not.toMatch(/repair|delete|takeover|merge|reset|stop|kill/);
      expect(PLAYBOOK[code].authority).not.toBe("safe-local");
    }
  });
});
```

Extend `doctor-scan.test.mjs` to import `applyRepairReadiness` and add:

```js
it("promotes missing hooks only from a passing canonical readiness inspection", () => {
  const finding = { code: "MISSING_CANONICAL_HOOKS", subject: { issue: 21, folder: "C:\\work", repairEligible: false } };
  expect(applyRepairReadiness([finding], { board: { reachable: true, items: [] }, inspect: () => ({ ok: true }) })[0]).toMatchObject({
    authority: "safe-local", action: { kind: "repair-hooks" }, subject: { repairEligible: true },
  });
  expect(applyRepairReadiness([finding], { board: { reachable: true, items: [] }, inspect: () => ({ ok: false }) })[0]).toMatchObject({
    authority: "read", action: { kind: "inspect" }, subject: { repairEligible: false },
  });
});
```

- [ ] **Step 3: Run both files and verify the new action service is absent and the playbook test is red**

```powershell
npm test -- tools/console/doctor-actions.test.mjs tools/console/doctor-playbook.test.mjs tools/console/doctor-scan.test.mjs
```

Expected: FAIL on missing `doctor-actions.mjs`, missing readiness enrichment, and the absent issue-scoped repair promotion.

- [ ] **Step 4: Implement the re-scan, exact-match, canonical-repair, and recheck sequence**

Create `tools/console/doctor-actions.mjs`:

```js
import { join } from "node:path";
import { readBoard, gatherFacts } from "../entry/gather.mjs";
import { hookRepairPlan } from "../entry/hooks-verify.mjs";
import { reconcile } from "../entry/preflight.mjs";
import { repairHooksIfSafe } from "../entry/launch.mjs";

export const SAFE_REPAIR_CODES = new Set(["MISSING_CANONICAL_HOOKS"]);

export function inspectDoctorRepair({
  finding,
  board = readBoard(),
  gather = gatherFacts,
  reconcile: decide = reconcile,
  planHooks = hookRepairPlan,
  controlDir,
} = {}) {
  if (!SAFE_REPAIR_CODES.has(finding?.code)) return { ok: false, status: 400, code: "ACTION_NOT_ALLOWED", reason: "This condition has no automatic repair." };
  if (!controlDir) return { ok: false, status: 423, code: "CANONICAL_SOURCE_UNKNOWN", reason: "The canonical hook source is unknown." };
  if (!board.reachable) return { ok: false, status: 423, code: "BOARD_UNREACHABLE", reason: "Work Control is unreachable. Nothing was written." };
  const task = board.items.find((item) => Number(item.number) === Number(finding.subject?.issue));
  if (!task) return { ok: false, status: 409, code: "TASK_CHANGED", reason: "The work item is no longer present. Nothing was written." };
  const gathered = gather({ issue: task.number, task, board });
  const before = decide(gathered.facts);
  const failed = (before.checks ?? []).filter((check) => !check.ok);
  if (failed.length !== 1 || failed[0].name !== "hooks.present") {
    return { ok: false, status: 423, code: "OTHER_PREFLIGHT_FAILURE", reason: "Another safety check must be resolved first.", before };
  }
  const hookPlan = planHooks({ verify: gathered.facts.hooks, canonicalDir: join(controlDir, ".claude", "hooks") });
  if (!hookPlan.ok) return { ok: false, status: 423, code: "REPAIR_REFUSED", reason: hookPlan.reason, before };
  return { ok: true, task, board, gathered, before, hookPlan };
}

export function createDoctorRepairService({
  scan,
  readBoard: boardReader = readBoard,
  gather = gatherFacts,
  reconcile: decide = reconcile,
  planHooks = hookRepairPlan,
  repair = repairHooksIfSafe,
  recheck = null,
  controlDir,
} = {}) {
  return {
    async execute(request) {
      if (!SAFE_REPAIR_CODES.has(request?.code)) return { ok: false, status: 400, code: "ACTION_NOT_ALLOWED", reason: "This condition has no automatic repair." };
      const current = await scan({ includeSlow: false });
      const match = current.findings?.find((item) => item.fingerprint === request.fingerprint);
      if (!match || match.code !== request.code) return { ok: false, status: 409, code: "STALE_FINDING", reason: "The condition changed. Scan again before acting." };
      if (match.subject.issue !== request.subject?.issue || match.subject.folder?.toLowerCase() !== request.subject?.folder?.toLowerCase()) {
        return { ok: false, status: 409, code: "SUBJECT_CHANGED", reason: "The issue or folder changed. Nothing was written." };
      }
      const readiness = inspectDoctorRepair({ finding: match, board: boardReader(), gather, reconcile: decide, planHooks, controlDir });
      if (!readiness.ok) return readiness;
      const { gathered, before } = readiness;
      const result = repair({ facts: gathered.facts, verdict: before, controlDir });
      if (!result.attempted || !result.ok) return { ok: false, status: 423, code: "REPAIR_REFUSED", reason: result.reason ?? "The canonical repair refused.", before };
      const freshBoard = boardReader();
      if (!freshBoard.reachable) return { ok: false, status: 409, code: "RECHECK_FAILED", changed: true, reason: `${result.disclosure}. Recheck stopped: Work Control became unreachable.`, before };
      const freshTask = freshBoard.items.find((item) => Number(item.number) === Number(match.subject.issue));
      if (!freshTask) return { ok: false, status: 409, code: "RECHECK_FAILED", changed: true, reason: `${result.disclosure}. Recheck stopped: the work item changed.`, before };
      const after = recheck
        ? recheck({ task: freshTask, board: freshBoard })
        : decide(gather({ issue: freshTask.number, task: freshTask, board: freshBoard }).facts);
      if (after.verdict !== "PASS") return { ok: false, status: 409, code: "RECHECK_FAILED", changed: true, reason: `${result.disclosure}. Recheck stopped: ${after.reason ?? "the setup is still not healthy."}`, before, after };
      return { ok: true, code: request.code, fingerprint: request.fingerprint, disclosure: result.disclosure, before, after };
    },
  };
}
```

The production dependency passed as `scan` must be a direct read function (`scanDoctor`), not the one-in-flight browser scanner wrapper, so the action always takes a fresh synchronous snapshot.

- [ ] **Step 5: Promote only an issue-owned missing-hook finding**

Keep `PLAYBOOK.MISSING_CANONICAL_HOOKS` read-only. In `resolveDoctorFinding()`, promote it to `authority: "safe-local"` and `{ kind: "repair-hooks", label: "Repair setup" }` only when `finding.subject?.repairEligible === true`, `finding.subject?.issue != null`, and `Number.isInteger(Number(finding.subject.issue))` are all true. A checkout without one Work Control item and a full preflight whose sole failure is the proven canonical hook set remains **Review repair** and cannot reach the write endpoint. Do not change any other condition to `safe-local` in this plan.

```js
export function resolveDoctorFinding(finding) {
  const base = PLAYBOOK[finding.code] ?? PLAYBOOK.UNKNOWN_CONDITION;
  const repairReady = finding.code === "MISSING_CANONICAL_HOOKS"
    && finding.subject?.repairEligible === true
    && finding.subject?.issue != null
    && Number.isInteger(Number(finding.subject.issue));
  return {
    ...finding,
    ...base,
    ...(repairReady ? { authority: "safe-local", action: { kind: "repair-hooks", label: "Repair setup" } } : { action: { ...base.action } }),
  };
}
```

In `doctor-scan.mjs`, import `inspectDoctorRepair`, `resolveDoctorFinding`, and `CONTROL_DIR`, then export and use this read-only enrichment after the Foundation normalizer runs:

```js
export function applyRepairReadiness(findings, { board, inspect = inspectDoctorRepair, controlDir = CONTROL_DIR } = {}) {
  return findings.map((finding) => {
    if (finding.code !== "MISSING_CANONICAL_HOOKS") return finding;
    const readiness = inspect({ finding, board, controlDir });
    return resolveDoctorFinding({
      ...finding,
      subject: { ...finding.subject, repairEligible: readiness.ok === true },
    });
  });
}
```

Replace the final `scanDoctor()` return with:

```js
const baseFindings = normalizeDoctorFindings(snapshot, { previous, codeRoot: CODE_ROOT });
const repairBoard = { reachable: board.ok, items: board.items ?? [], error: board.error };
return { ...snapshot, findings: applyRepairReadiness(baseFindings, { board: repairBoard }) };
```

This extra preflight runs only while a structured `MISSING_CANONICAL_HOOKS` finding exists. It is read-only and zero-token. It must not inspect every healthy checkout or promote a candidate when Work Control, ownership, process, branch, settings, claim, or any other preflight row fails.

- [ ] **Step 6: Run and mutation-test the repair files**

```powershell
npm test -- tools/console/doctor-actions.test.mjs tools/console/doctor-playbook.test.mjs tools/console/doctor-scan.test.mjs tools/entry/refusal-order.test.mjs tools/entry/hooks-verify.test.mjs tools/entry/preflight.test.mjs
```

Expected: all selected files pass. Remove the fingerprint comparison, replace the allowlist with `return true`, and force the recheck PASS one mutation at a time; each mutation must fail a named test before restoration.

- [ ] **Step 7: Commit the repair service**

```powershell
git add tools/console/doctor-actions.mjs tools/console/doctor-actions.test.mjs tools/console/doctor-playbook.mjs tools/console/doctor-playbook.test.mjs tools/console/doctor-scan.mjs tools/console/doctor-scan.test.mjs
git commit -m "feat(console): bound project doctor repairs"
```

### Task 2: Guarded repair endpoint

**Files:**

- Modify: `tools/console/server.mjs`
- Modify: `tools/console/server-contract.test.mjs`

**Interfaces:**

- Consumes: injectable `doctorRepair.execute(body)` from Task 1.
- Produces: `POST /api/doctor/repair`; GET and foreign-origin requests refuse; the route maps the service's exact `status` to HTTP.

- [ ] **Step 1: Add failing HTTP method, origin, stale, and success tests**

Append:

```js
describe("Doctor repair endpoint", () => {
  it("does not expose repair as a GET", async () => {
    const doctorRepair = { execute: vi.fn() };
    const { port } = await start({ doctorRepair });
    expect((await request(port, { path: "/api/doctor/repair", method: "GET" })).status).toBe(404);
    expect(doctorRepair.execute).not.toHaveBeenCalled();
  });

  it("rejects foreign origin before reading or executing the action", async () => {
    const doctorRepair = { execute: vi.fn() };
    const { port } = await start({ doctorRepair });
    const response = await request(port, { path: "/api/doctor/repair", origin: "https://attacker.invalid", body: { code: "MISSING_CANONICAL_HOOKS" } });
    expect(response.status).toBe(403);
    expect(doctorRepair.execute).not.toHaveBeenCalled();
  });

  it("preserves stale status and successful recheck evidence", async () => {
    const doctorRepair = { execute: vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 409, code: "STALE_FINDING", reason: "changed" })
      .mockResolvedValueOnce({ ok: true, code: "MISSING_CANONICAL_HOOKS", after: { verdict: "PASS" } }) };
    const { port } = await start({ doctorRepair });
    expect((await request(port, { path: "/api/doctor/repair", body: { code: "MISSING_CANONICAL_HOOKS" } })).status).toBe(409);
    const success = await request(port, { path: "/api/doctor/repair", body: { code: "MISSING_CANONICAL_HOOKS" } });
    expect(success.status).toBe(200);
    expect(JSON.parse(success.text).after.verdict).toBe("PASS");
  });
});
```

- [ ] **Step 2: Run the server contract and verify the endpoint is absent**

```powershell
npm test -- tools/console/server-contract.test.mjs
```

Expected: FAIL with 404 for the POST route.

- [ ] **Step 3: Inject and route the repair service**

Add `doctorRepair = createDoctorRepairService({ scan: scanDoctor, controlDir: CONTROL_DIR })` to `createConsoleServer()` and add `/api/doctor/repair` to the origin-guard predicate. Route only POST:

```js
if (url.pathname === "/api/doctor/repair" && req.method === "POST") {
  const body = JSON.parse(await readBody(req));
  const result = await doctorRepair.execute(body);
  return send(res, result.ok ? 200 : result.status, result);
}
```

Do not accept a command, path, executable, or free-form action in the request body.

- [ ] **Step 4: Run server, repair, and origin tests**

```powershell
node --check tools/console/server.mjs
npm test -- tools/console/server-contract.test.mjs tools/console/doctor-actions.test.mjs
```

Expected: all selected files pass.

- [ ] **Step 5: Commit the repair endpoint**

```powershell
git add tools/console/server.mjs tools/console/server-contract.test.mjs
git commit -m "feat(console): expose guarded doctor repair"
```

### Task 3: Truthful Claude and Codex desktop handoffs

**Files:**

- Create: `tools/console/doctor-handoffs.mjs`
- Create: `tools/console/doctor-handoffs.test.mjs`
- Modify: `tools/console/server.mjs`
- Modify: `tools/console/server-contract.test.mjs`

**Interfaces:**

- Consumes: a current finding found by fingerprint and its structured subject/evidence.
- Produces: `buildDoctorBrief(finding)`, `planDoctorHandoff({ provider, finding })`, `createDoctorHandoffService(deps)`, and `POST /api/doctor/handoff`.
- Claude plan is `{ provider: "claude", mode: "prefill", uri, brief, folderConfirmation: true }`.
- Codex plan is `{ provider: "codex", mode: "open-and-copy", uri: "codex:", brief, folderConfirmation: false }` until a supported deeper contract is proven.
- VS Code plan is `{ provider: "vscode", mode: "folder-fallback", uri, brief, folderConfirmation: false }`; it appears only under finding Details when an absolute folder exists.

- [ ] **Step 1: Write failing brief, URI, fallback, and explicit-only tests**

Create `tools/console/doctor-handoffs.test.mjs`:

```js
import { describe, expect, it, vi } from "vitest";
import { buildDoctorBrief, createDoctorHandoffService, planDoctorHandoff } from "./doctor-handoffs.mjs";

const finding = { code: "DIRTY_WORKTREE", fingerprint: "dirty|x", project: "sentinel", scope: "C:\\work",
  summary: "This worktree contains unsaved work.", impact: "Automatic cleanup could discard changes.",
  recommendation: "Inspect the exact changes.", subject: { folder: "C:\\work", branch: "feat/x" },
  evidence: [{ detail: "1 modified" }] };

describe("desktop handoff plans", () => {
  it("builds one bounded brief from structured fields", () => {
    const brief = buildDoctorBrief(finding);
    for (const value of ["DIRTY_WORKTREE", "C:\\work", "feat/x", "1 modified", "Do not reset, stash, delete, merge, or stop another process."]) expect(brief).toContain(value);
  });

  it("omits raw evidence objects and redacts credential-shaped detail", () => {
    const brief = buildDoctorBrief({ ...finding, evidence: [
      { detail: "node build --token SUPERSECRET" },
      { raw: "authorization bearer LEAK" },
      ...Array.from({ length: 10 }, (_, index) => ({ detail: `safe-${index}` })),
    ] });
    expect(brief).not.toContain("SUPERSECRET");
    expect(brief).not.toContain("LEAK");
    expect(brief).not.toContain("safe-9");
    expect(brief).toContain("[redacted]");
  });

  it("uses Anthropic's documented route and encodes the folder", () => {
    const plan = planDoctorHandoff({ provider: "claude", finding });
    expect(plan.uri).toMatch(/^claude:\/\/code\/new\?/);
    expect(new URL(plan.uri).searchParams.get("folder")).toBe("C:\\work");
    expect(plan.folderConfirmation).toBe(true);
  });

  it("does not invent a Codex prompt or folder deep link", () => {
    const plan = planDoctorHandoff({ provider: "codex", finding });
    expect(plan).toMatchObject({ mode: "open-and-copy", uri: "codex:" });
    expect(plan.uri).not.toMatch(/folder|prompt|q=/);
  });

  it("keeps VS Code as an encoded folder fallback rather than primary routing", () => {
    const plan = planDoctorHandoff({ provider: "vscode", finding: { ...finding, subject: { folder: "C:\\work folder#1" } } });
    expect(plan).toMatchObject({ mode: "folder-fallback", provider: "vscode" });
    expect(plan.uri).toBe("vscode://file/C:/work%20folder%231");
  });

  it("re-scans before opening and copies only for the Codex fallback", async () => {
    const scan = vi.fn(async () => ({ findings: [finding] }));
    const openUri = vi.fn(async () => ({ ok: true }));
    const copyText = vi.fn(async () => ({ ok: true }));
    const service = createDoctorHandoffService({ scan, openUri, copyText });
    await service.execute({ provider: "codex", fingerprint: finding.fingerprint });
    expect(scan).toHaveBeenCalledOnce(); expect(copyText).toHaveBeenCalledOnce(); expect(openUri).toHaveBeenCalledWith("codex:");
  });
});
```

- [ ] **Step 2: Run the test and verify the handoff module is absent**

```powershell
npm test -- tools/console/doctor-handoffs.test.mjs
```

Expected: FAIL on missing module.

- [ ] **Step 3: Implement the exact brief and provider plans**

Create `doctor-handoffs.mjs` and resolve raw scanner findings through the deterministic playbook before building the brief:

```js
import { spawn } from "node:child_process";
import { resolveDoctorFinding } from "./doctor-playbook.mjs";

const safeDetail = (value) => String(value ?? "")
  .replace(/\b(token|authorization|api[-_ ]?key|secret)\b\s*[:=]?\s*\S+/gi, "$1 [redacted]")
  .replace(/\s+/g, " ")
  .slice(0, 240);

export function buildDoctorBrief(finding) {
  const evidence = (finding.evidence ?? []).slice(0, 8)
    .map((item) => safeDetail(item?.detail))
    .filter(Boolean)
    .map((detail) => `- ${detail}`)
    .join("\n") || "- No additional evidence.";
  return [`# Project Doctor handoff`, `Finding: ${finding.code}`, `Project: ${finding.project}`, `Folder: ${finding.subject?.folder ?? "unknown"}`,
    `Branch: ${finding.subject?.branch ?? "unknown"}`, `What happened: ${finding.summary}`, `Why it matters: ${finding.impact}`,
    `Compy recommends: ${finding.recommendation}`, `Evidence:`, evidence, `Boundary: Do not reset, stash, delete, merge, or stop another process.`,
    `Outcome requested: diagnose this condition, preserve existing work, add a guard for any defect, and report the safest next action.`].join("\n");
}

export function planDoctorHandoff({ provider, finding }) {
  const brief = buildDoctorBrief(finding);
  if (provider === "claude") {
    const uri = new URL("claude://code/new");
    uri.searchParams.set("q", brief); uri.searchParams.set("folder", finding.subject?.folder ?? "");
    return { provider, mode: "prefill", uri: uri.toString(), brief, folderConfirmation: true };
  }
  if (provider === "codex") return { provider, mode: "open-and-copy", uri: "codex:", brief, folderConfirmation: false };
  if (provider === "vscode" && /^[A-Za-z]:\\/.test(finding.subject?.folder ?? "")) {
    const uri = new URL("vscode://file/");
    uri.pathname = finding.subject.folder.replaceAll("\\", "/");
    return { provider, mode: "folder-fallback", uri: uri.toString(), brief, folderConfirmation: false };
  }
  return { provider, mode: "unsupported", uri: null, brief, folderConfirmation: false };
}

const defaultOpenUri = (uri) => new Promise((resolve) => {
  const child = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", uri], { detached: true, stdio: "ignore", windowsHide: true });
  child.once("spawn", () => { child.unref(); resolve({ ok: true }); });
  child.once("error", (error) => resolve({ ok: false, reason: String(error?.message ?? error) }));
});

const defaultCopyText = (text) => new Promise((resolve) => {
  const child = spawn("pwsh", ["-NoProfile", "-NonInteractive", "-Command", "Set-Clipboard -Value ([Console]::In.ReadToEnd())"], { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  let error = ""; child.stderr.on("data", (chunk) => { error += chunk.toString("utf8"); });
  child.once("error", (cause) => resolve({ ok: false, reason: String(cause?.message ?? cause) }));
  child.once("close", (code) => resolve(code === 0 ? { ok: true } : { ok: false, reason: error || `clipboard exit ${code}` }));
  child.stdin.end(text);
});

export function createDoctorHandoffService({ scan, openUri = defaultOpenUri, copyText = defaultCopyText } = {}) {
  return { async execute({ provider, fingerprint }) {
    const current = await scan({ includeSlow: false });
    const raw = current.findings?.find((item) => item.fingerprint === fingerprint);
    if (!raw) return { ok: false, status: 409, code: "STALE_FINDING", reason: "The condition changed. Scan again." };
    const finding = resolveDoctorFinding(raw);
    const plan = planDoctorHandoff({ provider, finding });
    if (!plan.uri) return { ok: false, status: 400, code: "UNSUPPORTED_PROVIDER", reason: "That desktop route is not supported." };
    if (plan.mode === "open-and-copy") {
      const copied = await copyText(plan.brief); if (!copied.ok) return { ok: false, status: 500, code: "COPY_FAILED", reason: copied.reason };
    }
    const opened = await openUri(plan.uri); if (!opened.ok) return { ok: false, status: 500, code: "OPEN_FAILED", reason: opened.reason };
    return { ok: true, provider, mode: plan.mode, folderConfirmation: plan.folderConfirmation, copied: plan.mode === "open-and-copy" };
  } };
}
```

- [ ] **Step 4: Prove the installed protocol behavior before wiring production defaults**

Read the three HKCU protocol registrations and the installed app versions. Live-test `claude://code/new` against a disposable fixture folder and confirm the documented folder confirmation appears. Live-test only `codex:` root opening; do not invent query parameters. Live-test one `vscode://file/` fixture folder and confirm it opens that folder. Record app versions and observed outcomes in the issue handoff, not a permanent current-state doc. If a protocol does not open, keep that provider action disabled with a truthful copy-only fallback.

- [ ] **Step 5: Add the guarded handoff endpoint with injected side effects**

Inject `doctorHandoff = createDoctorHandoffService({ scan: scanDoctor })`, add `/api/doctor/handoff` to the origin guard, and route only POST with `{ provider, fingerprint }`. The endpoint accepts no URI, folder, prompt, command, or executable from the browser. Add server tests proving foreign-origin and unsupported-provider requests call neither clipboard nor opener.

- [ ] **Step 6: Run handoff and server tests**

```powershell
node --check tools/console/doctor-handoffs.mjs
npm test -- tools/console/doctor-handoffs.test.mjs tools/console/server-contract.test.mjs
```

Expected: all selected files pass. Mutation-check by adding `folder=` to the Codex URI and by removing the Claude folder-confirmation flag; each mutation must fail.

- [ ] **Step 7: Commit desktop handoffs**

```powershell
git add tools/console/doctor-handoffs.mjs tools/console/doctor-handoffs.test.mjs tools/console/server.mjs tools/console/server-contract.test.mjs
git commit -m "feat(console): hand doctor findings to desktop apps"
```

### Task 4: Explicit repair/handoff UI and transient receipts

**Files:**

- Modify: `tools/console/doctor-view.mjs`
- Modify: `tools/console/doctor-ui.mjs`
- Modify: `tools/console/doctor-ui.test.mjs`
- Modify: `tools/console/doctor.css`

**Interfaces:**

- Consumes: playbook actions, `POST /api/doctor/repair`, `POST /api/doctor/handoff`, and existing explicit `/api/audit`.
- Produces: `dispatchDoctorAction(finding, deps)`, transient receipt `{ at, code, fingerprint, action, status, message }`, busy/focus behavior, and Repairs subsections **Ready to repair**, **Needs a decision**, and **This session**.

- [ ] **Step 1: Add failing explicit-click, receipt, focus, and no-persistence tests**

Update the existing view import in `doctor-ui.test.mjs` to `import { renderProblems, renderRepairs } from "./doctor-view.mjs";`, then add:

```js
it("cannot reach repair, handoff, or audit from the timer path", () => {
  const source = readFileSync(join(here, "doctor-ui.mjs"), "utf8");
  const controller = /export function createDoctorController[\s\S]*?\n}/.exec(source)?.[0] ?? "";
  expect(controller).not.toMatch(/doctor\/repair|doctor\/handoff|api\/audit/);
});

it("keeps receipts transient and returns focus after an action", () => {
  const source = readFileSync(join(here, "doctor-ui.mjs"), "utf8");
  expect(source).not.toMatch(/localStorage|sessionStorage|writeFile|notes\.json/);
  expect(source).toMatch(/trigger\.focus\(\)/);
  expect(source).toMatch(/finding\.action\.kind === "repair-hooks" \? "repaired" : "opened"/);
});

it("labels Claude folder confirmation and Codex copied-brief behavior", () => {
  const page = renderRepairs([
    { code: "OWNER_DECISION", fingerprint: "o", priority: "owner", authority: "owner", action: { kind: "owner-decision", label: "Review decision" }, subject: {}, evidence: [] },
    { code: "DIRTY_WORKTREE", fingerprint: "d", priority: "broken", authority: "agent", action: { kind: "open-codex", label: "Open in Codex", provider: "codex" }, subject: { folder: "C:\\work" }, evidence: [] },
  ], []);
  expect(page).toContain("Claude will ask you to confirm the folder");
  expect(page).toContain("Codex opens and the repair brief is copied");
  expect(page).toContain("Open in VS Code");
});
```

- [ ] **Step 2: Run the UI test and verify the action behavior is absent**

```powershell
npm test -- tools/console/doctor-ui.test.mjs
```

Expected: FAIL on missing dispatcher, receipt, or handoff disclosure.

- [ ] **Step 3: Implement one explicit dispatcher**

Export this shape from `doctor-ui.mjs`:

```js
export async function dispatchDoctorAction(finding, { post, runAudit, trigger }) {
  let result;
  try {
    if (finding.action.kind === "repair-hooks") result = await post("/api/doctor/repair", { code: finding.code, fingerprint: finding.fingerprint, subject: finding.subject });
    else if (finding.action.kind === "open-claude" || finding.action.kind === "open-codex") result = await post("/api/doctor/handoff", { provider: finding.action.provider, fingerprint: finding.fingerprint });
    else if (finding.action.kind === "run-audit") result = await runAudit();
    else return { at: new Date().toISOString(), code: finding.code, fingerprint: finding.fingerprint, action: finding.action.kind, status: "review", message: finding.recommendation };
    const successStatus = finding.action.kind === "repair-hooks" ? "repaired" : "opened";
    return { at: new Date().toISOString(), code: finding.code, fingerprint: finding.fingerprint, action: finding.action.kind,
      status: result.ok ? successStatus : "stopped", message: result.disclosure ?? result.reason ?? (result.ok ? "Action completed." : "Nothing further was changed.") };
  } finally { trigger.focus(); }
}
```

Only a click listener on `[data-primary-action]` calls this function. While it runs, disable only that finding's action, set button copy to **Checking…**, show a nearby `role="status"`, and leave other evidence readable. After any action, force one slow scan and render the returned state.

- [ ] **Step 4: Render the three Repairs subsections and transient receipts**

`renderRepairs(findings, receipts)` partitions by `authority === "safe-local"`, `priority === "owner"`, and receipts. Each finding still has one primary action. When a finding has an absolute folder, its evidence `<details>` includes a secondary **Open in VS Code** fallback that calls the same guarded handoff endpoint with `provider: "vscode"`; it is never primary navigation and never runs automatically. Receipt status copy is **Repaired and rechecked**, **Opened in desktop**, **Stopped safely**, or **Review needed**. Do not use green for a failed or owner-decision receipt.

- [ ] **Step 5: Wire the existing full audit as an explicit Repairs action**

Keep `/api/audit` SSE behavior. Add one separate **Run full local check** card under Repairs with copy **Heavy check · runs only when you ask · no model tokens**. It is never included in the timer controller. Preserve Stop/abort behavior and stream the result under that card, not in a hidden legacy pane.

- [ ] **Step 6: Run focused and complete Console tests**

```powershell
node --check tools/console/doctor-ui.mjs
node --check tools/console/doctor-view.mjs
npm test -- tools/console/doctor-actions.test.mjs tools/console/doctor-handoffs.test.mjs tools/console/doctor-playbook.test.mjs tools/console/doctor-ui.test.mjs tools/console/server-contract.test.mjs tools/console/workflow.test.mjs
```

Expected: all selected files pass. Mutation-check calling the dispatcher from `start()`, writing receipts to storage, and omitting `trigger.focus()`; each mutation must fail.

- [ ] **Step 7: Run isolated live action proofs**

On port 4527 with a fixture Work Control issue/worktree created for this proof:

1. Deliberately remove one fixture copy of a registered canonical hook.
2. Confirm the Doctor shows only `MISSING_CANONICAL_HOOKS` as safe-local.
3. Click **Repair setup** once.
4. Confirm the exact hook is restored, the full preflight becomes PASS, and **This session** records the result.
5. Recreate the finding, change its fingerprint/subject before clicking, and prove the action returns `STALE_FINDING` with no write.
6. Click Claude handoff and verify the prefilled brief plus folder-confirmation dialog.
7. Click Codex handoff and verify the app opens at its supported root and the exact brief is on the clipboard.
8. Observe five timer cycles and prove neither desktop app receives a new task/process from monitoring.

Delete no fixture until its exact path and process ownership have been verified; retire it through the Work Control handoff.

- [ ] **Step 8: Commit the action UI**

```powershell
git add tools/console/doctor-view.mjs tools/console/doctor-ui.mjs tools/console/doctor-ui.test.mjs tools/console/doctor.css
git commit -m "feat(console): connect doctor repairs and handoffs"
```

## Repairs and handoffs completion gate

Do not begin the default-migration plan until all are true:

- The only executable repair code is `MISSING_CANONICAL_HOOKS`.
- Stale fingerprint, changed subject, unreachable board, other preflight failure, repair refusal, and failed recheck each prove zero unauthorized writes.
- One real isolated missing-hook repair goes red to green and full preflight PASS.
- Claude handoff uses `claude://code/new`, carries the exact folder, and visibly discloses confirmation.
- Codex handoff carries no invented folder/prompt URI and proves open-and-copy behavior.
- VS Code remains a proven folder-only fallback under Details and never appears in primary navigation.
- No automatic path can reach repair, handoff, audit, agent, clipboard, or protocol opener.
- Receipts disappear after a page reload and no duplicate truth file exists.
- Focus, live status, abort, reduced motion, narrow layout, and 200% zoom pass capture review.
- Focused tests, full `tools/console` tests, TypeScript check, and doc budget pass.
- An independent review accepts this commit range and Kuya accepts the preview direction before it becomes the default.
