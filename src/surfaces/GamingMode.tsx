import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, StatusPill } from "../design";
import {
  summarizeChanges,
  statusLabel,
  type GamingSessionFile,
  type StartOptions,
} from "./gaming-mode";
import "./GamingMode.css";

const CONSENT_KEY = "compy_gaming_consent_v1";

// Static description of what the CORE (UAC-free) bundle changes — shown idle
// and in the first-use consent modal. The live post-apply list comes from the
// backend session contract (summarizeChanges).
const CORE_ITEMS = [
  "Power plan → max performance (best existing high-perf plan)",
  "Windows Game Mode on",
  "Game Bar / DVR off",
];

export function GamingMode() {
  const [session, setSession] = useState<GamingSessionFile | null>(null);
  const [recovery, setRecovery] = useState<GamingSessionFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [needConsent, setNeedConsent] = useState(false);
  const [advUsb, setAdvUsb] = useState(false);
  const [advPcie, setAdvPcie] = useState(false);

  // On mount: an on-disk session that wasn't cleanly cleared = interrupted →
  // prompt to recover. Never auto-restores.
  useEffect(() => {
    let cancelled = false;
    invoke<GamingSessionFile | null>("get_gaming_session_state")
      .then((s) => {
        if (cancelled || !s) return;
        // An "active" session found on (re)mount is the LIVE session — resume it
        // so the toggle reflects reality and Stop restores (e.g. after a tab
        // switch). Only non-active statuses (ending / restore-pending /
        // restore-failed) are a genuinely interrupted restore -> prompt.
        if (s.status === "active") {
          setSession(s);
        } else {
          setRecovery(s);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const active = session?.status === "active";

  const doStart = async () => {
    setBusy(true);
    setError(null);
    try {
      const opts: StartOptions = { advancedUsb: advUsb, advancedPcie: advPcie };
      const file = await invoke<GamingSessionFile>("start_gaming_session", { opts });
      setSession(file);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onStartClick = () => {
    if (localStorage.getItem(CONSENT_KEY) !== "1") {
      setNeedConsent(true);
      return;
    }
    void doStart();
  };

  const confirmConsent = () => {
    localStorage.setItem(CONSENT_KEY, "1");
    setNeedConsent(false);
    void doStart();
  };

  const onStop = async () => {
    setBusy(true);
    setError(null);
    try {
      await invoke("stop_gaming_session");
      setSession(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onRecover = async (confirm: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await invoke("recover_gaming_session", { confirm });
      setRecovery(null);
      if (confirm) setSession(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const summary = session ? summarizeChanges(session.changes) : null;

  return (
    <section className="tab-pane gaming-pane">
      <div className="section-header">
        <h2 className="section-title">Gaming Mode</h2>
        <div className="read-only-pill">Session-scoped · auto-restores</div>
      </div>
      <p className="section-help">
        One switch applies a small set of{" "}
        <strong>already-audited, fully reversible</strong> settings for your gaming
        session, then restores your <strong>exact</strong> prior state when you stop —
        even after a crash or reboot. No registry clown-car, no risky tweaks: a clean,
        honest performance profile that undoes itself.
      </p>

      {/* Interrupted-recovery prompt — highest priority */}
      {recovery && (
        <Card className="gaming-recovery">
          <div className="gaming-card-head">Gaming Mode was interrupted</div>
          <p>
            A previous session didn't end cleanly ({statusLabel(recovery.status)}). Restore
            your previous settings now?
          </p>
          <div className="gaming-actions">
            <button
              className="btn-small btn-small-on"
              disabled={busy}
              onClick={() => onRecover(true)}
            >
              Restore my settings
            </button>
            <button className="btn-small" disabled={busy} onClick={() => onRecover(false)}>
              Not now
            </button>
          </div>
        </Card>
      )}

      {/* Main control */}
      <Card>
        <div className="gaming-control">
          <StatusPill
            status={active ? "ready" : "unknown"}
            label={active ? "Gaming Mode on" : "Gaming Mode off"}
          />
          {active ? (
            <button className="btn-small btn-small-on" disabled={busy} onClick={onStop}>
              {busy ? "Stopping…" : "Stop Gaming Mode"}
            </button>
          ) : (
            <button className="btn-small" disabled={busy} onClick={onStartClick}>
              {busy ? "Starting…" : "Start Gaming Mode"}
            </button>
          )}
        </div>

        {/* Always-visible honesty line (active) */}
        {active && summary && (
          <div className="gaming-honesty">
            <span>{summary.line}</span>
            <button className="link-btn" onClick={() => setShowDiff((v) => !v)}>
              {showDiff ? "Hide" : "View what changed"}
            </button>
            {showDiff && (
              <ul className="gaming-diff">
                {summary.rows.map((r, i) => (
                  <li key={i}>
                    {r.label}
                    {r.elevated && <span className="gaming-uac"> · needs admin to restore</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Idle: what it WILL do + advanced opt-ins */}
        {!active && (
          <div className="gaming-preview">
            <div className="gaming-diff-title">What it changes (all restored on exit):</div>
            <ul className="gaming-diff">
              {CORE_ITEMS.map((it) => (
                <li key={it}>{it}</li>
              ))}
            </ul>
            <div className="gaming-advanced">
              <div className="gaming-diff-title">Advanced (optional · adds a UAC prompt):</div>
              <label className="gaming-toggle">
                <input
                  type="checkbox"
                  checked={advUsb}
                  onChange={(e) => setAdvUsb(e.target.checked)}
                />
                USB selective suspend off (AC)
              </label>
              <label className="gaming-toggle">
                <input
                  type="checkbox"
                  checked={advPcie}
                  onChange={(e) => setAdvPcie(e.target.checked)}
                />
                PCIe ASPM off (AC)
              </label>
            </div>
          </div>
        )}
      </Card>

      {error && <div className="gaming-error">⚠ {error}</div>}

      {/* First-use consent modal */}
      {needConsent && (
        <div className="gaming-modal-backdrop" role="dialog" aria-modal="true">
          <div className="gaming-modal">
            <h3>Turn on Gaming Mode?</h3>
            <p>For this session, Compy will change:</p>
            <ul className="gaming-diff">
              {CORE_ITEMS.map((it) => (
                <li key={it}>{it}</li>
              ))}
              {advUsb && <li>USB selective suspend off (AC)</li>}
              {advPcie && <li>PCIe ASPM off (AC)</li>}
            </ul>
            <p className="gaming-guarantee">
              <strong>Guarantee:</strong> every change is snapshotted before it's made and
              restored to your <strong>exact</strong> prior state when you stop — even if the
              app or PC crashes (you'll be asked to restore on next launch). Nothing is
              permanent.
            </p>
            <div className="gaming-actions">
              <button className="btn-small btn-small-on" onClick={confirmConsent}>
                Enable Gaming Mode
              </button>
              <button className="btn-small" onClick={() => setNeedConsent(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
