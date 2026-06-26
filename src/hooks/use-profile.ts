// React binding for the use-case profile (A4 / measurement). Reads the saved profile once on mount
// and exposes a setter that persists + updates state. Cross-window/tab changes (e.g. picking the
// profile in another Compy window) are picked up via the `storage` event, same relay pattern the
// overlay/density flags already use — so the selection stays consistent across surfaces.
//
// Read-only/advisory: this hook only touches localStorage; it never invokes a Tauri command, never
// mutates Windows, never arms anything. Picking a profile just frames what you measure.
import { useCallback, useEffect, useState } from "react";
import { PROFILE_KEY, readProfile, writeProfile, type UseProfile } from "../data/profile-store";

export type UseProfileBinding = {
  profile: UseProfile;
  setProfile: (p: UseProfile) => void;
};

export function useProfile(): UseProfileBinding {
  const [profile, setProfileState] = useState<UseProfile>(() => readProfile());

  const setProfile = useCallback((p: UseProfile) => {
    writeProfile(p);
    setProfileState(p);
  }, []);

  // Keep in sync if another window changes the profile (shared localStorage relay).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PROFILE_KEY) setProfileState(readProfile());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return { profile, setProfile };
}
