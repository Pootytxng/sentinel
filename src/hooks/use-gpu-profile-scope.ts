// React binding for the GPU profile view scope (measurement, UI-only). Reads the saved scope once on
// mount and exposes a setter that persists + updates state. Cross-window/tab changes (picking the
// scope in another Compy window) are picked up via the `storage` event — the same relay pattern the
// use-case profile and the overlay/density flags already use — so the view stays consistent.
//
// Read-only/advisory: this hook only touches localStorage; it never invokes a Tauri command, never
// mutates Windows, never arms anything. Picking a scope just frames which slice of data you view.
import { useCallback, useEffect, useState } from "react";
import { GPU_SCOPE_KEY, readGpuScope, writeGpuScope, type GpuScope } from "../data/profile-store";

export type UseGpuProfileScopeBinding = {
  scope: GpuScope;
  setScope: (s: GpuScope) => void;
};

export function useGpuProfileScope(): UseGpuProfileScopeBinding {
  const [scope, setScopeState] = useState<GpuScope>(() => readGpuScope());

  const setScope = useCallback((s: GpuScope) => {
    writeGpuScope(s);
    setScopeState(s);
  }, []);

  // Keep in sync if another window changes the scope (shared localStorage relay).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === GPU_SCOPE_KEY) setScopeState(readGpuScope());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return { scope, setScope };
}
