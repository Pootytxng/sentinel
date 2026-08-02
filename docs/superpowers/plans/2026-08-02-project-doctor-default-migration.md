# Project Doctor Default Migration and Console Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the owner-approved Project Doctor the safe default behind the existing Compy Console shortcut, prove it live, and remove the obsolete in-Console chat/history/launcher layer without weakening the canonical Work Control engine.

**Architecture:** First make the local server self-identifying and its restart fail closed. Then switch `/` to the already-proven Doctor while keeping the old page at `/legacy` for one review window. Only after Kuya accepts the live default and a call-site audit proves no remaining consumer do we remove the legacy page, chat/session/notes/launcher endpoints, and their dead modules; `tools/entry` remains untouched as the canonical workflow engine.

**Tech Stack:** Node.js ESM, Vitest 4, PowerShell 7 start script, plain HTML/CSS/JavaScript, existing GitHub/Work Control workflow.

## Global Constraints

- This plan depends on every completion gate in both preceding Project Doctor plans passing.
- Project Doctor must already pass a native-resolution owner preview before `/` changes.
- The default switch is a taste/product gate; do not merge or activate it without Kuya's explicit acceptance of the preview.
- Add no dependency and no `src/` or `src-tauri/` change.
- The Desktop shortcut continues to be one stable entry; the owner does not choose folders, terminals, or ports.
- Restart may stop only a server that proves through `/api/meta` that it is Compy Project Doctor for the exact expected repository and PID.
- A foreign or unidentified listener on port 4517 is reported and left running.
- Keep `/legacy` only for the bounded review window; do not leave a permanent hidden product that doubles maintenance.
- Remove the Console's duplicate chat/history/notes/launcher shell only after a complete call-site audit and live Doctor proof.
- Preserve all `tools/entry/**`, `.claude/hooks/**`, Work Control, context-tier, claim, worktree, preflight, and session-root machinery.
- Preserve explicit `/api/audit` and the Doctor's bounded repair/handoff endpoints.
- Never delete user conversations; native Claude/Codex histories remain owned by those applications.
- No automatic claim takeover, process termination, merge, release, installation, or system/security change.
- Automatic checks use no Claude or Codex tokens.
- Every defect found during implementation becomes a failing guard before its fix.

---

## File map

| File | Responsibility |
|---|---|
| `tools/console/server.mjs` | Self-identifying metadata, Doctor default route, bounded legacy route, then legacy endpoint/import retirement. |
| `tools/console/server-contract.test.mjs` | Default/revision/identity/origin/legacy-window and post-retirement route contracts. |
| `tools/console/start.ps1` | Idempotent open plus identity-proven restart; owner-facing Project Doctor wording. |
| `tools/console/start-cwd.test.mjs` | Existing no-folder-pin guards plus foreign-listener and exact-server restart guards. |
| `tools/console/doctor-default.test.mjs` | Exact default navigation, no old primary journey, retained heavy audit, and zero-token automatic-path guards. |
| `tools/console/doctor-retirement.test.mjs` | Complete forbidden-call-site and preserved-entry-engine assertions. |
| `tools/console/doctor.html` | Default Doctor document before the later mechanical rename to `index.html`. |
| `tools/console/index.html` | Temporary legacy page, then removed after the review window. |
| `tools/console/README.md` | Current operational contract: what the shortcut does, zero-token scans, explicit actions, evidence, and recovery. |
| Legacy modules/tests named in Task 3 | Removed only after the audit proves they have no non-legacy consumer. |

## Dependency order

```text
Foundation PASS + Repairs/Handoffs PASS + Kuya preview acceptance
  -> Task 1 identity-safe restart
    -> Task 2 Doctor becomes / and /legacy opens the old page
      -> bounded live review
        -> Task 3 remove proven-dead legacy shell
          -> Task 4 docs, full verification, PR, owner merge gate, activation
```

## Entry preconditions

Before Task 1, record all of these on the implementation issue:

1. Exact foundation and repairs/handoffs commit range.
2. Focused and complete `tools/console` test counts.
3. TypeScript and doc-budget results.
4. Five-cycle zero-token observation.
5. One real fixture hook repair and stale-finding refusal.
6. Claude and Codex live handoff results with installed app versions.
7. Native-resolution captures for healthy, collision, broken, owner, repair running, repaired, failed/stopped, and offline states.
8. Kuya's explicit acceptance of the preview direction.

If any item is missing, stop before changing `/`.

### Task 1: Identity-proven server metadata and safe restart

**Files:**

- Modify: `tools/console/server.mjs`
- Modify: `tools/console/server-contract.test.mjs`
- Modify: `tools/console/start.ps1`
- Modify: `tools/console/start-cwd.test.mjs`

**Interfaces:**

- Consumes: server `repoDir`, `process.pid`, active surface filename, and page revision.
- Produces: `/api/meta` payload `{ product: "compy-project-doctor", pid, repoDir, surface, revision }` and PowerShell `Get-ConsoleIdentity` / `Stop-OwnedConsole` functions.
- `-Restart` stops only the exact PID returned by trusted loopback metadata when `product` and canonical `repoDir` both match.
- A normal double-click also treats a responding foreign or unidentified listener as a refusal; HTTP 200 alone never proves that the Console is already running.

- [ ] **Step 1: Add failing metadata identity tests**

Extend `tools/console/server-contract.test.mjs`:

```js
describe("the server identifies itself before restart", () => {
  it("names product, PID, exact repository, active surface, and matching revision", async () => {
    const { port } = await start({ repoDir: "C:\\fixture\\sentinel" });
    const page = await request(port, { path: "/doctor", method: "GET" });
    const meta = JSON.parse((await request(port, { path: "/api/meta?surface=doctor", method: "GET" })).text);
    expect(meta).toMatchObject({ product: "compy-project-doctor", pid: process.pid, repoDir: "C:\\fixture\\sentinel", surface: "doctor" });
    expect(meta.revision).toBe(/PAGE_REVISION = "([0-9a-f]{12})"/.exec(page.text)?.[1]);
  });
});
```

- [ ] **Step 2: Add failing PowerShell source guards for foreign-listener refusal**

Append to `tools/console/start-cwd.test.mjs`:

```js
describe("restart stops only an identified Compy Doctor server", () => {
  it("requires product, repo, and PID from loopback metadata", () => {
    expect(START_PS1).toMatch(/function Get-ConsoleIdentity/);
    expect(START_PS1).toMatch(/compy-project-doctor/);
    expect(START_PS1).toMatch(/repoDir/);
    expect(START_PS1).toMatch(/\.pid/);
  });

  it("does not stop the raw port owner before identity matches", () => {
    const restart = /if \(\$Restart\)[\s\S]*?\n}/.exec(START_PS1)?.[0] ?? "";
    expect(restart).not.toMatch(/Get-NetTCPConnection[\s\S]*Stop-Process/);
    expect(restart).toMatch(/Stop-OwnedConsole/);
  });

  it("reports a foreign listener and leaves it alone", () => {
    expect(START_PS1).toMatch(/Port \$Port is in use by something other than this Compy Project Doctor/);
    expect(START_PS1).toMatch(/exit 2/);
  });

  it("requires the same identity for an ordinary focus or start", () => {
    const testConsole = /function Test-Console \{[\s\S]*?\n}/.exec(START_PS1)?.[0] ?? "";
    expect(testConsole).toMatch(/Get-ConsoleIdentity/);
    expect(testConsole).toMatch(/Test-OwnedConsoleIdentity/);
    expect(testConsole).not.toMatch(/Invoke-WebRequest/);
    expect(START_PS1).toMatch(/Test-PortListening/);
  });
});
```

- [ ] **Step 3: Run the tests and verify both contracts are red**

```powershell
npm test -- tools/console/server-contract.test.mjs tools/console/start-cwd.test.mjs
```

Expected: FAIL because metadata lacks identity and `-Restart` still stops the raw port owner.

- [ ] **Step 4: Return exact identity from `/api/meta`**

Make the metadata helper filename-aware and return:

```js
const metadata = ({ repoDir, surface, file }) => ({
  product: "compy-project-doctor",
  pid: process.pid,
  repoDir,
  surface,
  revision: pageRevision(file),
});
```

The legacy query returns `surface: "legacy"`; the Doctor query returns `surface: "doctor"`. Do not expose environment variables, command lines, tokens, usernames, or arbitrary filesystem content.

- [ ] **Step 5: Replace port-owner killing with metadata-proven restart**

In `tools/console/start.ps1`, add:

```powershell
function Get-ConsoleIdentity {
  try { return Invoke-RestMethod -Uri "${url}api/meta?surface=doctor" -TimeoutSec 3 } catch { return $null }
}

function Test-PortListening {
  return @((Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)).Count -gt 0
}

function Test-OwnedConsoleIdentity($identity) {
  $expected = [IO.Path]::GetFullPath($repo).TrimEnd('\')
  $actual = if ($identity -and $identity.repoDir) { [IO.Path]::GetFullPath([string]$identity.repoDir).TrimEnd('\') } else { '' }
  return $identity -and $identity.product -eq 'compy-project-doctor' -and $actual -eq $expected -and $identity.pid
}

function Test-Console {
  return Test-OwnedConsoleIdentity (Get-ConsoleIdentity)
}

function Stop-OwnedConsole {
  $identity = Get-ConsoleIdentity
  if (-not (Test-OwnedConsoleIdentity $identity)) {
    Write-Host "Port $Port is in use by something other than this Compy Project Doctor. It was left running." -ForegroundColor Red
    exit 2
  }
  Stop-Process -Id ([int]$identity.pid) -Force -ErrorAction Stop
}
```

Define these functions before the current availability check. The `if ($Restart)` block calls `Stop-OwnedConsole` only when `Test-PortListening` is true, then waits for that exact listener to leave; `-Restart` with no listener proceeds to a normal start. Before either focusing or starting, if `Test-PortListening` is true while `Test-Console` is false, print the same foreign-listener message and exit 2. Preserve every existing `-WorkingDirectory` browser/server guard.

The currently installed legacy server predates identity-bearing `/api/meta` and therefore cannot authenticate its repository. During this train's one-time live activation, resolve its listener PID, prove the executable is Node, prove its command line names `tools/console/server.mjs`, and compare the live legacy page revision with the current checkout's `index.html` hash; stop it only if all four match the known legacy Console. Otherwise leave it running and report the blocker. Record this one-time exception in the implementation handoff. Once the identity route ships, no future restart may use it.

- [ ] **Step 6: Run and mutation-test identity safety**

```powershell
npm test -- tools/console/server-contract.test.mjs tools/console/start-cwd.test.mjs
pwsh -NoProfile -File tools/console/start.ps1 -Port 4527 -NoBrowser
pwsh -NoProfile -File tools/console/start.ps1 -Port 4527 -NoBrowser -Restart
```

Expected: tests pass, the isolated 4527 server restarts, and the current 4517 server is untouched. Mutation-check by removing the product comparison and by replacing the metadata PID with the raw port PID; guards must fail.

- [ ] **Step 7: Commit identity-safe restart**

```powershell
git add tools/console/server.mjs tools/console/server-contract.test.mjs tools/console/start.ps1 tools/console/start-cwd.test.mjs
git commit -m "fix(console): verify doctor identity before restart"
```

### Task 2: Make Project Doctor the default with a bounded legacy review route

**Files:**

- Modify: `tools/console/server.mjs`
- Modify: `tools/console/server-contract.test.mjs`
- Modify: `tools/console/start.ps1`
- Create: `tools/console/doctor-default.test.mjs`
- Modify: `tools/console/doctor.html`

**Interfaces:**

- Consumes: the fully accepted Doctor page and the identity-safe server from Task 1.
- Produces: `/` and `/index.html` render `doctor.html`; `/legacy` renders the old `index.html`; default `/api/meta` reports Doctor revision/surface.

- [ ] **Step 1: Write the failing default and legacy-window tests**

Create `tools/console/doctor-default.test.mjs`:

```js
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const DOCTOR = readFileSync(join(here, "doctor.html"), "utf8");
const UI = readFileSync(join(here, "doctor-ui.mjs"), "utf8");

describe("Project Doctor default contract", () => {
  it("contains exactly the three approved primary views", () => {
    const nav = /<nav[^>]*aria-label="Project Doctor"[^>]*>([\s\S]*?)<\/nav>/.exec(DOCTOR)?.[1] ?? "";
    expect(nav.match(/data-view=/g)).toHaveLength(3);
    expect(nav).toMatch(/Checkup/); expect(nav).toMatch(/Problems/); expect(nav).toMatch(/Repairs/);
    expect(nav).not.toMatch(/Continue|Start|History|Chat|Questions|Ideas|Loose work/);
  });

  it("has no automatic path to chat, repair, handoff, or full audit", () => {
    const timer = /createDoctorController[\s\S]*?return \{[\s\S]*?\n}/.exec(UI)?.[0] ?? "";
    expect(timer).not.toMatch(/\/api\/chat|doctor\/repair|doctor\/handoff|\/api\/audit|claude|codex/i);
  });
});
```

Update server tests to expect root Doctor, explicit `/legacy` old page, and default metadata surface `doctor`.

- [ ] **Step 2: Run the tests and verify the server still serves the old page at root**

```powershell
npm test -- tools/console/doctor-default.test.mjs tools/console/server-contract.test.mjs
```

Expected: Doctor source contract passes; server default assertions fail because `/` still renders Continue.

- [ ] **Step 3: Switch the route mapping without deleting recovery**

Use exact route mapping:

```js
if (url.pathname === "/" || url.pathname === "/index.html") return send(res, 200, renderedPage("doctor.html"), "text/html; charset=utf-8");
if (url.pathname === "/legacy") return send(res, 200, renderedPage("index.html"), "text/html; charset=utf-8");
if (url.pathname === "/api/meta") return send(res, 200, metadata({ repoDir, surface: "doctor", file: "doctor.html" }));
```

Keep the old endpoints during this bounded review window so `/legacy` remains functional. Do not add a primary Doctor link to `/legacy`; it is an emergency review URL recorded in the issue handoff.

- [ ] **Step 4: Update only owner-facing start-script wording**

Change **Compy Console** status strings in `start.ps1` to **Compy Project Doctor**. Keep the script filename, stable shortcut target, port, app-window launch, working-directory safety, and idempotence unchanged.

- [ ] **Step 5: Run focused and complete Console tests**

```powershell
npm test -- tools/console/doctor-default.test.mjs tools/console/doctor-ui.test.mjs tools/console/server-contract.test.mjs tools/console/start-cwd.test.mjs
npm test -- tools/console
```

Expected: all Console tests pass. Tests written specifically for the old primary default must be updated to exercise `/legacy`, not deleted yet.

- [ ] **Step 6: Run the default on isolated port 4527 and obtain the owner gate**

Restart only the identity-proven 4527 server. Verify:

- `/` opens Checkup without a query or special URL.
- `/legacy` opens the old Continue/Start/History page.
- Automatic scans remain zero-token for five cycles.
- Checkup, Problems, Repairs, repair, heavy check, Claude handoff, Codex handoff, VS Code Details fallback, keyboard, reduced motion, narrow, 200% zoom, offline, and stale-page states still pass.
- The app-window chrome and Desktop shortcut behavior remain unchanged.

Present the live preview to Kuya. Stop here unless Kuya explicitly accepts Project Doctor as the default and authorizes retirement of the legacy Console shell.

- [ ] **Step 7: Commit the default switch after the owner gate**

```powershell
git add tools/console/server.mjs tools/console/server-contract.test.mjs tools/console/start.ps1 tools/console/doctor-default.test.mjs tools/console/doctor.html tools/console/owner-journey.test.mjs
git commit -m "feat(console): make project doctor the default"
```

### Task 3: Remove the proven-dead legacy Console shell

**Files:**

- Create: `tools/console/doctor-retirement.test.mjs`
- Modify: `tools/console/server.mjs`
- Modify: `tools/console/server-contract.test.mjs`
- Modify: `tools/console/sources.mjs`
- Rename mechanically: `tools/console/doctor.html` to `tools/console/index.html`
- Delete only after call-site proof: `tools/console/agents.mjs`, `tools/console/agents.test.mjs`, `tools/console/chats.mjs`, `tools/console/chats.test.mjs`, `tools/console/chat-reachable.test.mjs`, `tools/console/journey.mjs`, `tools/console/journey.test.mjs`, `tools/console/notes.mjs`, `tools/console/notes.test.mjs`, `tools/console/owner-journey.test.mjs`, `tools/console/suggestions.test.mjs`, and legacy-only portions or files identified in the audit.
- Preserve: every `tools/entry/**` file and all Doctor/audit/start files.

**Interfaces:**

- Consumes: Kuya's explicit default acceptance and the bounded `/legacy` review evidence.
- Produces: one Doctor-only local server with `/`, Doctor assets, `/api/doctor/*`, `/api/audit`, `/api/meta`, and local font routes; removed legacy routes return 404.

- [ ] **Step 1: Run the complete call-site audit before deleting anything**

Run:

```powershell
rg -n 'createNativeChatStore|planAgentSpawn|verifyPlanSubscription|streamTurn|readNotes|addIdea|addLink|providerOf|projectHistory|continueCandidate|/api/chat|/api/chats|/api/launcher|/api/notes|/journey\.mjs|/legacy' tools scripts .claude docs
rg -n 'tools/entry|compy-entry|preflight|repairHooksIfSafe|session-root-assert|context-policy' tools/console tools/entry .claude
```

Record every non-archive hit in the issue. A deletion candidate with any non-legacy consumer is preserved and removed from the deletion list. The second search must prove canonical entry tooling is still referenced and must not be edited by this task.

- [ ] **Step 2: Write the failing retirement guard**

Create `tools/console/doctor-retirement.test.mjs`:

```js
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = readFileSync(join(here, "server.mjs"), "utf8");
const PAGE = readFileSync(join(here, "index.html"), "utf8");

describe("the retired Console leaves one Doctor and preserves the workflow engine", () => {
  it("removes duplicate chat, history, notes, launcher, and legacy routes", () => {
    expect(SERVER).not.toMatch(/\/api\/(chat|chats|launcher|notes)|\/journey\.mjs|\/legacy/);
    expect(SERVER).not.toMatch(/createNativeChatStore|planAgentSpawn|readNotes|streamTurn/);
    expect(PAGE).not.toMatch(/Continue|Start|History|chatBox|chatList|startBox/);
  });

  it("removes only dead Console modules", () => {
    for (const file of ["agents.mjs", "chats.mjs", "journey.mjs", "notes.mjs"]) expect(existsSync(join(here, file))).toBe(false);
  });

  it("preserves canonical entry, repair, and session-root machinery", () => {
    for (const file of ["../entry/cli.mjs", "../entry/launch.mjs", "../entry/preflight.mjs", "../entry/repair.mjs", "../../.claude/hooks/session-root-assert.mjs"]) {
      expect(existsSync(join(here, file))).toBe(true);
    }
  });

  it("keeps explicit heavy verification and bounded Doctor actions", () => {
    for (const route of ["/api/audit", "/api/doctor/scan", "/api/doctor/repair", "/api/doctor/handoff"]) expect(SERVER).toContain(route);
  });
});
```

- [ ] **Step 3: Run the guard and verify it fails on the still-present legacy shell**

```powershell
npm test -- tools/console/doctor-retirement.test.mjs
```

Expected: FAIL on legacy routes/imports/files.

- [ ] **Step 4: Rename the accepted Doctor page and update revision routing**

Use patch-based add/delete edits to move the accepted `doctor.html` content to `index.html`; let Git detect the rename. Update `server.mjs` so `/` and `/index.html` render `index.html`, `/api/meta` hashes `index.html`, and `/legacy` no longer exists. Update tests and the Doctor brand link from `/doctor` to `/`. Keep `/doctor` as a temporary redirect-free alias only if a live bookmark audit proves the owner has it saved; otherwise return 404 and avoid maintaining two entry URLs.

- [ ] **Step 5: Remove legacy endpoint/import blocks and dead modules**

Delete with patch-based file edits, not broad filesystem commands. Remove:

- agent imports, subscription checks, `streamTurn`, and `/api/chat`;
- native chat store injection and `/api/chats`;
- `/journey.mjs`;
- `/api/launcher` and its Console-only `launcherCommand` / detached-launch adapter;
- notes imports and `/api/notes/*`;
- provider browser-window `/api/open` if the call-site audit finds no Doctor consumer;
- `readAgents()` and the old all-in-one `snapshot()` from `sources.mjs` when no remaining caller exists;
- the exact dead modules/tests proven by Step 1.

Do not delete or modify `tools/entry`, `.claude/hooks`, Work Control helpers, Doctor action/handoff modules, `/api/audit`, fonts, start script, or source readers still used by Doctor scans.

- [ ] **Step 6: Tighten server-contract tests around the smaller surface**

Replace old chat/launcher/notes expectations with explicit 404 assertions and injection non-calls. Keep origin tests for every state-changing Doctor route. Keep root/revision/server-identity tests. A test file whose entire subject was deleted is deleted; a mixed file is narrowed.

- [ ] **Step 7: Run retirement, full Console, and canonical entry tests**

```powershell
npm test -- tools/console/doctor-retirement.test.mjs tools/console/server-contract.test.mjs tools/console/doctor-ui.test.mjs tools/console/doctor-actions.test.mjs tools/console/doctor-handoffs.test.mjs
npm test -- tools/console tools/entry
```

Expected: all selected files pass. The second command proves removing the Console launcher surface did not remove the canonical workflow engine.

- [ ] **Step 8: Re-run call-site audit and commit the retirement**

Re-run Step 1. Expected non-archive legacy hits: none. Expected canonical engine hits: present in `tools/entry` and `.claude/hooks`. Then commit only audited deletions and replacements:

```powershell
git add -A tools/console
git commit -m "refactor(console): retire duplicate work and chat shell"
```

### Task 4: Current documentation, full verification, PR, and live activation

**Files:**

- Create: `tools/console/README.md`
- Modify only if current-state cutline requires it: `docs/BACKLOG.md`
- Modify: implementation issue/Work Control fields and handoff through GitHub, not a duplicate Markdown status board.

**Interfaces:**

- Consumes: the complete branch after Tasks 1–3.
- Produces: current operational documentation, full verification evidence, owner-review PR, and—only after merge authorization—an identity-proven live restart.

- [ ] **Step 1: Write the current operational README**

Create `tools/console/README.md` with exactly these sections:

1. **What it is** — Project Doctor, not a chat/work launcher.
2. **How Kuya opens it** — the existing one-click Compy Console shortcut.
3. **Automatic checks** — one-minute light scan, slower PR/CI scan, zero Claude/Codex/model calls.
4. **Explicit actions** — canonical hook repair, local audit, Claude prefilled handoff with folder confirmation, Codex open-and-copy fallback.
5. **Truth and history** — Git/Work Control/issues/tests are canonical; receipts are current-page only.
6. **Safety boundaries** — the never-automatic list from the approved spec.
7. **Recovery** — `start.ps1 -Restart` stops only the identity-proven server; foreign port listeners are left alone; entry tooling remains in `tools/entry`.
8. **Verification** — focused commands and the live owner walkthrough.

Do not copy live issue numbers, current claims, current branches, or a dated status log into this README.

- [ ] **Step 2: Run the complete verification train fresh**

From the claimed implementation worktree:

```powershell
node --check tools/console/server.mjs
node --check tools/console/doctor-findings.mjs
node --check tools/console/doctor-scan.mjs
node --check tools/console/doctor-actions.mjs
node --check tools/console/doctor-handoffs.mjs
node --check tools/console/doctor-view.mjs
node --check tools/console/doctor-ui.mjs
npm test -- tools/console tools/entry
npm test
& .\node_modules\.bin\tsc.cmd --noEmit
pwsh -NoProfile -File scripts/doc-budget.ps1
git diff origin/main...HEAD -- src-tauri src
git diff --check origin/main...HEAD
```

Expected: syntax exits 0; focused and full test counts report zero failures except pre-existing skips; TypeScript exits 0; doc budget says ALL PASS; both source/mutation diff and whitespace diff are empty/clean as appropriate. If a full-suite flake appears, rerun it alone and report both outcomes; do not call the full suite green unless the fresh full command exits 0.

- [ ] **Step 3: Perform the final native live review on isolated port 4527**

Use the exact branch HEAD and server identity in the evidence. Review at 1440×900, 1024×768, 760×900, 200% zoom, keyboard-only, reduced motion, GitHub unreachable, Work Control unreachable, healthy, every priority, repair running/pass/refuse, heavy audit running/stop, Claude handoff, Codex handoff, stale page revision, and foreign-listener refusal. Quote the independent visual self-review PASS; green tests are not visual proof.

- [ ] **Step 4: Commit documentation and push the complete branch**

```powershell
git add tools/console/README.md docs/BACKLOG.md
git commit -m "docs(console): document project doctor operation"
git push -u origin HEAD
git status --short --branch
```

If `docs/BACKLOG.md` did not require a current-state change, do not stage it and record that no canonical product cutline moved.

- [ ] **Step 5: Open one owner-review PR and stop at the merge/default gate**

The PR body names:

- the approved design spec and all three plans;
- exact commit range;
- focused/full test counts, TypeScript, doc budget, diff proof, and capture review;
- the one safe repair and every forbidden automatic class;
- zero-token five-cycle evidence;
- Claude/Codex handoff behavior;
- deletions and proof that `tools/entry` remains intact;
- honest hosted-CI status, including whether jobs executed;
- exact live activation steps after merge.

Do not merge until Kuya authorizes this PR/default switch.

- [ ] **Step 6: After owner merge authorization, activate the merged code without making Kuya the operator**

After merge:

1. Verify `main` contains the exact reviewed head or merge commit.
2. Fast-forward the folder used by the stable shortcut; refuse dirty/diverged state.
3. Query the current 4517 `/api/meta` and verify product, PID, and repository identity.
4. Run `tools/console/start.ps1 -Restart`; it stops only that proven server.
5. Open the existing shortcut and verify root Checkup revision matches merged source.
6. Perform one light scan and prove no agent/model process starts.
7. Leave the Doctor running and report that no terminal or VS Code window is required.

No Tauri build, installer, Desktop installer cleanup, or product release occurs; Project Doctor is a local workflow tool.

- [ ] **Step 7: Close the implementation issue only after the owner walkthrough passes**

Post the Work Control handoff with commits/PR, exact verification counts, live revision, remaining deferrals, active processes, and claim release. Mark Done only when Kuya completes healthy, problem, repair, and handoff walkthroughs and no required work remains.

## Cross-plan specification coverage

| Approved spec requirement | Owning task |
|---|---|
| Checkup / Problems / Repairs only | Foundation Task 4; Migration Task 2 |
| Confirmed facts separated from proposals | Approved design spec; plan entry preconditions |
| Stable codes, identity, ranking, deterministic playbook | Foundation Task 1 |
| Local/board/slow scan split and no overlap | Foundation Task 2 |
| 60-second light scan and slower PR/CI | Foundation Task 4 |
| Zero agent/model calls from automatic monitoring | Foundation Tasks 2 and 4; Migration Task 4 proof |
| New/worsened or newly owner-gated announcements; never initial/unchanged nagging | Foundation Task 4 |
| No duplicate truth or durable Doctor ledger | Foundation global constraints; Repairs Task 4 |
| One proven hook repair with plan/write/recheck | Repairs Tasks 1 and 2 |
| Never-auto authority boundaries | Repairs Task 1 playbook guards |
| Explicit local heavy audit | Repairs Task 4 |
| Claude official deep link and folder confirmation | Repairs Task 3 |
| Honest Codex open-and-copy fallback | Repairs Task 3 |
| VS Code optional, not normal path | Repairs Tasks 3–4 Details fallback; README; canonical entry engine preserved |
| Offline, delayed, stale, and changed-precondition behavior | Foundation Tasks 2–4; Repairs Tasks 1–2 |
| Keyboard, focus, live regions, zoom, reduced motion | Foundation Task 4; Repairs Task 4; Migration Task 4 review |
| Preview before default and subtractive cleanup last | Migration Tasks 2 and 3 |
| No process killing except exact owned server restart | Migration Task 1 |
| Remove duplicate Console chat/history/launcher only after audit | Migration Task 3 |
| Preserve Work Control/entry/context/hook engine | Migration Task 3 guards |
| Full tests, TypeScript, doc budget, source diff, live proof | Migration Task 4 |
| Owner acceptance before default/merge | Migration Task 2 and Task 4 |

## Explicitly deferred after activation

- Operating-system notifications.
- Durable Doctor repair/alert history.
- Automatic repairs beyond missing canonical hooks.
- Cleanup of proven-dead Compy-owned locks or overlays; the first release reports them but does not remove them.
- Codex folder/prompt routing without an official or live-proven contract.
- New repositories outside the current Compy/Sentinel checkout family.
- Any system setting, installation, security, merge, publication, or release action from Project Doctor.

## Remain rejected

- Automatic Claude/Codex diagnosis, prompt submission, or token-consuming monitoring.
- Automatic dirty-work cleanup, stash/reset/rebase/merge, claim takeover, process termination, security changes, publication, or release.
- A Doctor-owned project database, duplicate task board, durable alert ledger, or conversation archive.
- Returning VS Code to the primary owner journey.
- Rebuilding this local workflow tool as a Tauri/Electron product or adding a package dependency for visual decoration.
- Shipping a second repair because it looks similar; every later mutation needs its own identity, authority, recheck, and bug-to-guard evidence.
