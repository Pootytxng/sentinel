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
// (src-tauri/src/receipts.rs:23), so the component's own probe returns false and it bails at
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

export const STATE_NAMES = [
  ...Object.keys(STATES),
  ...Object.keys(CPU_TEMP_STATES),
  ...Object.keys(RECEIPTS_STATES),
];

/** Which surface a state name belongs to — main.tsx mounts the bench or the CPU panel on this. */
export const isCpuTempState = (name: string = current) => name in CPU_TEMP_STATES;

/** Same question for the Q9a consent tile, which mounts in the Settings shell, not a room. */
export const isReceiptsState = (name: string = current) => name in RECEIPTS_STATES;

// The state is chosen by `?state=` on the URL so a capture run is a plain navigation — one page
// load per shot, no leftover state from the previous one, and the URL in the address bar names the
// state the screenshot shows.
function initialState(): string {
  try {
    const q = new URLSearchParams(window.location.search).get("state");
    if (q && (STATES[q] || CPU_TEMP_STATES[q] || RECEIPTS_STATES[q])) return q;
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
  if (!STATES[name] && !CPU_TEMP_STATES[name] && !RECEIPTS_STATES[name]) return false;
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
        // TRUE here, hard-FALSE in every build (receipts.rs:23). The banner carries that fact.
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
