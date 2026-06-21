import { openUrl } from "@tauri-apps/plugin-opener";

// Guided-advisory data — settings Compy DETECTS but deliberately won't mutate (they live in a vendor
// app or a Windows page with no safe, reversible programmatic toggle). We point to the exact place and,
// where a fixed allowlisted ms-settings: deep link exists, open it. Shared by classic Optimize and the
// Fix surface so the guidance is identical. `openUri` is FIXED + allowlisted (never built from data) —
// opened via the already-permitted opener plugin.

export type GuideState = "needs-action" | "unknown";
export type Guide = {
  where: string;
  steps: string[];
  state: GuideState;
  openUri?: string; // allowlisted ms-settings: target
  openLabel?: string;
};

export const GUIDED_STEPS: Record<string, Guide> = {
  "amd-uxp": {
    where: "AMD Software: Adrenalin Edition",
    state: "unknown",
    steps: [
      "Open AMD Software (right-click desktop → AMD Software, or search the Start menu).",
      "Click the gear / Settings (top-right) → Preferences.",
      'Find "User Experience Program" and turn it Off.',
    ],
  },
  "nvidia-low-latency": {
    where: "NVIDIA Control Panel (per-game)",
    state: "unknown",
    steps: [
      "Right-click the desktop → NVIDIA Control Panel.",
      "Manage 3D settings → Program Settings → pick your game.",
      'Set "Low Latency Mode" to Ultra, then Apply.',
    ],
  },
  "gpu-prefer-discrete": {
    where: "Windows Graphics settings",
    state: "unknown",
    openUri: "ms-settings:display-advancedgraphics",
    openLabel: "Open Graphics settings",
    steps: [
      "In Graphics settings, add or select your game's .exe.",
      'Set it to "High performance" (your discrete GPU), then Save.',
    ],
  },
  "monitor-max-refresh": {
    where: "Windows Advanced display",
    state: "needs-action",
    openUri: "ms-settings:display-advanced",
    openLabel: "Open Advanced display",
    steps: [
      'Set "Choose a refresh rate" to the highest value your monitor lists.',
      "If your max isn't shown, check the cable (DisplayPort / HDMI 2.1) and monitor OSD.",
    ],
  },
  "gpu-driver-update": {
    where: "Your GPU vendor's app",
    state: "unknown",
    steps: [
      "NVIDIA: NVIDIA App / GeForce Experience → Drivers → Check for updates.",
      "AMD: AMD Software → Home → Check for Updates.",
      "Intel: Intel Graphics Software → Drivers.",
    ],
  },
  "storage-c-low": {
    where: "Windows Storage settings",
    state: "needs-action",
    openUri: "ms-settings:storagesense",
    openLabel: "Open Storage settings",
    steps: [
      "Run Storage Sense / Cleanup recommendations.",
      "Uninstall unused apps and move large libraries (e.g. game installs) off C:.",
      "Empty the Recycle Bin and Downloads if safe.",
    ],
  },
  "ssd-upgrade-advisory": {
    where: "Hardware (informational)",
    state: "unknown",
    steps: [
      "This is a hardware suggestion, not a setting — an NVMe/SSD dramatically cuts load times.",
      "If you add one, install Windows or your games on it and keep it as the system/boot drive.",
    ],
  },
};

// Security: only fixed ms-settings: targets defined above may ever be opened.
export const ALLOWED_OPEN_URIS = new Set(
  Object.values(GUIDED_STEPS)
    .map((g) => g.openUri)
    // Security: only fixed, allowlisted ms-settings: deep links may ever enter the set —
    // enforced here in code, not just by a test, so a stray https:/file: target can't slip in.
    .filter((u): u is string => typeof u === "string" && u.startsWith("ms-settings:")),
);

export async function openGuidedUri(uri: string) {
  if (!ALLOWED_OPEN_URIS.has(uri)) return; // never open anything off the allowlist
  try {
    await openUrl(uri);
  } catch {
    /* opener unavailable / blocked — the written steps still stand */
  }
}
