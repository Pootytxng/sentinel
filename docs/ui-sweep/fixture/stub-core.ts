// ══════════════════════════════════════════════════════════════════════════════════════════════
//  FIXTURE PREVIEW — EVERY NUMBER IN THIS FILE IS INVENTED. IT IS NOT A MEASUREMENT.
//  Nothing here may ever be quoted as a result, a benchmark, or evidence of a gain. The preview
//  paints a loud banner over itself for exactly that reason: a screenshot taken from it must be
//  unmistakable as a fixture at a glance, including months later out of context.
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// WHAT THIS IS. The stand-in for `@tauri-apps/api/core` inside the fixture preview server ONLY —
// `docs/ui-sweep/fixture/vite.config.mts` aliases that one specifier here. The product build never
// sees this file (the alias lives in a second, separate Vite config), and nothing in `src/` imports
// it.
//
// WHY IT EXISTS. The Lab's experiment bench has two states the owner's machine cannot show:
//   • the START CTA armed — needs an eligible unapplied rec AND a monitored session with real fps
//     to serve as a baseline (`canStart` in ExperimentBench.tsx);
//   • an experiment RUNNING — needs `status === "running"`.
// Reaching either for real means invoking `start_experiment`, which applies a real (if reversible)
// Windows change. Review may not do that. So the self-review law's evidence requirement had no
// route to these two states at all, and they shipped in the bento conversion reviewed by code
// reading alone. The preview mounts the REAL component against this stub instead — real CSS, real
// tokens, real layout, real pixels.
//
// WHY NOT A RUNTIME SHIM. The first attempt reassigned `window.__TAURI_INTERNALS__.invoke` in the
// live app. That is impossible in Tauri v2 and always will be: both the internals object and its
// `invoke` property are {writable:false, configurable:false} — a deliberate anti-IPC-hijacking
// protection. Non-strict assignment fails SILENTLY, so the preview mounted and quietly showed live
// data under a fixture banner. Interception moved to build time, where it is honest: nothing about
// Tauri's protection is touched, and the transport underneath it must never be patched either.
//
// MUTATION SAFETY. There is no backend behind this module at all, and the three mutating commands
// reject by name with an explicit message, so even a stray click during a review cannot reach the
// mutation boundary. Any command with no case here also rejects loudly rather than resolving
// undefined — a silently-empty answer would read as a real "nothing to show" state.

type ExperimentStatus = "running" | "kept" | "restored" | "aborted";
type Confidence = "unknown" | "low" | "medium" | "high";

const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60000).toISOString();

// Shape matches `SessionSummary` in src/types.ts. `low1_fps_est` is what the bench reads for the
// 1% low; the null sensor fields are the honest "no external monitor running" case.
const session = (over: Record<string, unknown> = {}) => ({
  started_at: iso(95),
  duration_secs: 2820,
  process_name: "fixture-game.exe",
  samples: 2780,
  avg_fps: 141.4,
  avg_frametime_ms: 7.07,
  low1_fps_est: 96.2,
  peak_gpu_temp_c: null,
  peak_gpu_usage_pct: 97,
  peak_ram_used_bytes: null,
  ram_total_bytes: null,
  compy_changes_active: 3,
  ...over,
});

// "worth-testing" is the one verdict that ARMS the Start CTA (the other three —
// already-configured / not-applicable / risk-exceeds-value — are blocked in simVerdictCopy).
// `is_promise: false` keeps the copy inside the honest-measurement law: this simulates whether a
// change is worth TESTING, it never predicts a gain.
const SIM = {
  rec_id: "fixture-rec-1",
  rec_title: "Turn off Xbox Game Bar background capture",
  verdict: "worth-testing",
  confidence: "medium" as Confidence,
  why: "Background capture keeps an encoder awake during play. On rigs like yours it usually costs a little, and it is one of the few changes whose effect shows up in the 1% low rather than the average.",
  hardware_factor: "16 logical cores and a discrete GPU — the average will barely move; watch the low.",
  metric_to_watch: "1% low fps",
  disproof: "If the 1% low does not clear the noise floor over a full session, this did nothing.",
  is_promise: false,
};

const RECS = [
  { id: "fixture-rec-1", title: "Turn off Xbox Game Bar background capture", eligible: true, currently_applied: false },
  { id: "fixture-rec-2", title: "Stop the printer spooler from starting with Windows", eligible: true, currently_applied: false },
];

const HISTORY = [
  {
    id: "fx-h1", rec_id: "fixture-rec-9", rec_title: "Disable transparency effects",
    game: "fixture-game.exe", hypothesis: "", created_at: iso(4300),
    status: "restored" as ExperimentStatus,
    baseline_avg_fps: 138.0, baseline_low1_fps: 94.0, active_changes_at_start: 2,
    attribution_warning: null, noise_floor_pct: 3,
    treatment: { avg_fps: 137.2, low1_fps: 93.1, samples: 2400, crashed: false, delta_low1_pct: -1.0, recorded_at: iso(4100) },
    verdict: "no-change", kept: false, stop_reason: null, concluded_at: iso(4090),
    verdict_confidence: "medium" as Confidence, verdict_note: "One full session either side, same game, same rig.",
  },
  {
    id: "fx-h2", rec_id: "fixture-rec-8", rec_title: "Turn off startup delay for background apps",
    game: "fixture-game.exe", hypothesis: "", created_at: iso(9800),
    status: "kept" as ExperimentStatus,
    baseline_avg_fps: 133.5, baseline_low1_fps: 88.4, active_changes_at_start: 1,
    attribution_warning: null, noise_floor_pct: 3,
    treatment: { avg_fps: 139.9, low1_fps: 95.7, samples: 3100, crashed: false, delta_low1_pct: 8.3, recorded_at: iso(9500) },
    verdict: "improved", kept: true, stop_reason: null, concluded_at: iso(9490),
    verdict_confidence: "high" as Confidence, verdict_note: "Clear of the 3% noise floor across a full session.",
  },
];

const RUNNING = {
  id: "fx-run", rec_id: "fixture-rec-1", rec_title: "Turn off Xbox Game Bar background capture",
  game: "fixture-game.exe", hypothesis: "The 1% low should clear the noise floor.",
  created_at: iso(40), status: "running" as ExperimentStatus,
  baseline_avg_fps: 141.4, baseline_low1_fps: 96.2, active_changes_at_start: 3,
  attribution_warning: "3 other changes are already applied — a win here is the stack's, not this change's alone.",
  noise_floor_pct: 3, treatment: null, verdict: null, kept: false, stop_reason: null,
  concluded_at: null, verdict_confidence: null, verdict_note: null,
};

// Per-state answers. The bench matches a treatment session by game name AND a start time strictly
// LATER than the experiment's `created_at` (treatmentFor in ExperimentBench.tsx), so 'running'
// carries a second session at 12 minutes ago against the experiment's 40 — that arms the conclude
// CTA. 'running-no-session' omits it, which is the state the owner actually lands in the moment
// after starting: the CTA reads "no new session yet" and stays disabled.
const STATES: Record<string, { experiments: unknown[]; sessions: unknown[] }> = {
  start: { experiments: HISTORY, sessions: [session()] },
  running: {
    experiments: [RUNNING, ...HISTORY],
    sessions: [
      session(),
      session({ started_at: iso(12), duration_secs: 700, samples: 690, avg_fps: 148.9, low1_fps_est: 104.8 }),
    ],
  },
  "running-no-session": { experiments: [RUNNING, ...HISTORY], sessions: [session()] },
};

// CPU-TEMP OFFER STATES (Q9c).
// Same reason as the bench above, different wall. The offer's branches are decided by what sensor
// apps this machine has — and the owner's machine has NONE installed, so live it can only ever
// render the "install" branch. The others (already running with Shared Memory off, an
// installed-and-closed app, a monitor publishing sensors but no CPU temperature, a failed start)
// are unreachable here without installing third-party software on his PC to take a screenshot.
//
// These are OBSERVATIONS, not measurements — booleans about which processes exist. Nothing here is
// a temperature and nothing here may be quoted as one.
type SensorAppId = "hwinfo" | "lhm";
const sensorApp = (
  id: SensorAppId,
  over: Partial<{ running: boolean; publishing: boolean; launchable: boolean }> = {},
) => {
  const running = over.running ?? false;
  const publishing = over.publishing ?? false;
  const launchable = over.launchable ?? false;
  return { id, running, publishing, launchable, installed: running || publishing || launchable };
};

// `launchFails` is the branch where the shell refuses the start — the offer must then say what to
// do (open it from the Start menu) rather than going quiet, which is the dead end this whole
// component replaced.
const CPU_TEMP_STATES: Record<
  string,
  { apps: ReturnType<typeof sensorApp>[]; scanned: number; launchFails?: boolean }
> = {
  "cputemp-install": { apps: [sensorApp("hwinfo"), sensorApp("lhm")], scanned: 214 },
  "cputemp-start": {
    apps: [sensorApp("hwinfo", { launchable: true }), sensorApp("lhm")],
    scanned: 214,
  },
  "cputemp-start-failed": {
    apps: [sensorApp("hwinfo", { launchable: true }), sensorApp("lhm")],
    scanned: 214,
    launchFails: true,
  },
  "cputemp-shared-memory": {
    apps: [sensorApp("hwinfo", { running: true, launchable: true }), sensorApp("lhm")],
    scanned: 217,
  },
  "cputemp-not-publishing": {
    apps: [sensorApp("hwinfo"), sensorApp("lhm", { running: true, launchable: true })],
    scanned: 216,
  },
  "cputemp-publishing": {
    apps: [
      sensorApp("hwinfo", { running: true, publishing: true, launchable: true }),
      sensorApp("lhm"),
    ],
    scanned: 217,
  },
};

// ── Q9a receipts consent (2026-08-25) ─────────────────────────────────────────────────────────
// `ReceiptsConsent` renders NOTHING in every shipped build: `receipts_gate()` is hard-false
// (src-tauri/src/receipts.rs:28), so the component's own probe returns false and it bails at
// `if (!gate || !consent) return null`. There is no build, flag, or localStorage key on the
// owner's machine that reaches these pixels — which is exactly the gap the fixture exists for,
// and why the merged Q9a lane shipped with its visual self-review still owed.
//
// The stub answers `get_receipts_gate` with TRUE. That is a preview of a state the product does
// not have, and the banner says so on every shot. Nothing here arms anything: the gate the app
// reads is a Rust function, not this file.
type ConsentState = { disclosed_at: string | null; enabled: boolean | null };

// The real endpoint constant, not an invented one — `RECEIPTS_ENDPOINT`
// (src-tauri/src/receipts.rs:202), which `get_receipts_endpoint` returns verbatim. The destination
// line and the switch-on line both interpolate it, and a made-up address in a screenshot of a
// privacy disclosure would be the one invented value on this page that actually misleads.
const RECEIPTS_ENDPOINT = "https://compy-bd6.pages.dev/api/usage";

// INVENTED, like everything else here — but shape-true to `ReceiptPayload` (receipts.rs:47) and
// every bucket string is one of the fixed labels the Rust builder can emit (`ram_gb_bucket`
// receipts.rs:63, `duration_bucket` receipts.rs:77). A preview whose buckets looked like raw
// numbers would misrepresent the very privacy property the disclosure is claiming.
const RECEIPT_PREVIEW = {
  schema_version: 1,
  hw_class: {
    gpu_vendor: "AMD",
    gpu_model: "Radeon RX 9070 XT",
    cpu_family: "Ryzen 7 X3D",
    ram_gb_bucket: "25-32",
  },
  outcome: {
    kind: "session",
    game: "example-game",
    avg_fps: 164.2,
    low1_fps_est: 118.7,
    duration_bucket: "1-3h",
    active_change_ids: ["gpu_hags", "game_dvr_off", "startup_trim"],
  },
};

const RECEIPTS_STATES: Record<
  string,
  { consent: ConsentState; previewFails?: boolean; consentFails?: boolean }
> = {
  // First run: disclosed_at null is the ONLY thing that renders the disclosure, and it is the one
  // state a user cannot return to once answered.
  "receipts-firstrun": { consent: { disclosed_at: null, enabled: null } },
  // Answered-and-declined. `enabled: false` and `enabled: null` are different facts to the
  // backend and identical to this UI — both paint the switch OFF, which is what makes the
  // "default OFF even after arming" ruling (#207) visible rather than merely asserted.
  "receipts-off": { consent: { disclosed_at: "2026-08-25T09:14:00Z", enabled: false } },
  "receipts-on": { consent: { disclosed_at: "2026-08-25T09:14:00Z", enabled: true } },
  // Both error paragraphs at once. They render as bare `receipts-hint` text with no icon, no
  // colour and no retry — the reviewer's job is to say whether that reads as an error at all.
  "receipts-errors": {
    consent: { disclosed_at: "2026-08-25T09:14:00Z", enabled: false },
    previewFails: true,
    consentFails: true,
  },
};

// ── Compy Care Tier 1 — the signed known-issue block (#220, 2026-08-25) ────────────────
// The Black Box's Tier 1 section is unreachable on the owner's machine and will stay that way for
// as long as Tier 1 is dark. Three independent locks have to fall for a match to exist:
// `case_intelligence_gate()` is hard-false, `CASE_SIGNING_PUBKEY` is all zeros, and both catalog
// allowlists are empty — so even a build with the gate forced on would verify nothing and render
// nothing. Forcing any of them for a screenshot is exactly what the plan's boundaries forbid.
//
// So the fixture answers `get_crash_blackbox` with a report that already carries the field. The
// shape is `CrashIncident.case_intelligence` (src/types.ts), which mirrors `CaseIntelligenceMatch`
// (src-tauri/src/case_intelligence.rs) — nothing here fakes a signature, a catalog or a fetch,
// because none of that reaches the UI: by the time an incident has this field, verification has
// already happened or the field is absent.
//
// The three states are the three the review actually needs: a FULL match, a PARTIAL one (which is
// the level that withholds `research_only` steps), and an incident with the field absent — the
// control that proves a dark build paints no Tier 1 chrome at all.
const CASE_MATCHED = {
  case_id: "amd-rdna4-display-timeout-2026-02",
  catalog_version: 7,
  level: "matched_known_issue",
  title: "Display timeouts on RDNA4 cards running Adrenalin 26.1.1",
  summary:
    "The publisher records the display driver timing out on RDNA4 cards on this driver line when a second monitor runs at a different refresh rate. The write-up names the affected driver range and the release that addresses it.",
  // KEYS, never this machine's values — the component looks each one up in
  // `gaming.blackBox.knownIssue.evidenceKey.*` and drops any key it has no label for.
  evidence_refs: ["faulting_module", "gpu_driver_version", "gpu_vendor"],
  next_steps: [
    {
      headline: "Update to Adrenalin 26.2.1 or later",
      detail: "The release notes list a change for this timeout on RDNA4 cards.",
      research_only: false,
    },
    {
      // Kept at this level and flagged; the partial state below drops it entirely.
      headline: "Look into whether your two monitors run at different refresh rates",
      detail: "The write-up narrows the reports to mixed-refresh multi-monitor setups.",
      research_only: true,
    },
  ],
  contraindications: [
    "Do not start a driver update mid-download or mid-game — the display blanks for a few seconds while the driver swaps.",
  ],
  // A real, publicly reachable page on the publisher's own domain. An invented URL in a screenshot
  // of a provenance line would be the one fake value here that actually misleads — the whole point
  // of the line is that the user can go and read the source.
  source_url: "https://www.amd.com/en/resources/support-articles/release-notes.html",
  source_updated_at: "2026-02-04",
};

const CASE_POSSIBLE = {
  case_id: "publisher-anticheat-launch-close-2026-06",
  catalog_version: 7,
  level: "possible_known_issue",
  title: "The game closes at launch after an anti-cheat service update",
  summary:
    "The publisher records the game closing immediately at launch when its anti-cheat service is left stopped after an update.",
  evidence_refs: ["error_code", "faulting_app"],
  next_steps: [
    {
      headline: "Run the launcher's repair on this game",
      detail: "The publisher's repair option reinstalls the anti-cheat service.",
      research_only: false,
    },
  ],
  contraindications: [],
  source_url: "https://help.example-publisher.com/known-issues/anticheat-launch",
  source_updated_at: "2026-06-14",
};

const bbIncident = (over: Record<string, unknown>) => ({
  headline: "Your graphics driver stopped responding and recovered",
  tag: "GPU timeout",
  when: "2026-08-20T21:42:00-05:00",
  when_display: "Aug 20, 9:42 PM",
  vitals: {
    session_started_at: "2026-08-20T20:10:00-05:00",
    game: "Example Game",
    peak_gpu_temp_c: 71,
    peak_gpu_usage_pct: 98,
    avg_frametime_ms: 8.4,
    low1_fps_est: 96,
    summary: "Example Game · 1h 32m · peak GPU 71°C · 1% low ~96 fps",
  },
  receipt: {
    source: "System log · Display 4101",
    event_ids: [4101],
    faulting_app: null,
    faulting_module: "amdkmdag",
    code: null,
    detail: "Display driver amdkmdag stopped responding and has recovered.",
  },
  // Compy's OWN reading. Present on purpose in every state: the review has to judge whether a user
  // can tell this block apart from the quoted one below it, and that is only answerable side by side.
  assessment: {
    consistent_with: "your graphics driver (amdkmdag) repeatedly timing out",
    strength: "strong",
    evidence: [
      "the same driver module (amdkmdag) stopped responding across 2 separate crashes",
      "the GPU temperature was not in the overheating range in those sessions",
    ],
    next_step: {
      headline: "Do a clean reinstall of your graphics driver",
      detail: "Download the current driver and install it with the clean-install option.",
      reversible: true,
      research_only: false,
    },
    beyond_us: false,
  },
  ...over,
});

const APP_CRASH = {
  headline: "A game closed unexpectedly",
  tag: "App crash",
  when: "2026-08-19T18:02:00-05:00",
  when_display: "Aug 19, 6:02 PM",
  vitals: null,
  receipt: {
    source: "Application log · 1000",
    event_ids: [1000],
    faulting_app: "example-game.exe",
    faulting_module: "ntdll.dll",
    code: "0xc0000005",
    detail: "Faulting application example-game.exe, faulting module ntdll.dll.",
  },
  assessment: null,
};

const BLACKBOX_STATES: Record<string, { report: unknown }> = {
  // The full match, alongside a partial one on a second incident — the two levels have to be
  // legible as different at a glance, and one shot per level cannot answer that.
  "tier1-matched": {
    report: {
      incidents: [
        bbIncident({ case_intelligence: CASE_MATCHED }),
        { ...APP_CRASH, case_intelligence: CASE_POSSIBLE },
      ],
      skipped_sources: [],
    },
  },
  // The click that cannot reach a browser. Unreachable in a shipped build without a machine that
  // has no registered https handler at all, which is why it needs a state rather than a reviewer's
  // imagination: the failure is a SECOND paint (the button is replaced by the URL), and the thing
  // review has to judge is whether that swap reads as an explanation or as something going wrong.
  "tier1-source-unopenable": {
    report: {
      incidents: [bbIncident({ case_intelligence: CASE_MATCHED })],
      skipped_sources: [],
    },
  },
  // The partial alone, on the incident that also carries Compy's own assessment: this is where a
  // user is most at risk of reading the quoted write-up as Compy's own verdict.
  "tier1-possible": {
    report: {
      incidents: [bbIncident({ case_intelligence: CASE_POSSIBLE })],
      skipped_sources: [],
    },
  },
  // THE CONTROL, and the state that matters most. This is every shipped build: the backend omits
  // the field entirely rather than sending a null, so nothing Tier 1 draws may appear here — no
  // heading, no rule, no reserved gap under the assessment block.
  "tier1-none": {
    report: {
      incidents: [bbIncident({}), APP_CRASH],
      skipped_sources: ["Application log (needs administrator)"],
    },
  },
};

// ── FirstWin: the follow-through after a user's OWN first live change (P2 / issue #49) ──────────
// Unreachable in a shipped build without actually applying a Windows change and then pressing the
// card's own buttons — which review may not do. Every state below is a different answer from the
// MACHINE at check time, because that answer IS the subject: the card's whole job is to compare
// what Compy remembers against what it just saw, and the three verdicts must be legible as three
// different things at a glance rather than three shades of the same sentence.
//
// INVENTED, like everything else in this file. `applied_at` is fixed rather than relative so two
// captures of the same state are byte-comparable.
const fwChange = (over: Record<string, unknown> = {}) => ({
  id: "fw-1",
  rec_id: "game-mode",
  rec_title: "Game Mode",
  applied_at: "2026-08-26T01:12:00Z",
  snapshot: null,
  status: "applied",
  is_still_active: true,
  ...over,
});

// Shape matches `Recommendation` in src/types.ts. Only `id` and `currently_applied` are read by the
// verification, but the rest is filled in honestly: a half-built rec would render differently if
// this component ever grew a second reader.
const fwRec = (currently_applied: boolean, id = "game-mode") => ({
  id,
  title: "Game Mode",
  category: "system",
  severity: "safe",
  description: "Lets Windows prioritise the game you are playing.",
  impact: "Fewer background interruptions while a game is in focus.",
  downside: null,
  applies_to: "Windows 10/11",
  currently_applied,
  provenance: "verified",
});

const FIRSTWIN_STATES: Record<
  string,
  {
    changes: unknown[];
    /** What `get_recommendations` answers WHEN THE USER PRESSES CHECK — the state's whole point. */
    machine: unknown[];
    readFails?: boolean;
    undoFails?: boolean;
  }
> = {
  // The happy path, start to finish: intro → held → put it back → undone. This is the one state
  // that walks the entire journey the card exists to teach.
  "firstwin-held": { changes: [fwChange()], machine: [fwRec(true)] },
  // The change did NOT survive. The ledger still believes it is on; the machine disagrees, and the
  // machine wins. Review has to judge whether this reads as a finding or as an accusation — and
  // whether the absence of the undo button here reads as deliberate rather than as a missing button.
  "firstwin-reverted": { changes: [fwChange()], machine: [fwRec(false)] },
  // The setting is not in the read at all. Compy declines to answer either way; the risk being
  // reviewed is that "no answer" gets styled like a verdict.
  "firstwin-unreadable": { changes: [fwChange()], machine: [fwRec(true, "something-else")] },
  // The read itself failed. Distinct from the state above on purpose: a scan that could not run is
  // not evidence a change reverted, and the copy must not let the two blur.
  "firstwin-check-failed": { changes: [fwChange()], machine: [], readFails: true },
  // The undo failed. The card must say plainly that the change is STILL ON and where to undo it —
  // the one error here that leaves the machine in a different state than the sentence implies.
  "firstwin-undo-failed": { changes: [fwChange()], machine: [fwRec(true)], undoFails: true },
  // Several live changes, and an entry that knows what it set the value TO. Heading flips to "Your
  // latest change" and the intro sentence grows its "to X" clause — two copy branches that only
  // appear together on a machine that has been used for a while.
  "firstwin-latest": {
    changes: [
      fwChange({ id: "fw-0", rec_id: "visual-effects", applied_at: "2026-08-24T18:03:00Z" }),
      fwChange({ id: "fw-2", rec_id: "mouse-accel-off", applied_at: "2026-08-25T09:41:00Z" }),
      fwChange({ applied_label: "On" }),
    ],
    machine: [fwRec(true)],
  },
};

/** The ledger rows main.tsx hands the card as props — null when the state is not a FirstWin one. */
export const firstWinChanges = (): unknown[] | null => FIRSTWIN_STATES[current]?.changes ?? null;

// ── SESSION DEBRIEF (Live) — the three branches of DIR-1a earned framing ─────────────────────────
// None of these can be reached on demand in the shipped app. Each needs a REAL recorded gaming
// session whose 1%-low/avg ratio lands in a specific band, AND a readiness limiter that happens to
// link to a recommendation the user has not applied. Waiting for that combination to occur is not
// a review procedure, so the three are built here.
//
// The card decides two things from two different sources, and separating them is this fixture's
// whole job:
//   `problemMeasured` — ratio < 0.75, or a stutter insight — comes from THIS session's frames.
//   `canArm`          — an open limiter linked to an unapplied rec — comes from the MACHINE.
// A rig sits in any combination of the two, and before 2026-08-26 the smooth-session + open-limiter
// corner shipped a card that graded the session "Smooth" and offered "the #1 fix" in one breath.

/** A deterministic ~20-minute trace. Real captures fill `fps_series` with 10 s buckets of ~1 Hz
 *  samples, so an empty one blanks the card's graph and a review would be judging a drawing the
 *  shipped card never makes. No randomness — one URL, one picture, every run. */
const debriefTrace = (base: number, swing: number): [number, number][] =>
  Array.from({ length: 120 }, (_, i): [number, number] => [
    i * 10,
    Math.round((base + Math.sin(i / 3.7) * swing + Math.sin(i / 11) * (swing / 2)) * 10) / 10,
  ]);

const debriefSession = (over: Record<string, unknown> = {}) => ({
  started_at: "2026-08-25T20:14:00Z",
  duration_secs: 1200,
  process_name: "eldenring.exe",
  samples: 1187,
  avg_fps: 162.4,
  avg_frametime_ms: 6.16,
  low1_fps_est: 142.1, // ratio 0.875 — inside the "smooth" band
  peak_gpu_temp_c: 68,
  peak_gpu_usage_pct: 94,
  peak_ram_used_bytes: 12_600_000_000,
  ram_total_bytes: 31_500_000_000,
  compy_changes_active: 0,
  stutter_insight: null,
  fps_series: debriefTrace(162, 9),
  hw_fingerprint: {
    hash: "fixture",
    gpu: "AMD Radeon RX 9070 XT",
    gpu_driver: "25.8.1",
    ram_gb: 29,
    display: "2560x1440 @ 165Hz",
  },
  ...over,
});

// The payload priorities.rs emits for ONE readiness check sitting in `attention` — identical
// whether the session being debriefed ran smooth or rough, which is the entire defect.
const debriefLimiters = {
  limiters: [
    {
      id: "power-plan",
      title: "Power plan",
      reason: "Windows is on Balanced.",
      linked: "power-plan",
      confidence: "medium",
      status: "attention",
    },
  ],
  already_fine: [],
  not_worth_touching: [],
  session_hint: null,
  upgrade_path: null,
};

const debriefRec = {
  id: "power-plan",
  title: "Switch to the Ultimate Performance power plan",
  category: "power",
  severity: "safe",
  description: "Stops Windows dropping the CPU's clocks between frames.",
  impact: "Steadier frame pacing on a CPU that idles down mid-game.",
  downside: null,
  applies_to: "Windows 10/11",
  currently_applied: false,
  provenance: "verified",
};

const DEBRIEF_STATES: Record<string, { session: unknown; priorities: unknown; recs: unknown[] }> = {
  // The corner the fix exists for: smooth session, open limiter. The offer STAYS — "I want more
  // fps" is a legitimate reason to change something on a rig that just ran perfectly — but nothing
  // may call it a fix, and the clean line drops its "Nothing worth changing" half rather than
  // contradicting the button under it.
  "debrief-smooth-offer": {
    session: debriefSession(),
    priorities: debriefLimiters,
    recs: [debriefRec],
  },
  // Same rig, same limiter, worse frames (ratio 0.5). The direct wording is EARNED here. This is
  // the control that proves the fix did not just soften every button in the product.
  "debrief-rough-fix": {
    session: debriefSession({ low1_fps_est: 81.2, fps_series: debriefTrace(158, 46) }),
    priorities: debriefLimiters,
    recs: [debriefRec],
  },
  // Smooth session, nothing open: the full clean sentence and no button at all — the state that
  // shows what the shortened clean line is short OF.
  "debrief-clean-none": { session: debriefSession(), priorities: null, recs: [] },
};

/** The props main.tsx hands the debrief card — null when the state is not a debrief one. */
export const debriefProps = () => DEBRIEF_STATES[current] ?? null;

// ── Q9b Tier 3 case evidence — the preview/consent screen (#258, 2026-08-29) ──────────────────
// `CaseEvidenceConsent` has no route in any shipped build and will not have one before Stage 4:
// nothing in src/ imports it (pinned by src/case-evidence-consent-guard.test.ts), and the gate it
// will eventually sit behind — `case_evidence_gate()` in src-tauri/src/case_evidence_upload.rs —
// is a hard-false constant with no caller anywhere in the crate. So this fixture is not a
// convenience: it is the ONLY surface the screen can be looked at on, which is the same gap Q9a's
// consent tile shipped through and had to come back for.
//
// The screen takes props instead of invoking, so there is no command branch to add below. What
// these states vary is the SHAPE of the case and the failures around it — the six a user can
// actually land in. The bytes themselves are not invented here and could not be: main.tsx looks
// them up in src/case-preview-corpus.json, every entry of which is real output of the Rust
// `case_preview()`. This file's usual "every number is invented" warning does not apply to that
// payload, and it matters that it does not — a fabricated preview is precisely the thing the
// screen exists to make impossible.
type CaseFixtureState = {
  /** Which corpus base to look the bytes up in. `null` renders the "nothing to send" refusal. */
  base: "both" | "comment-only" | null;
  /** Hand the screen text that is not JSON, reaching its refuse-to-send branch. */
  unreadable?: boolean;
  status?: "idle" | "working";
  errorText?: string | null;
};

const CASE_STATES: Record<string, CaseFixtureState> = {
  // Journey B (contract §1): one crash, the full case. All seven §2 removals live, and the comment
  // carries a Windows path and an IP that the Rust redactor masked to `<path>` and `<ip>`. The
  // review question is whether those masks plus the best-effort sentence read as honest to someone
  // deciding whether to send their own words — not whether the sentence is technically true.
  "case-both": { base: "both" },
  // Journey A: the comment IS the case, so it carries no Remove control and the shape line says
  // "comment only". A screen that offered to remove the only thing being sent would be offering to
  // send nothing, which is the confusion §2B exists to prevent.
  "case-comment-only": { base: "comment-only" },
  // Neither a comment nor an incident — `case_payload_json` refuses this payload in Rust, so the
  // screen must refuse it too rather than showing an empty form with a live Send button.
  "case-empty": { base: null },
  // The bytes cannot be parsed back. The screen has one honest move here and it is to refuse:
  // anything it displayed would be a guess about what it was about to send.
  "case-unreadable": { base: "both", unreadable: true },
  // A host failure AFTER the user decided. The payload and the decision both survive it — a state
  // that dumped the user back to an empty screen would cost them the reading they already did.
  "case-error": {
    base: "both",
    errorText: "Compy could not reach the support store. Nothing was sent, and your case is still here.",
  },
  // Mid-send. The only thing the button may do twice is nothing.
  "case-working": { base: "both", status: "working" },
};

/** The case fixture's shape — null when the current state is not a case one. */
export const caseProps = () => CASE_STATES[current] ?? null;

export const STATE_NAMES = [
  ...Object.keys(STATES),
  ...Object.keys(CPU_TEMP_STATES),
  ...Object.keys(RECEIPTS_STATES),
  ...Object.keys(BLACKBOX_STATES),
  ...Object.keys(FIRSTWIN_STATES),
  ...Object.keys(DEBRIEF_STATES),
  ...Object.keys(CASE_STATES),
];

/** Which surface a state name belongs to — main.tsx mounts the bench or the CPU panel on this. */
export const isCpuTempState = (name: string = current) => name in CPU_TEMP_STATES;

/** Same question for the Q9a consent tile, which mounts in the Settings shell, not a room. */
export const isReceiptsState = (name: string = current) => name in RECEIPTS_STATES;

/** And for the Black Box, which mounts in the Lab room like the bench does. */
export const isBlackboxState = (name: string = current) => name in BLACKBOX_STATES;

/** And for FirstWin, which mounts on Home — no room wrapper, same as the Settings tile. */
export const isFirstWinState = (name: string = current) => name in FIRSTWIN_STATES;

/** And for the session debrief, which mounts in the Live room inside `.play-debrief-wrap`. */
export const isDebriefState = (name: string = current) => name in DEBRIEF_STATES;

/** And for the Tier 3 consent screen, which has no shipped host yet — see CASE_STATES above. */
export const isCaseState = (name: string = current) => name in CASE_STATES;

// The state is chosen by `?state=` on the URL so a capture run is a plain navigation — one page
// load per shot, no leftover state from the previous one, and the URL in the address bar names the
// state the screenshot shows.
function initialState(): string {
  try {
    const q = new URLSearchParams(window.location.search).get("state");
    if (
      q &&
      (STATES[q] ||
        CPU_TEMP_STATES[q] ||
        RECEIPTS_STATES[q] ||
        BLACKBOX_STATES[q] ||
        FIRSTWIN_STATES[q] ||
        DEBRIEF_STATES[q] ||
        CASE_STATES[q])
    ) {
      return q;
    }
  } catch {
    /* no URL (never in a browser) — fall through to the default */
  }
  return "start";
}

let current = initialState();

// The consent tile is the one surface here whose own writes must be visible: an off switch that
// cannot be seen moving has not been reviewed. This holds the position across the two setters, so
// a click repaints exactly as it would against a live backend. Nothing persists — reload and the
// URL's state is authoritative again.
let receiptsConsent: ConsentState | null = RECEIPTS_STATES[current]
  ? { ...RECEIPTS_STATES[current].consent }
  : null;

export const getState = () => current;
export function setState(name: string): boolean {
  if (
    !STATES[name] &&
    !CPU_TEMP_STATES[name] &&
    !RECEIPTS_STATES[name] &&
    !BLACKBOX_STATES[name] &&
    !FIRSTWIN_STATES[name] &&
    !DEBRIEF_STATES[name] &&
    !CASE_STATES[name]
  ) {
    return false;
  }
  current = name;
  receiptsConsent = RECEIPTS_STATES[name] ? { ...RECEIPTS_STATES[name].consent } : null;
  return true;
}

// The bench's own mutations. Named individually rather than pattern-matched: a new mutating command
// should FAIL this stub's default branch loudly, not slip through a regex that looked broad enough.
const BLOCKED = ["start_experiment", "conclude_experiment", "restore_experiment"];

export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (BLOCKED.includes(cmd)) {
    return Promise.reject(
      new Error(`FIXTURE PREVIEW — "${cmd}" is blocked. No Windows change was applied, and none can be from here.`),
    );
  }
  // Answered ahead of the bench lookup: the CPU-temp states carry no experiments/sessions at all.
  const sensors = CPU_TEMP_STATES[current];
  if (sensors) {
    if (cmd === "get_sensor_sources") {
      return Promise.resolve({ apps: sensors.apps, scanned: sensors.scanned } as T);
    }
    // There is no backend here, so nothing is ever started — the resolve only lets the offer show
    // its "starting" copy, and the reject lets it show the failure branch.
    if (cmd === "launch_sensor_app") {
      return sensors.launchFails
        ? Promise.reject(
            new Error('FIXTURE PREVIEW — "launch_sensor_app" is refused in this state.'),
          )
        : Promise.resolve(null as T);
    }
  }
  // Answered ahead of the bench lookup, same as the sensors branch above: the receipts states
  // carry no experiments or sessions, and their commands must never fall through to it.
  const receipts = RECEIPTS_STATES[current];
  if (receipts) {
    switch (cmd) {
      case "get_receipts_gate":
        // TRUE here, hard-FALSE in every build (receipts.rs:28). The banner carries that fact.
        return Promise.resolve(true as T);
      case "get_receipts_consent":
        return Promise.resolve({ ...(receiptsConsent as ConsentState) } as T);
      case "get_receipts_endpoint":
        return Promise.resolve(RECEIPTS_ENDPOINT as T);
      case "preview_receipt_payload":
        // The real refusal string a user is most likely to meet once armed (receipts.rs:174) —
        // reviewing invented error copy would prove nothing about the shipped error copy.
        return receipts.previewFails
          ? Promise.reject(
              new Error("No monitored session yet — a receipt needs a measurement first."),
            )
          : Promise.resolve(structuredClone(RECEIPT_PREVIEW) as T);
      case "acknowledge_receipts_disclosure":
      case "set_receipts_sharing_enabled": {
        if (receipts.consentFails) {
          // What the backend actually propagates: save_consent_to (receipts.rs:311) maps a raw
          // std::io::Error to its string, and the component prints it unwrapped. A reviewer
          // should be looking at that, not at a polished message the app cannot produce.
          return Promise.reject(new Error("Access is denied. (os error 5)"));
        }
        const next = { ...(receiptsConsent as ConsentState) };
        if (cmd === "acknowledge_receipts_disclosure") {
          // Stamped ONCE, exactly as receipts.rs:404 does it.
          if (next.disclosed_at === null) next.disclosed_at = "2026-08-25T09:14:00Z";
        } else {
          next.enabled = args?.enabled === true;
        }
        receiptsConsent = next;
        return Promise.resolve({ ...next } as T);
      }
    }
  }
  // Answered ahead of the bench lookup, same as the two branches above. The Black Box states carry
  // no experiments or sessions and must never fall through to it.
  const blackbox = BLACKBOX_STATES[current];
  if (blackbox) {
    if (cmd === "get_crash_blackbox") return Promise.resolve(structuredClone(blackbox.report) as T);
    // The source button hands its URL to the OS browser through the opener plugin, which reaches
    // the backend as this command. Resolving it lets the click be exercised for real; nothing
    // opens, because there is no backend here. The url is echoed to the console so a reviewer can
    // prove WHICH one left — it must be the catalog entry's own, never one the station composed.
    if (cmd === "plugin:opener|open_url") {
      // eslint-disable-next-line no-console
      console.log("FIXTURE PREVIEW - open_url:", args?.url);
      // One state refuses, because the refusal is the thing being reviewed. This is the shape the
      // real plugin returns when Windows has no handler registered for https: a rejected promise,
      // not a resolved null. Resolving here would render the success path under a state name that
      // says otherwise — the exact class of quiet lie this fixture's parity guard exists to stop.
      if (current === "tier1-source-unopenable") {
        return Promise.reject(new Error("FIXTURE PREVIEW - no application is registered to open https"));
      }
      return Promise.resolve(null as T);
    }
  }
  // Answered ahead of the bench lookup, same as the branches above. FirstWin's two commands are a
  // READ and a ROLLBACK, and the rollback is the reason this branch is state-scoped rather than a
  // global allowance: `rollback_change` reaches the mutation boundary in the real app, so it is
  // answered ONLY for the states whose review requires it, and only here, where there is no backend
  // beneath it to reach. The undone and undo-failed paints are otherwise unreachable, exactly like
  // the opener's two branches above.
  const firstwin = FIRSTWIN_STATES[current];
  if (firstwin) {
    if (cmd === "get_recommendations") {
      // The refusal a user is most likely to meet, not invented error prose: a read that could not
      // run. Reviewing a polished message the app cannot produce would prove nothing.
      return firstwin.readFails
        ? Promise.reject(new Error("The scan could not run just now."))
        : Promise.resolve(structuredClone(firstwin.machine) as T);
    }
    if (cmd === "rollback_change") {
      // eslint-disable-next-line no-console
      console.log("FIXTURE PREVIEW - rollback_change:", args?.changeId, "(nothing was rolled back)");
      return firstwin.undoFails
        ? Promise.reject(new Error("Access is denied. (os error 5)"))
        : Promise.resolve(null as T);
    }
  }
  const debrief = DEBRIEF_STATES[current];
  if (debrief) {
    // Two reads and two writes, answered ONLY inside this branch. `arm_comparison` and
    // `dismiss_comparison` write Compy's own comparison record — no Windows setting is touched by
    // either — but hoisting them above the state branches would still hand every other state a
    // silent write answer, which is the shape of the mistake, not a style nit.
    if (cmd === "get_latest_comparison" || cmd === "get_armed_comparison") {
      // Nothing armed and nothing resolved: the card falls to its insight branch, which is the
      // state a user is in the first time this offer is put to them.
      return Promise.resolve(null as T);
    }
    if (cmd === "arm_comparison" || cmd === "dismiss_comparison") {
      // eslint-disable-next-line no-console
      console.log(`FIXTURE PREVIEW - ${cmd}: nothing was armed, and nothing was dismissed.`);
      return Promise.resolve(null as T);
    }
    if (cmd === "what_changed_for_session") {
      // The verbatim outcome intelligence.rs returns for exactly this data — one recorded session
      // of this game, nothing earlier to compare it against. Not invented prose: the panel prints
      // the reason, so a made-up sentence would put a string on screen the app cannot produce.
      return Promise.resolve({
        kind: "unavailable",
        reason: "First recorded Elden Ring session — nothing earlier to compare against.",
      } as T);
    }
  }
  const state = STATES[current];
  switch (cmd) {
    case "get_experiment_gate":
      return Promise.resolve(true as T);
    case "get_experiments":
      return Promise.resolve(state.experiments as T);
    case "get_session_summaries":
      return Promise.resolve(state.sessions as T);
    case "get_recommendations":
      return Promise.resolve(RECS as T);
    // camelCase on purpose — the bench calls this with `{ recId }`, and the arg is echoed back so
    // the preview shows the sim for whichever rec the picker has selected.
    case "simulate_optimization":
      return Promise.resolve({ ...SIM, rec_id: (args?.recId as string) ?? SIM.rec_id } as T);
    default:
      // Loud, not empty. A stub that resolved undefined here would render as a legitimate-looking
      // "nothing to show" and a reviewer would report on a state that does not exist.
      return Promise.reject(new Error(`FIXTURE PREVIEW — no stub for "${cmd}". Add one before reviewing this state.`));
  }
}

// ── SHAPE PARITY WITH THE REAL @tauri-apps/api/core ──────────────────────────────────────────────
// vite.config.mts aliases the WHOLE module to this file, so every named export any file in the
// reachable graph imports from it must exist here — a missing one is a module-graph SyntaxError
// that blanks the entire page before React paints, not a broken feature in one corner.
// Self-review caught exactly that: @tauri-apps/plugin-updater (pulled in via ShellV2 → UpdatePill)
// imports { Resource, Channel, invoke }, and the two missing names killed every fixture state.
// Pinned by src/fixture-parity-guard.test.ts so a new plugin cannot repeat it silently.
export class Channel<T = unknown> {
  id = 0;
  onmessage: (msg: T) => void = () => {};
  toJSON() {
    return `__CHANNEL__:${this.id}`;
  }
}

export class Resource {
  constructor(readonly rid: number = 0) {}
  async close(): Promise<void> {}
}
