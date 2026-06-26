// Use-case profile selector (A4 Services / measurement) — a LOCAL, advisory-only context tag.
//
// Picking "what you mostly do" (Gaming / Streaming / Creation / Idle) sets a single localStorage
// value that simply frames the measurements you take: it does NOT change any Windows setting, apply
// a tweak, suspend a service, or arm anything. It's a label, like the rig-tier line — read-only,
// reversible (just pick another), and entirely on this PC. Nothing leaves the machine; no new IPC.
//
// Guarded like every other flag reader (nav-flags.ts, theme.ts): a bare localStorage access throws
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
