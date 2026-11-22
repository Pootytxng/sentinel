import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { parseHomeStatus, type RoughRead } from "./home-facts";

// B1 Home truth: Home reads the session store once when it opens (owner decision 2026-11-21, sessions
// only). The command reads sessions.json read-only and nothing else; a failed read is said as such.
export function useHomeRough(): RoughRead {
  const [read, setRead] = useState<RoughRead>({ kind: "pending" });
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => invoke<unknown>("paramedic_home_status"))
      .then((v) => {
        if (live) setRead(parseHomeStatus(v));
      })
      .catch(() => {
        if (live) setRead({ kind: "unreadable" });
      });
    return () => {
      live = false;
    };
  }, []);
  return read;
}
