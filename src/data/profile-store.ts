// Use-case profile selector (A4 Services / measurement) — a LOCAL, advisory-only context tag.
//
// Picking "what you mostly do" (Gaming / Streaming / Creation / Idle) sets a single localStorage
// value that simply frames the measurements you take: it does NOT change any Windows setting, apply
// a tweak, suspend a service, or arm anything. It's a label, like the rig-tier line — read-only,
// reversible (just pick another), and entirely on this PC. Nothing leaves the machine; no new IPC.
//
// Guarded like every other flag reader (design/theme.ts, safe-storage.ts): a bare localStorage throws
// on WebView2 configs where storage is disabled/partitioned, and with no React error boundary that
// throw would blank the whole window. Every read/write swallows the throw and falls back safely.

export const PROFILE_KEY = "compy_use_profile_v1";

/** The four use-case profiles. "idle" is the honest default — no assumption about the user's use. */
export const USE_PROFILES = ["gaming", "streaming", "creation", "idle"] as const;
export type UseProfile = (typeof USE_PROFILES)[number];

export const DEFAULT_PROFILE: UseProfile = "idle";

/** Plain-English label + one honest line of what the profile MEANS (it frames, never changes). */
export type ProfileMeta = {
  id: UseProfile;
  label: string;
  blurb: string;
};

export const PROFILE_META: Record<UseProfile, ProfileMeta> = {
  gaming: {
    id: "gaming",
    label: "Gaming",
    blurb: "Frames measurements around in-game FPS and frametime steadiness.",
  },
  streaming: {
    id: "streaming",
    label: "Streaming",
    blurb: "Game plus encoder — watch for CPU headroom while you broadcast.",
  },
  creation: {
    id: "creation",
    label: "Creation",
    blurb: "Editing and rendering — sustained CPU/GPU and RAM matter most here.",
  },
  idle: {
    id: "idle",
    label: "General",
    blurb: "No particular workload assumed — the neutral default.",
  },
};

/** Type guard: is this string one of the known profiles? Unknown/legacy values fall back to default. */
export function isUseProfile(v: unknown): v is UseProfile {
  return typeof v === "string" && (USE_PROFILES as readonly string[]).includes(v);
}

/** Read the saved profile. Unset, unknown, or a storage error all yield the honest default. */
export function readProfile(): UseProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return isUseProfile(raw) ? raw : DEFAULT_PROFILE;
  } catch {
    return DEFAULT_PROFILE;
  }
}

/** Persist the chosen profile. A storage error is swallowed (the pick just won't stick) — never throws. */
export function writeProfile(p: UseProfile): void {
  try {
    localStorage.setItem(PROFILE_KEY, p);
  } catch {
    /* storage disabled — the selection is in-memory only this session */
  }
}

/** Convenience accessor for the metadata of the saved profile. */
export function profileMeta(p: UseProfile): ProfileMeta {
  return PROFILE_META[p];
}

// ── GPU profile view scope (measurement, UI-only) ────────────────────────────
//
// A viewing lens for the GPU profile surface: look at the GPU picture "globally" (across all your
// usage) or "per-game" (framed around the game you're currently in). Like the use-case profile
// above, this is a LOCAL, advisory-only label held in one localStorage value. It only chooses which
// slice of already-measured data you're LOOKING at — it changes nothing on Windows, applies no
// tweak, arms nothing, and adds no IPC. Same throw-swallowing guard as every other flag reader.

export const GPU_SCOPE_KEY = "compy_gpu_profile_scope_v1";

/** The two viewing scopes. "global" is the honest default — the whole-PC picture, no game assumed. */
export const GPU_SCOPES = ["global", "per-game"] as const;
export type GpuScope = (typeof GPU_SCOPES)[number];

export const DEFAULT_GPU_SCOPE: GpuScope = "global";

/** Plain-English label + one honest line of what the scope MEANS (it frames the view, never changes it). */
export type GpuScopeMeta = {
  id: GpuScope;
  label: string;
  blurb: string;
};

export const GPU_SCOPE_META: Record<GpuScope, GpuScopeMeta> = {
  global: {
    id: "global",
    label: "Global",
    blurb: "Shows the GPU picture across all your usage — no single game assumed.",
  },
  "per-game": {
    id: "per-game",
    label: "Per-game",
    blurb: "Frames the GPU view around the game you're currently in.",
  },
};

/** Type guard: is this string one of the known scopes? Unknown/legacy values fall back to default. */
export function isGpuScope(v: unknown): v is GpuScope {
  return typeof v === "string" && (GPU_SCOPES as readonly string[]).includes(v);
}

/** Read the saved scope. Unset, unknown, or a storage error all yield the honest default. */
export function readGpuScope(): GpuScope {
  try {
    const raw = localStorage.getItem(GPU_SCOPE_KEY);
    return isGpuScope(raw) ? raw : DEFAULT_GPU_SCOPE;
  } catch {
    return DEFAULT_GPU_SCOPE;
  }
}

/** Persist the chosen scope. A storage error is swallowed (the pick just won't stick) — never throws. */
export function writeGpuScope(s: GpuScope): void {
  try {
    localStorage.setItem(GPU_SCOPE_KEY, s);
  } catch {
    /* storage disabled — the selection is in-memory only this session */
  }
}

/** Convenience accessor for the metadata of a given scope. */
export function gpuScopeMeta(s: GpuScope): GpuScopeMeta {
  return GPU_SCOPE_META[s];
}
