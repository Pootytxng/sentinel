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
    code, subject: { repairEligible: false, ...subject }, evidence, observedAt,
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
