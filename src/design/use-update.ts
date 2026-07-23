// In-app update lifecycle (live-updater train, ARMED 2026-07-22 by owner decision).
//
// Cadence: one check at launch + every 4h while running. Checking never downloads;
// download+install happen only after the user chooses "Update now".
//
// Honesty rails: failed checks never render "up to date", stale offers are removed,
// native Update handles are explicitly closed, and an installed package whose relaunch
// failed is never downloaded a second time just to retry the restart.
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const RECHECK_MS = 4 * 60 * 60 * 1000;

export type UpdatePhase =
  | { kind: "idle" }
  | { kind: "available"; version: string; notes: string | null }
  | { kind: "downloading"; version: string; pct: number | null }
  | { kind: "installing"; version: string }
  | { kind: "blocked"; version: string; message: string }
  | { kind: "restart-required"; version: string; message: string }
  | { kind: "error"; version: string; message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const GAMING_MODE_UPDATE_MESSAGE =
  "Finish Gaming Mode or recover its pending changes before updating Compy.";

async function beginSafeUpdateRestart(): Promise<void> {
  try {
    await invoke("begin_update_restart");
  } catch (error) {
    const detail = errorMessage(error);
    throw new Error(detail && detail !== "undefined" ? detail : GAMING_MODE_UPDATE_MESSAGE);
  }
}

async function cancelSafeUpdateRestart(): Promise<void> {
  try {
    await invoke("cancel_update_restart");
  } catch (error) {
    // Backend failure stays fail-closed: Gaming Mode remains barred for this process.
    console.warn("[update] could not release restart safety barrier:", error);
  }
}

export function useUpdate(): {
  phase: UpdatePhase;
  dismissed: boolean;
  install: () => void;
  dismiss: () => void;
} {
  const [phase, setPhase] = useState<UpdatePhase>({ kind: "idle" });
  const [dismissed, setDismissed] = useState(false);
  const phaseRef = useRef<UpdatePhase>({ kind: "idle" });
  const updateRef = useRef<Update | null>(null);
  const checkingRef = useRef(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const dismissedVersionRef = useRef<string | null>(null);
  const closedUpdatesRef = useRef(new WeakSet<Update>());

  const publishPhase = useCallback((next: UpdatePhase) => {
    phaseRef.current = next;
    if (mountedRef.current) setPhase(next);
  }, []);

  const closeUpdate = useCallback(async (update: Update | null) => {
    if (!update || closedUpdatesRef.current.has(update)) return;
    closedUpdatesRef.current.add(update);
    try {
      await update.close();
    } catch (error) {
      // Cleanup failure is diagnostic only. The handle is already considered released by
      // this hook so it cannot be reused or repeatedly closed.
      console.warn("[update] handle cleanup failed:", error);
    }
  }, []);

  const clearStaleOffer = useCallback(async () => {
    if (phaseRef.current.kind !== "idle" && phaseRef.current.kind !== "available") return;
    const stale = updateRef.current;
    updateRef.current = null;
    publishPhase({ kind: "idle" });
    await closeUpdate(stale);
  }, [closeUpdate, publishPhase]);

  const runCheck = useCallback(async () => {
    const currentKind = phaseRef.current.kind;
    if (
      checkingRef.current ||
      busyRef.current ||
      currentKind === "error" ||
      currentKind === "restart-required"
    ) {
      return;
    }

    checkingRef.current = true;
    try {
      const update = await check();

      if (!mountedRef.current || busyRef.current) {
        await closeUpdate(update);
        return;
      }

      if (!update?.version) {
        await clearStaleOffer();
        return;
      }

      const replaced = updateRef.current;
      updateRef.current = update;
      if (replaced !== update) await closeUpdate(replaced);

      if (
        dismissedVersionRef.current !== null &&
        dismissedVersionRef.current !== update.version
      ) {
        dismissedVersionRef.current = null;
        setDismissed(false);
      }

      publishPhase({
        kind: "available",
        version: update.version,
        notes: update.body ?? null,
      });
    } catch (error) {
      // Offline / endpoint unreachable is routine, but an older offer is no longer honest
      // once its refresh failed. Preserve install/restart failures, which have their own retry.
      console.warn("[update] check failed:", error);
      if (mountedRef.current && !busyRef.current) await clearStaleOffer();
    } finally {
      checkingRef.current = false;
    }
  }, [clearStaleOffer, closeUpdate, publishPhase]);

  useEffect(() => {
    mountedRef.current = true;
    void runCheck();
    const timer = window.setInterval(() => void runCheck(), RECHECK_MS);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      const owned = updateRef.current;
      updateRef.current = null;
      void closeUpdate(owned);
    };
  }, [closeUpdate, runCheck]);

  const install = useCallback(() => {
    if (busyRef.current) return;

    const currentPhase = phaseRef.current;
    if (currentPhase.kind === "restart-required") {
      busyRef.current = true;
      void (async () => {
        try {
          await beginSafeUpdateRestart();
          await relaunch();
        } catch (error) {
          busyRef.current = false;
          console.warn("[update] relaunch blocked/failed:", error);
          publishPhase({
            kind: "restart-required",
            version: currentPhase.version,
            message: errorMessage(error),
          });
        }
      })();
      return;
    }

    const update = updateRef.current;
    if (!update) return;

    busyRef.current = true;
    void (async () => {
      try {
        // Atomic backend barrier: rejects every live/pending/unreadable Gaming Mode contract and
        // prevents a new session from starting during download/install.
        await beginSafeUpdateRestart();
      } catch (error) {
        busyRef.current = false;
        publishPhase({ kind: "blocked", version: update.version, message: errorMessage(error) });
        return;
      }

      let total: number | null = null;
      let received = 0;
      publishPhase({ kind: "downloading", version: update.version, pct: null });
      try {
        await update.downloadAndInstall((event: DownloadEvent) => {
          if (event.event === "Started") {
            total = event.data.contentLength ?? null;
          } else if (event.event === "Progress") {
            received += event.data.chunkLength;
            if (total != null && total > 0) {
              publishPhase({
                kind: "downloading",
                version: update.version,
                pct: Math.min(99, Math.round((received / total) * 100)),
              });
            }
          } else {
            publishPhase({ kind: "installing", version: update.version });
          }
        });
      } catch (error) {
        await cancelSafeUpdateRestart();
        busyRef.current = false;
        console.warn("[update] download/install failed:", error);
        publishPhase({
          kind: "error",
          version: update.version,
          message: errorMessage(error),
        });
        return;
      }

      // The signed package is installed. This handle must not be reused even if relaunch fails.
      if (updateRef.current === update) updateRef.current = null;
      await closeUpdate(update);
      publishPhase({ kind: "installing", version: update.version });

      try {
        // Windows normally exits for the NSIS pass; this is the cross-platform fallback.
        await relaunch();
      } catch (error) {
        busyRef.current = false;
        console.warn("[update] relaunch failed after install:", error);
        publishPhase({
          kind: "restart-required",
          version: update.version,
          message: errorMessage(error),
        });
      }
    })();
  }, [closeUpdate, publishPhase]);

  const dismiss = useCallback(() => {
    dismissedVersionRef.current = updateRef.current?.version ?? null;
    setDismissed(true);
  }, []);

  return { phase, dismissed, install, dismiss };
}
