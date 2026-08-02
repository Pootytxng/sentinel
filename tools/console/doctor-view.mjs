import { resolveDoctorFinding } from "./doctor-playbook.mjs";

export const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const plural = (count, singular, pluralWord = `${singular}s`) => `${count} ${count === 1 ? singular : pluralWord}`;
const priorityLabel = (priority) => ({ collision: "Collision", broken: "Problem", owner: "Owner decision", advisory: "Advisory" }[priority] ?? "Attention");
const stateLabel = (state) => ({ new: "New", worsened: "Worsened", improved: "Improved", unchanged: "Unchanged" }[state] ?? "Current");
const actionButton = (finding) => `<button type="button" class="primary-action"
  data-primary-action="${escapeHtml(finding.action.kind)}"
  data-fingerprint="${escapeHtml(finding.fingerprint)}">${escapeHtml(finding.action.label)}</button>`;

const evidenceDetails = (evidence = []) => evidence.length ? `<details class="finding-evidence"><summary>Evidence</summary><ul>${evidence
  .map((item) => `<li><strong>${escapeHtml(item.kind ?? "source")}</strong>: ${escapeHtml(item.detail ?? "")}</li>`)
  .join("")}</ul></details>` : "";

export function renderCheckup(model = {}) {
  if (model.error) return `<header class="pane-heading"><p class="eyebrow">Project Doctor</p><h1>Checkup</h1></header><p class="empty-state">Project Doctor could not complete this scan.</p>`;
  const findings = model.snapshot?.findings ?? model.findings ?? [];
  const attention = findings.length;
  const message = attention ? `${plural(attention, "thing")} need${attention === 1 ? "s" : ""} attention.` : "Everything looks healthy.";
  return `<header class="pane-heading"><p class="eyebrow">Project Doctor</p><h1>Checkup</h1></header>
    <p class="checkup-state" data-state="${attention ? "attention" : "healthy"}">${message}</p>
    ${attention ? `<p class="checkup-guidance">Review the problems in priority order. Nothing changes from this screen.</p>` : ""}`;
}

export function renderProblems(findings = []) {
  if (!findings.length) return `<header class="pane-heading"><p class="eyebrow">Project Doctor</p><h1>Problems</h1></header><p class="empty-state">No problems need attention.</p>`;
  return `<header class="pane-heading"><p class="eyebrow">Project Doctor</p><h1>Problems</h1></header><div class="finding-list">${findings.map((item) => {
    const finding = resolveDoctorFinding(item);
    return `<article class="finding" data-priority="${escapeHtml(finding.priority)}">
      <header><p class="finding-label">${escapeHtml(priorityLabel(finding.priority))} · ${escapeHtml(stateLabel(finding.state))}</p><h2>${escapeHtml(finding.project)}</h2><p class="finding-scope">${escapeHtml(finding.scope)}</p></header>
      <section><h3>What happened</h3><p>${escapeHtml(finding.summary)}</p></section>
      <section><h3>Why it matters</h3><p>${escapeHtml(finding.impact)}</p></section>
      <section><h3>Compy recommends</h3><p>${escapeHtml(finding.recommendation)}</p></section>
      ${actionButton(finding)}
      ${evidenceDetails(finding.evidence)}
    </article>`;
  }).join("")}</div>`;
}

export function renderRepairs(findings = [], receipts = []) {
  void findings; void receipts;
  return `<header class="pane-heading"><p class="eyebrow">Project Doctor</p><h1>Repairs</h1></header><p class="empty-state">No safe repairs are ready.</p>`;
}
