// The ledger cannot vouch for itself — the follow-up `src-tauri/src/history.rs` recorded against
// itself when the H1 quarantine fix landed. `get_applied_changes` degrades a Trust Ledger it cannot
// READ to an empty array, and every surface that renders that array renders the emptiness as an
// affirmative claim ABOUT THE MACHINE — "nothing active on this PC", "the record · since <date>" —
// at the exact moment every apply and every rollback is refusing.
//
// The rule, in the wording `intelligence.rs` already used for the same distinction: the user must be
// able to tell "Compy did nothing" apart from "Compy can't tell you what it did".
//
// This module is the ONE disclosure both the Optimize ledger and the Blackbook Logbook render, so
// the two surfaces cannot drift into two different warnings about the same file. It reveals; it
// never repairs.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { LedgerHealth } from "../types";
import "../i18n";
import "./LedgerHealthNotice.css";

/** Probe the ledger's completeness alongside whatever list the caller is about to render.
 *
 *  `refreshKey` should be the data the user is actually looking at (the `AppliedChange[]` identity,
 *  which IPC hands back fresh on every refresh), so health and rows are read on the same tick.
 *
 *  `enabled` false makes this a no-op — for a caller whose disclosure surface isn't mounted (a
 *  flagged-off face), where the probe would be pure idle IPC. It resolves to UNKNOWN, which is
 *  exactly the state that leaves a surface untouched.
 *
 *  A failed probe stays `null` — UNKNOWN. Unknown is NOT `complete: true`: fabricating completeness
 *  because the probe itself failed would be the very defect this exists to fix, and neither is it
 *  incompleteness — see `knownIncomplete`. */
export function useLedgerHealth(refreshKey?: unknown, enabled = true): LedgerHealth | null {
  const [health, setHealth] = useState<LedgerHealth | null>(null);
  useEffect(() => {
    if (!enabled) {
      setHealth(null);
      return;
    }
    let live = true;
    invoke<LedgerHealth>("get_ledger_health")
      .then((h) => {
        if (live) setHealth(h);
      })
      .catch(() => {
        if (live) setHealth(null);
      });
    return () => {
      live = false;
    };
  }, [refreshKey, enabled]);
  return health;
}

/** The health object when the ledger is KNOWN incomplete, else null.
 *
 *  Narrowing to the object itself lets call sites read `.error`/`.quarantined` without re-testing
 *  for null, and — the point — makes "known incomplete" the only truthy case. An UNKNOWN health
 *  falls through as null, which is what leaves every surface exactly as it was. Claiming
 *  incompleteness off a failed probe would be the same sin, mirrored. */
export function knownIncomplete(health: LedgerHealth | null): LedgerHealth | null {
  return health && !health.complete ? health : null;
}

/** The amber disclosure. Renders nothing unless health is KNOWN incomplete, so callers can mount it
 *  unconditionally above the rows it qualifies — a caveat printed under its subject has already
 *  failed at its job. */
export function LedgerHealthNotice({ health }: { health: LedgerHealth | null }) {
  const { t } = useTranslation();
  const [revealError, setRevealError] = useState<string | null>(null);
  const incomplete = knownIncomplete(health);
  if (!incomplete) return null;
  return (
    <div className="ledger-health" role="status">
      <div className="ledger-health-title">
        {incomplete.error
          ? t("common.ledgerHealth.unreadableTitle")
          : t("common.ledgerHealth.quarantinedTitle")}
      </div>
      {incomplete.error && (
        <p className="ledger-health-body">{t("common.ledgerHealth.unreadableBody")}</p>
      )}
      {incomplete.quarantined && (
        <p className="ledger-health-body">{t("common.ledgerHealth.quarantinedBody")}</p>
      )}
      {incomplete.error && <p className="ledger-health-detail">{incomplete.error}</p>}
      {/* [[flags-name-it-and-fix-it-inline]]: naming a folder the user then has to hunt for by
          hand is the dead-end that rule forbids. Read-only — it reveals, it never repairs. */}
      <button
        type="button"
        className="ledger-health-action"
        onClick={() => {
          setRevealError(null);
          invoke("reveal_ledger_folder").catch((e) => setRevealError(String(e)));
        }}
      >
        {incomplete.quarantined
          ? t("common.ledgerHealth.revealFile")
          : t("common.ledgerHealth.revealFolder")}
      </button>
      {/* A button that appears to do nothing is the same dead-end in miniature. */}
      {revealError && <p className="ledger-health-detail">{revealError}</p>}
    </div>
  );
}
