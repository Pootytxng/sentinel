// Guarded reader for the automatic-update-check preference.
//
// Why this exists (2026-08-03): the signed update check is Compy's ONE outbound call. A product
// that tells users "nothing about your rig is uploaded" should also let them stop the one request
// it does make. This flag gates CHECKING only — it never gates an already-offered download, and it
// never weakens minisign verification, which stays mandatory on every install path.
//
// Default ON: only an explicit "0" disables, matching the guarded-localStorage convention in
// src/data/nav-flags.ts. A bare localStorage read in a render body is banned (devtools-blocked or
// privacy-mode storage throws), so every access here is wrapped.

export const AUTO_UPDATE_CHECK_KEY = "compy_update_autocheck";

// Same-window listeners need an explicit event: the DOM `storage` event only fires in OTHER
// windows/tabs, so Settings flipping the toggle would not reach the hook in this window.
export const AUTO_UPDATE_CHECK_EVENT = "compy:update-autocheck";

// Manual "Check now". Settings must NOT call useUpdate() itself — a second hook instance would
// mean a second launch check, a second 4h interval and a second Update handle. Instead Settings
// signals the single live instance (mounted via <UpdatePill/> in ShellV2), which owns the mutex.
export const UPDATE_CHECK_NOW_EVENT = "compy:update-check-now";

export function autoUpdateChecks(): boolean {
  try {
    return localStorage.getItem(AUTO_UPDATE_CHECK_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setAutoUpdateChecks(on: boolean): void {
  try {
    localStorage.setItem(AUTO_UPDATE_CHECK_KEY, on ? "1" : "0");
  } catch {
    // Storage blocked by devtools/policy must not break Settings. The in-memory notification
    // below still fires so the running session honours the choice until relaunch.
  }
  try {
    window.dispatchEvent(new Event(AUTO_UPDATE_CHECK_EVENT));
  } catch {
    /* no window (SSR/test harness without DOM) — nothing to notify */
  }
}

/** Ask the live update hook to run one check now, regardless of the automatic-check preference. */
export function requestUpdateCheck(): void {
  try {
    window.dispatchEvent(new Event(UPDATE_CHECK_NOW_EVENT));
  } catch {
    /* no window — nothing to ask */
  }
}

/** Subscribe to changes from this window (custom event) and other windows (storage event). */
export function subscribeAutoUpdateChecks(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === AUTO_UPDATE_CHECK_KEY) onChange();
  };
  window.addEventListener(AUTO_UPDATE_CHECK_EVENT, onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(AUTO_UPDATE_CHECK_EVENT, onChange);
    window.removeEventListener("storage", handleStorage);
  };
}
