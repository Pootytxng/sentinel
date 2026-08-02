import {
  CODE_ROOT, readCheckoutHealth, readProcessSnapshot, readWork, readPulls, readCi, readLostAndFound,
} from "./sources.mjs";
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
  } catch (error) {
    return { ok: false, value: fallback, error: String(error?.message ?? error).split("\n")[0] };
  }
};

export function scanDoctor({ includeSlow = false, now = new Date(), readers = DEFAULT_READERS, previous = [] } = {}) {
  const processes = reached(() => readers.processes(), []);
  const local = reached(() => readers.checkouts({ processRows: processes.value }), []);
  const board = reached(() => readers.work({ now }), { ok: false, items: [] });
  const pulls = includeSlow ? reached(() => readers.pulls(), []) : null;
  const ci = includeSlow ? reached(() => readers.ci(), { meaningful: false, runs: [] }) : null;
  const lost = includeSlow ? reached(() => readers.lostAndFound({ work: board, pulls }), []) : { ok: true, value: [] };
  const snapshot = {
    generatedAt: now.toISOString(),
    sources: {
      processes: { ok: processes.ok, error: processes.error },
      local: { ok: local.ok, error: local.error },
      board: { ok: board.ok, error: board.error },
      ...(includeSlow ? { slow: { ok: pulls.ok && ci.ok && lost.ok, error: pulls.error ?? ci.error ?? lost.error } } : {}),
    },
    checkouts: local.value,
    work: board,
    ci,
    lostAndFound: lost.value,
  };
  return { ...snapshot, findings: normalizeDoctorFindings(snapshot, { previous, codeRoot: CODE_ROOT }) };
}

export function createDoctorScanner({ scan = scanDoctor } = {}) {
  let inFlight = null;
  let previous = [];
  const slowCode = new Set(["CI_NO_EXECUTION", "CI_FAILED", "UNPUBLISHED_WORK", "ORPHAN_FOLDER", "STALE_IDE_LOCK"]);
  const cameFromSlowScan = (finding) => slowCode.has(finding.code) || finding.subject?.source === "slow" || finding.subject?.source === "ci";
  return {
    run(options = {}) {
      if (inFlight) return Promise.resolve({ busy: true });
      inFlight = Promise.resolve()
        .then(() => scan({ ...options, previous }))
        .then((result) => {
          if (Array.isArray(result.findings)) {
            previous = options.includeSlow
              ? result.findings
              : [...result.findings, ...previous.filter(cameFromSlowScan)];
          }
          return result;
        })
        .finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}
