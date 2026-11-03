import { invoke } from "@tauri-apps/api/core";
import type { GamingSessionFile } from "../surfaces/gaming-mode";

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

/** What the session slot holds right now: nothing, this run's live session, or a contract to recover. */
export type SessionSlot =
  | { route: "none" }
  | { route: SessionRoute; session: GamingSessionFile };

/**
 * Re-read the slot and route it — the ONE read every surface uses, so the pane's mount, a failed
 * start and App's banner can't disagree about what is on disk (codebase review 2026-11-03: a failed
 * start whose undo also failed left a contract the pane and the banner never showed). An unreadable
 * slot is "none": the caller keeps its plain wording, never a guessed contract.
 */
export async function readSessionSlot(): Promise<SessionSlot> {
  const session = await invoke<GamingSessionFile | null>("get_gaming_session_state").catch(() => null);
  if (!session) return { route: "none" };
  const live =
    session.status === "active" ? await invoke<boolean>("gaming_session_is_live").catch(() => false) : false;
  return { route: routeSession(session.status, live), session };
}

/**
 * App's banner once the pane closes. A contract the slot holds is shown; the same contract in the
 * same state keeps the banner's own object, so a toast tucked away this run stays tucked away, while
 * a changed status (a restore that failed in the pane) is news and greets again. An empty or
 * unreadable slot changes nothing: an unreadable read must never hide a contract.
 */
export function bannerAfterPaneClose(
  current: GamingSessionFile | null,
  slot: SessionSlot,
): GamingSessionFile | null {
  if (slot.route !== "recover") return current;
  const same =
    current !== null && current.session_id === slot.session.session_id && current.status === slot.session.status;
  return same ? current : slot.session;
}

/** The contract a failed start left for App's banner, if any: only a slot to recover holds one. */
export function contractLeftByFailedStart(slot: SessionSlot): GamingSessionFile | null {
  return slot.route === "recover" ? slot.session : null;
}
