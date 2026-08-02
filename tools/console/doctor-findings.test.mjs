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

  it("explicitly denies repair eligibility on every source and work finding", () => {
    const findings = normalizeDoctorFindings(snapshot({
      sources: { local: { ok: false, error: "offline" } },
      work: { ok: true, items: [{ number: 21, title: "owner review", status: "Needs Kuya", worktreeBranch: "none" }] },
    }));
    expect(findings.find((finding) => finding.code === "SOURCE_UNREACHABLE")?.subject.repairEligible).toBe(false);
    expect(findings.find((finding) => finding.code === "OWNER_DECISION")?.subject.repairEligible).toBe(false);
    expect(findings.every((finding) => typeof finding.subject.repairEligible === "boolean")).toBe(true);
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
