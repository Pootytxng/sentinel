// Resume-vs-recover decision for a Gaming Mode session the Gaming tab finds on disk.
//
// An on-disk `active` session is the LIVE one — resume it (show the toggle "on") —
// ONLY when THIS app run started it (e.g. you switched tabs and came back). An
// `active` session left by a PRIOR run that died (reboot/crash), or any non-active
// status (a restore interrupted mid-way), is an interrupted session the user should
// be prompted to RECOVER — never silently resumed as "Gaming Mode on" (which reads
// as "everything's fine" and traps the user into leaving the tweaks applied).
//
// `liveThisRun` comes from the backend `gaming_session_is_live` command, which is
// true only when the in-memory owner id (set at start) matches the on-disk session.

export type SessionRoute = "resume" | "recover";

export function routeSession(status: string, liveThisRun: boolean): SessionRoute {
  if (status === "active" && liveThisRun) return "resume";
  return "recover";
}
