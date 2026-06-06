// Prettify a process name for DISPLAY only (smalls §4): "Diablo IV.exe" → "Diablo IV".
// Strips a trailing .exe (case-insensitive) and surrounding whitespace. Casing is left as-is — game
// executables carry their own (often deliberate) capitalization, and auto-title-casing mangles names
// like "DOOMEternal" or "csgo". The RAW process name is kept for exports + expanded detail.
export function prettyGameName(name: string | null | undefined): string {
  if (!name) return "";
  return name.trim().replace(/\.exe$/i, "");
}
