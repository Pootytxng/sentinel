// A3 entry metadata — topic taxonomy for the knowledge corpus. ONE central, owner-reviewable map
// from every entry id to a plain-English topic, so Learn can filter by what an entry is ABOUT
// (display, GPU, network, …) on top of the existing type filter. Reversible: rename a label here and
// it changes everywhere; a new entry with no topic fails the knowledge lint (completeness guard).
// Topics are organizational metadata, NOT verdicts — no safety/"safe-to-suspend" judgement lives here.

export type Topic =
  | "display"
  | "input"
  | "network"
  | "cpu"
  | "gpu"
  | "memory"
  | "storage"
  | "windows"
  | "power"
  | "general";

export const TOPICS: Topic[] = ["display", "input", "network", "cpu", "gpu", "memory", "storage", "windows", "power", "general"];

// Hardware applicability tags — OPTIONAL metadata flagging which rigs an entry is relevant to. An
// entry with NO applicability is universal (the common case); a tag set NARROWS it (e.g. NVIDIA
// Reflex applies to "nvidia" rigs only). Organizational metadata, NOT a verdict — never a safety
// judgement. The id -> tags map lives in knowledge.ts (APPLIES_BY_ID), owner-reviewable like topics;
// absent there means universal. The Learn filter uses these to hide entries that don't fit a chosen rig.
export type Applicability = "amd" | "nvidia" | "intel" | "laptop" | "desktop";
export const APPLICABILITY: Applicability[] = ["amd", "nvidia", "intel", "laptop", "desktop"];
export const APPLICABILITY_LABELS: Record<Applicability, string> = {
  amd: "AMD",
  nvidia: "NVIDIA",
  intel: "Intel",
  laptop: "Laptop",
  desktop: "Desktop",
};

export const TOPIC_LABELS: Record<Topic, string> = {
  display: "Display & monitor",
  input: "Mouse & keyboard",
  network: "Network",
  cpu: "CPU",
  gpu: "GPU",
  memory: "Memory (RAM)",
  storage: "Storage",
  windows: "Windows & system",
  power: "Power & cooling",
  general: "General",
};

// id -> topic. Grouped by topic for easy owner review; order here does not matter.
export const TOPIC_BY_ID: Record<string, Topic> = {
  // Display & monitor
  "fullscreen-optimizations": "display",
  "vrr-sync-stack": "display",
  "fps-cap": "display",
  "mpo-disable": "display",
  "exclusive-fullscreen-fps": "display",
  "monitor-overclock-fps": "display",
  "disable-hdr-fps": "display",
  "set-refresh-rate": "display",
  "monitor-response-time-fps": "display",
  "vrr": "display",
  "gsync-freesync": "display",
  "vsync": "display",
  "hz-vs-fps": "display",
  "native-resolution": "display",
  "mpo": "display",
  "fullscreen-modes": "display",
  "screen-tearing": "display",
  "auto-hdr": "display",
  "displayport-vs-hdmi": "display",
  "srgb-clamp": "display",
  "gamma-vs-hdr": "display",
  "chroma-subsampling": "display",
  "human-eye-fps-myth": "display",
  "backlight-strobing": "display",
  "monitor-overdrive": "display",
  "gtg-vs-mprt": "display",
  "vrr-sync-stack-guide": "display",
  "fps-caps-guide": "display",
  "freesync-vrb-exclusion": "display",

  // Mouse & keyboard
  "msi-mode": "input",
  "interrupt-affinity": "input",
  "mouse-acceleration-fps": "input",
  "gaming-mouse-dpi-fps": "input",
  "input-latency": "input",
  "interrupts": "input",
  "polling-rate": "input",
  "dpi-ppi": "input",
  "effective-sensitivity": "input",
  "keyboard-actuation": "input",
  "nkro": "input",
  "rapid-trigger": "input",

  // Network
  "tcp-mega-packs": "network",
  "dns-for-gaming": "network",
  "disable-nagle": "network",
  "wifi-vs-ethernet-fps": "network",
  "powerline-ethernet": "network",
  "moca-ethernet": "network",

  // CPU
  "core-unparking": "cpu",
  "cstates-disable": "cpu",
  "cpu-mitigations": "cpu",
  "pbo-curve-optimizer": "cpu",
  "disable-smt-gaming": "cpu",
  "cpu-affinity-games": "cpu",
  "cpu-overclock-fps": "cpu",
  "c-states": "cpu",
  "pbo": "cpu",
  "undervolting": "cpu",
  "core-parking": "cpu",
  "core-count-gaming": "cpu",

  // GPU
  "nvidia-reflex": "gpu",
  "low-latency-mode": "gpu",
  "anti-lag-plus": "gpu",
  "frame-generation": "gpu",
  "upscaling-quality": "gpu",
  "shader-cache-size": "gpu",
  "hags": "gpu",
  "driver-updates": "gpu",
  "nvidia-prefer-max-performance": "gpu",
  "gpu-overclocking": "gpu",
  "render-scale": "gpu",
  "pcie-gen-fps": "gpu",
  "integrated-graphics-disable-fps": "gpu",
  "lower-graphics-settings": "gpu",
  "frame-gen": "gpu",
  "upscaling": "gpu",
  "gpu-scheduling": "gpu",
  "vram": "gpu",
  "resizable-bar": "gpu",
  "shader-compilation": "gpu",
  "drivers": "gpu",
  "ddu": "gpu",
  "pre-rendered-frames": "gpu",
  "anti-aliasing": "gpu",
  "gpu-boost-clock": "gpu",
  "rebar-sam": "gpu",
  "shader-cache-guide": "gpu",
  "driver-update-guide": "gpu",
  "amd-gpu-undervolt": "gpu",

  // Memory (RAM)
  "xmp-expo": "memory",
  "pagefile-disable": "memory",
  "memory-compression-off": "memory",
  "ram-cleaners": "memory",
  "dual-channel-ram": "memory",
  "ram-capacity-fps": "memory",
  "xmp": "memory",
  "pagefile": "memory",
  "xmp-guide": "memory",

  // Storage
  "defrag-ssd": "storage",
  "ssd-fps": "storage",
  "nvme-ssd-hdd": "storage",
  "raid": "storage",
  "directstorage": "storage",

  // Windows & system
  "game-mode": "windows",
  "useplatformclock": "windows",
  "disable-vbs": "windows",
  "game-dvr-off": "windows",
  "diagtrack": "windows",
  "sysmain-superfetch": "windows",
  "startup-cleanup": "windows",
  "windows-search-off": "windows",
  "visual-effects": "windows",
  "mmcss-systemresponsiveness": "windows",
  "win32priorityseparation": "windows",
  "timer-resolution": "windows",
  "disable-defender": "windows",
  "disable-windows-update": "windows",
  "debloat-scripts": "windows",
  "secure-boot-csm": "windows",
  "run-as-admin-fps": "windows",
  "high-priority-games": "windows",
  "clean-install-windows": "windows",
  "fast-startup-fps": "windows",
  "windows-11-vs-10-fps": "windows",
  "hpet": "windows",
  "secure-boot": "windows",
  "tpm": "windows",
  "uefi-bios": "windows",
  "csm": "windows",
  "telemetry": "windows",
  "debloating": "windows",
  "registry": "windows",
  "restore-point": "windows",
  "clear-cmos": "windows",
  "startup-cleanup-guide": "windows",

  // Power & cooling
  "fan-curves": "power",
  "amd-undervolting": "power",
  "power-plan": "power",
  "bigger-psu-fps": "power",
  "laptop-plugged-in-fps": "power",
  "thermal-throttling": "power",
  "power-plans": "power",
  "power-limit-tdp": "power",
  "fan-curve-guide": "power",

  // General
  "registry-fps-hacks": "general",
  "dll-injectors": "general",
  "aim-tweaks": "general",
  "game-boosters": "general",
  "app-hw-accel-off": "general",
  "monitoring-overlay-fps": "general",
  "close-background-apps-fps": "general",
  "audio-enhancements-fps": "general",
  "instant-replay-fps": "general",
  "registry-cleaners": "general",
  "motherboard-fps": "general",
  "bios-update-fps": "general",
  "kernel-user-space": "general",
  "kernel-driver": "general",
  "dll-injection": "general",
  "anti-cheat": "general",
  "etw": "general",
  "overlay": "general",
  "dpc-latency": "general",
  "traversal-stutter": "general",
  "ue5": "general",
  "noise-floor": "general",
  "benchmark": "general",
  "run-to-run-variance": "general",
  "placebo-effect": "general",
  "cheat-code": "general",
  "leftovers": "general",
  "bottleneck": "general",
  "frame-pacing": "general",
  "frametime": "general",
  "one-percent-lows": "general",
  "fake-deep-scan": "general",
  "invented-issue-counter": "general",
  "fake-optimization-score": "general",
  "scareware-fear-tone": "general",
  "ram-cleaner-booster": "general",
  "paid-driver-updater": "general",
  "tweak-megapack-no-undo": "general",
  "fps-claim-no-methodology": "general",
  "fake-before-after": "general",
  "subscription-trap-local": "general",
  "secret-windows-settings": "general",
  "bundled-bloat-installer": "general",
  "testimonial-wall": "general",
  "paid-one-click-optimizers": "general",
  "how-we-grade": "general",
};
