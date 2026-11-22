import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SessionSummary } from "../types";
import { parseHomeStatus, type RoughRead } from "./home-facts";

/** What changes when a session is recorded: the newest start and the count. Home re-reads on a change. */
export function sessionsKey(sessions: readonly SessionSummary[]): string {
  let newest = "";
  for (const s of sessions) if (s.started_at > newest) newest = s.started_at;
  return `${sessions.length}|${newest}`;
}

// B1 Home truth: Home reads the session store when it opens (owner decision 2026-11-21, sessions only), and
// again whenever the page's own session list changes (a session recorded while Home stays open), so an old
// answer never stays up. While a new read runs the answer is "not read yet", never the old one. The command
// reads sessions.json read-only and nothing else; a failed read is said as such.
export function useHomeRough(key = ""): RoughRead {
  const [read, setRead] = useState<{ key: string; value: RoughRead }>({ key, value: { kind: "pending" } });
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => invoke<unknown>("paramedic_home_status"))
      .then((v) => {
        if (live) setRead({ key, value: parseHomeStatus(v) });
      })
      .catch(() => {
        if (live) setRead({ key, value: { kind: "unreadable" } });
      });
    return () => {
      live = false;
    };
  }, [key]);
  // An answer read for another session list is stale: "not read yet" until the new read returns.
  return read.key === key ? read.value : { kind: "pending" };
}
