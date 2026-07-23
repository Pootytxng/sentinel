// In-app update lifecycle (live-updater train, ARMED 2026-07-22 by owner decision).
//
// Cadence: one check at launch + every 4h while running (long gaming sessions still hear
// about a patch). Consent-first: checking never downloads — download+install happen ONLY
// when the user clicks "Update now" in the topbar pill (same doctrine as every Compy
// mutation: nothing changes without the user's hand).
//
// Honesty rails: a failed/offline check resolves to idle silently — the shell never
// renders "you're up to date" (that would claim a check that didn't complete) and never
// fabricates availability. The package is minisign-verified by the Rust side against the
// pubkey baked into tauri.conf.json BEFORE install; a compromised release host alone
// cannot push code to this machine.
import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const RECHECK_MS = 4 * 60 * 60 * 1000;

export type UpdatePhase =
  | { kind: "idle" }
  | { kind: "available"; version: string; notes: string | null }
  | { kind: "downloading"; version: string; pct: number | null }
  | { kind: "installing"; version: string }
  | { kind: "error"; version: string; message: string };

export function useUpdate(): {
  phase: UpdatePhase;
  dismissed: boolean;
  install: () => void;
  dismiss: () => void;
} {
  const [phase, setPhase] = useState<UpdatePhase>({ kind: "idle" });
  const [dismissed, setDismissed] = useState(false);
  const updateRef = useRef<Update | null>(null);
  const busyRef = useRef(false);

  const runCheck = useCallback(async () => {
    if (busyRef.current) return;
    try {
      const u = await check();
      if (u?.version) {
        updateRef.current = u;
        setPhase((p) =>
          p.kind === "idle" || p.kind === "available"
            ? { kind: "available", version: u.version, notes: u.body ?? null }
            : p,
        );
      }
    } catch (e) {
      // Offline / endpoint unreachable — stay idle, log for devtools. Never surfaced as
      // an error state: a failed CHECK is routine; only a failed INSTALL is.
      console.warn("[update] check failed:", e);
    }
  }, []);

  useEffect(() => {
    void runCheck();
    const t = window.setInterval(() => void runCheck(), RECHECK_MS);
    return () => window.clearInterval(t);
  }, [runCheck]);

  const install = useCallback(() => {
    const u = updateRef.current;
    if (!u || busyRef.current) return;
    busyRef.current = true;
    let total: number | null = null;
    let got = 0;
    setPhase({ kind: "downloading", version: u.version, pct: null });
    u.downloadAndInstall((ev: DownloadEvent) => {
      if (ev.event === "Started") {
        total = ev.data.contentLength ?? null;
      } else if (ev.event === "Progress") {
        got += ev.data.chunkLength;
        if (total != null && total > 0) {
          const pct = Math.min(99, Math.round((got / total) * 100));
          setPhase({ kind: "downloading", version: u.version, pct });
        }
      } else {
        // Finished: bytes down + signature verified — the installer takes over.
        setPhase({ kind: "installing", version: u.version });
      }
    })
      .then(async () => {
        // Windows quits the app for the NSIS pass automatically; relaunch() is the
        // cross-platform fallback and is unreachable if the process was replaced.
        setPhase({ kind: "installing", version: u.version });
        await relaunch();
      })
      .catch((e: unknown) => {
        busyRef.current = false;
        console.warn("[update] download/install failed:", e);
        setPhase({
          kind: "error",
          version: u.version,
          message: e instanceof Error ? e.message : String(e),
        });
      });
  }, []);

  const dismiss = useCallback(() => setDismissed(true), []);

  return { phase, dismissed, install, dismiss };
}
