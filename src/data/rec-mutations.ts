// Per-rec "what actually changes on your PC" — for the Action Drawer (owner: a pop-up that shows
// exactly what a tweak touches). HONEST + accurate: sourced from the real apply paths in
// src-tauri/src/actions.rs, described at a confidence-safe level (service / setting / value names, not
// guessed full registry paths). A rec with no entry here shows its plain description instead — we never
// invent a technical detail. `elevated` marks changes that need the one UAC prompt; `restart` marks
// ones that need a reboot to take effect.

export type RecMutation = {
  /** Short, accurate sentence(s) on the exact change. */
  changes: string;
  /** Always true for Compy — stated explicitly so the drawer can promise it every time. */
  reverts: string;
  elevated?: boolean;
  restart?: boolean;
};

export const REC_MUTATIONS: Record<string, RecMutation> = {
  "game-mode": {
    changes:
      "Turns on Windows Game Mode by setting two values in your user's Game Bar settings (AllowAutoGameMode + AutoGameModeEnabled).",
    reverts: "Both values are snapshotted first and restored exactly on rollback.",
  },
  "nagle-disable": {
    changes:
      "Adds two TCP settings (TcpAckFrequency + TCPNoDelay) to your active network adapter(s). Only affects games that use TCP.",
    reverts: "The prior per-adapter values (or their absence) are captured and put back on rollback.",
    elevated: true,
  },
  "windows-search-disable": {
    changes: "Stops and disables the Windows Search indexer service (WSearch).",
    reverts: "Rollback restores the service to its previous start type and running state.",
    elevated: true,
  },
  "sysmain-disable": {
    changes: "Stops and disables the SysMain (Superfetch) service.",
    reverts: "Rollback restores the service's previous start type and running state.",
    elevated: true,
  },
  "hags-enable": {
    changes: "Turns on Hardware-accelerated GPU Scheduling (the HwSchMode graphics setting).",
    reverts: "The prior value is snapshotted and restored on rollback.",
    elevated: true,
    restart: true,
  },
  "fast-startup-off": {
    changes: "Turns off Windows Fast Startup (HiberbootEnabled = 0).",
    reverts: "The prior value is captured and restored on rollback.",
    elevated: true,
  },
  "reserved-storage-off": {
    changes: "Turns off Windows Reserved Storage to reclaim ~7–10 GB on C:.",
    reverts: "Rollback re-enables Reserved Storage to its prior state.",
    elevated: true,
  },
  "power-ultimate": {
    changes: "Switches your active power plan to Ultimate Performance (creating it if Windows hasn't yet).",
    reverts: "Your exact previous power plan is recorded and reactivated on rollback.",
    elevated: true,
  },
  "nvidia-telemetry": {
    changes: "Disables the NVIDIA Container telemetry scheduled tasks/services.",
    reverts: "Rollback restores them to their prior state.",
    elevated: true,
  },
  "diagtrack-disable": {
    changes: "Stops and disables the Connected User Experiences and Telemetry service (DiagTrack).",
    reverts: "Rollback restores the service's previous start type and running state.",
    elevated: true,
  },
  "gpu-prefer-discrete": {
    changes: "Tells Windows to prefer your discrete GPU for games (the per-app graphics-performance preference).",
    reverts: "The prior preference is snapshotted and restored on rollback.",
  },
};

export function recMutation(id: string): RecMutation | null {
  return REC_MUTATIONS[id] ?? null;
}
