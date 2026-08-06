// Guarded localStorage access. A BARE localStorage.getItem/setItem in a render body (esp. a
// useState lazy initializer) THROWS a SecurityError on machines/profiles where WebView2 DOM
// storage is disabled or blocked (enterprise Group Policy, browser-hardening software, or a
// corrupted WebView2 profile) — and an uncaught throw during the first render blanks the whole
// app before any recovery UI can mount. Every read/write of localStorage in a component must go
// through these so a disabled store degrades to "no persisted preference", never a blank app.
// Mirrors the try/catch pattern already used in main.tsx and design/theme.ts.

export function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage disabled/full — the preference just isn't persisted this session */
  }
}
