import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, StatusPill } from "../design";
import { WhatsThis } from "../design/WhatsThis";
import { useLibrary } from "./library-context";
import {
  summarizeChanges,
  restoredSummary,
  resumeOptionsFrom,
  statusLabel,
  GAMING_SESSION_RESOLVED_EVENT,
  GAMING_PANE_MOUNTED_EVENT,
  GAMING_PANE_UNMOUNTED_EVENT,
  SUSPENDABLE_SERVICES,
  type GamingSessionFile,
  type RestoredSummary,
  type StartOptions,
} from "./gaming-mode";
import { routeSession } from "../data/gaming-session-route";
import "./GamingMode.css";

const CONSENT_KEY = "compy_gaming_consent_v1";

// Static description of what the CORE (UAC-free) bundle changes — shown idle
// and in the first-use consent modal. The live post-apply list comes from the
// backend session contract (summarizeChanges). `learnId` (where a Blackbook entry
// exists) drives the quiet idle "What's this?" link; WhatsThis self-hides otherwise.
const CORE_ITEMS: { label: string; learnId?: string }[] = [
  { label: "Power plan → max performance (best existing high-perf plan)" },
  { label: "Windows Game Mode on", learnId: "game-mode" },
  { label: "Game Bar / DVR off" },
];

// Suspendable-service → its Blackbook entry (idle "What's this?"); only where one exists.
const SERVICE_LEARN: Record<string, string> = {
  SysMain: "sysmain-superfetch",
  DiagTrack: "diagtrack",
};

export function GamingMode() {
  const [session, setSession] = useState<GamingSessionFile | null>(null);
  const [recovery, setRecovery] = useState<GamingSessionFile | null>(null);
  // Restore-success confirmation (owner-caught UX gap: a successful restore showed nothing).
  // Set ONLY after the backend confirms a full restore; cleared on dismiss or next start.
  const [restored, setRestored] = useState<RestoredSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [needConsent, setNeedConsent] = useState(false);
  const [advUsb, setAdvUsb] = useState(false);
  const [advPcie, setAdvPcie] = useState(false);
  const [suspendSvcs, setSuspendSvcs] = useState<string[]>([]);
  const toggleSvc = (name: string) =>
    setSuspendSvcs((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]));
  const { openLibrary } = useLibrary();
  // Friendly, severity-honest error copy for the flagship mutating feature — the raw error goes to the
  // console (debuggable), never raw in the user's face. A failed STOP/restore must NOT be softened:
  // the user has to know their settings may still be changed (LOCKED rollback-first rule).
  const failGaming = (message: string, detail: unknown) => {
    console.error("[compy gaming]", message, detail);
    setError(message);
  };

  // On mount: an on-disk session that wasn't cleanly cleared = interrupted →
  // prompt to recover. Never auto-restores. Only THIS run's own active session
  // (a tab-switch remount) resumes; an active session left by a prior run that
  // died (reboot/crash) routes to recovery, never silently shown as "on" —
  // that "looks fine" appearance is exactly the trap that left tweaks applied.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await invoke<GamingSessionFile | null>("get_gaming_session_state").catch(
        () => null,
      );
      if (cancelled || !s) return;
      const live =
        s.status === "active"
          ? await invoke<boolean>("gaming_session_is_live").catch(() => false)
          : false;
      if (cancelled) return;
      if (routeSession(s.status, live) === "resume") setSession(s);
      else setRecovery(s);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Tell the App-level banners a pane is on screen (they defer to our richer cards while
  // mounted, and ONLY while mounted — the tab-name deferral left recovery invisible on the
  // Lab outside the Power-features disclosure). Symmetric events keep a counter honest in
  // App even through StrictMode's dev double-mount.
  useEffect(() => {
    window.dispatchEvent(new Event(GAMING_PANE_MOUNTED_EVENT));
    return () => {
      window.dispatchEvent(new Event(GAMING_PANE_UNMOUNTED_EVENT));
    };
  }, []);

  // Another surface (the App-level "Restore now" banner) resolved the session →
  // drop our stale prompts. Never touches `restored`: the acting surface owns the
  // one visible confirmation, this listener only prevents the stale-prompt trap.
  useEffect(() => {
    const onResolved = () => {
      setRecovery(null);
      setSession(null);
    };
    window.addEventListener(GAMING_SESSION_RESOLVED_EVENT, onResolved);
    return () => window.removeEventListener(GAMING_SESSION_RESOLVED_EVENT, onResolved);
  }, []);

  // Esc closes the first-use consent modal (a11y parity with the app's other modals).
  useEffect(() => {
    if (!needConsent) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setNeedConsent(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [needConsent]);

  const active = session?.status === "active";

  const doStart = async () => {
    setBusy(true);
    setError(null);
    setRestored(null);
    try {
      const opts: StartOptions = {
        advancedUsb: advUsb,
        advancedPcie: advPcie,
        suspendServices: suspendSvcs,
      };
      const file = await invoke<GamingSessionFile>("start_gaming_session", { opts });
      setSession(file);
    } catch (e) {
      failGaming(
        "Couldn't start Gaming Mode — it may need an admin OK, or the prompt was cancelled. Try again.",
        e,
      );
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
    // Capture the labels BEFORE the call — after a confirmed restore the session is gone.
    const changes = session?.changes ?? [];
    try {
      await invoke("stop_gaming_session");
      setSession(null);
      setRestored(restoredSummary(changes)); // backend confirmed: every change restored
      window.dispatchEvent(new Event(GAMING_SESSION_RESOLVED_EVENT)); // clear sibling prompts
    } catch (e) {
      failGaming(
        "Couldn't fully restore your settings — they may still be changed. Try Stop again; if it keeps failing, relaunch and use the recovery prompt.",
        e,
      );
    } finally {
      setBusy(false);
    }
  };

  const onRecover = async (confirm: boolean) => {
    setBusy(true);
    setError(null);
    const changes = recovery?.changes ?? [];
    try {
      await invoke("recover_gaming_session", { confirm });
      setRecovery(null);
      if (confirm) {
        setSession(null);
        setRestored(restoredSummary(changes)); // backend confirmed: every change restored
        window.dispatchEvent(new Event(GAMING_SESSION_RESOLVED_EVENT)); // clear sibling prompts
      }
    } catch (e) {
      failGaming(
        "Couldn't finish restoring your settings — try again. Your session is still tracked, so nothing is lost.",
        e,
      );
    } finally {
      setBusy(false);
    }
  };

  // Resume = roll the interrupted session back to the clean prior state FIRST (so the new session
  // snapshots normal settings, not the half-applied ones), then start a fresh session. Reuses the
  // same audited recover + start commands — no new mutation path, restore contract unchanged.
  // Tiers come from the interrupted session's OWN recorded changes (resumeOptionsFrom), not the
  // checkboxes — those reset to core-only on remount, which silently downgraded a resumed
  // advanced-tier session (T6c train, 2026-07-10).
  const onResume = async () => {
    if (!recovery) return;
    const opts: StartOptions = resumeOptionsFrom(recovery.changes);
    setBusy(true);
    setError(null);
    setRestored(null); // heading back into an active session — the honesty line takes over
    try {
      await invoke("recover_gaming_session", { confirm: true });
      setRecovery(null);
      window.dispatchEvent(new Event(GAMING_SESSION_RESOLVED_EVENT)); // clear sibling prompts
      const file = await invoke<GamingSessionFile>("start_gaming_session", { opts });
      setSession(file);
    } catch (e) {
      failGaming("Couldn't resume your session — try again, or Stop and start fresh.", e);
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
          {/* Protection-first framing — same reframe as the App-level banner (consumer-panel Q4). */}
          <div className="gaming-card-head">Finish the last Gaming Mode session</div>
          <p>
            Nothing&apos;s lost — the last session ({statusLabel(recovery.status)}) was interrupted,
            usually because Compy was closed or the PC restarted while it was on. Compy kept the
            full restore receipt. Pick one:
          </p>
          <ul className="gaming-recovery-choices">
            <li>
              <strong>Resume Gaming Mode</strong> — roll back, then re-apply it fresh so you're gaming
              again.
            </li>
            <li>
              <strong>Return to normal</strong> — roll those settings back and leave Gaming Mode off.
            </li>
          </ul>
          <div className="gaming-actions">
            <button className="btn-small btn-small-on" disabled={busy} onClick={onResume}>
              {busy ? "Working…" : "Resume Gaming Mode"}
            </button>
            <button className="btn-small" disabled={busy} onClick={() => onRecover(true)}>
              Return to normal
            </button>
            <button className="link-btn" disabled={busy} onClick={() => onRecover(false)}>
              Not now
            </button>
          </div>
        </Card>
      )}

      {/* Restore-success confirmation — the visible "it worked" a silent restore lacked */}
      {restored && !session && (
        <Card className="gaming-restored">
          <div role="status">
            <div className="gaming-card-head">
              <span className="gaming-restored-check" aria-hidden="true">
                ✓
              </span>{" "}
              {restored.headline}
            </div>
            <p>{restored.detail}</p>
            {restored.labels.length > 0 && (
              <ul className="gaming-diff">
                {restored.labels.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="gaming-actions">
            <button className="btn-small" onClick={() => setRestored(null)}>
              Done
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
                <li key={it.label}>
                  {it.label}
                  {/* explicit space — the label and "What's this?" must not run together */}
                  {it.learnId && <>{" "}<WhatsThis id={it.learnId} onOpen={openLibrary} /></>}
                </li>
              ))}
            </ul>
            <div className="gaming-advanced">
              <div className="gaming-diff-title">Advanced (optional · one admin OK covers everything below):</div>
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
              <div className="gaming-diff-title gaming-subgroup">
                Suspend background services (optional · per session · same single admin OK):
              </div>
              {SUSPENDABLE_SERVICES.map((s) => (
                <label className="gaming-toggle" key={s.name}>
                  <input
                    type="checkbox"
                    checked={suspendSvcs.includes(s.name)}
                    onChange={() => toggleSvc(s.name)}
                  />
                  {s.label}
                  {SERVICE_LEARN[s.name] && (
                    <WhatsThis id={SERVICE_LEARN[s.name]} onOpen={openLibrary} />
                  )}
                </label>
              ))}
            </div>
          </div>
        )}
      </Card>

      {error && (
        <div className="gaming-error">
          <span aria-hidden="true">⚠</span> {error}
        </div>
      )}

      {/* First-use consent modal */}
      {needConsent && (
        <div className="gaming-modal-backdrop" role="dialog" aria-modal="true" aria-label="Turn on Gaming Mode?">
          <div className="gaming-modal">
            <h3>Turn on Gaming Mode?</h3>
            <p>For this session, Compy will change:</p>
            <ul className="gaming-diff">
              {CORE_ITEMS.map((it) => (
                <li key={it.label}>{it.label}</li>
              ))}
              {advUsb && <li>USB selective suspend off (AC)</li>}
              {advPcie && <li>PCIe ASPM off (AC)</li>}
              {suspendSvcs.map((n) => (
                <li key={n}>
                  Suspend {SUSPENDABLE_SERVICES.find((s) => s.name === n)?.label ?? n}
                </li>
              ))}
            </ul>
            <p className="gaming-guarantee">
              <strong>Guarantee:</strong> every change is snapshotted before it's made and
              restored to your <strong>exact</strong> prior state when you stop — even if the
              app or PC crashes (you'll be asked to restore on next launch). Nothing is
              permanent.
            </p>
            <div className="gaming-actions">
              <button className="btn-small btn-small-on" onClick={confirmConsent} autoFocus>
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
