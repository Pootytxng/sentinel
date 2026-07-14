// Prettify a process name for DISPLAY only (smalls §4): "Diablo IV.exe" → "Diablo IV".
// Strips a trailing .exe (case-insensitive), an Unreal shipping-binary suffix
// ("-Win64-Shipping"/"_WinGDK_Shipping" — packaging boilerplate, not part of the game's name;
// consumer panel 2026-07-14 flagged "PALWORLD-WIN64-SHIPPING"), and surrounding whitespace.
// Casing is left as-is — game executables carry their own (often deliberate) capitalization, and
// auto-title-casing mangles names like "DOOMEternal" or "csgo". The RAW process name is kept for
// exports + expanded detail.
export function prettyGameName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .trim()
    .replace(/\.exe$/i, "")
    .replace(/[-_]win(64|gdk)[-_]shipping$/i, "");
}
