import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Card, StatusPill } from "../design";
import { WhatsThis } from "../design/WhatsThis";
import { useLibrary } from "./library-context";
// Side-effect import: guarantees the i18next singleton is initialized even when this component
// is the first (or only) thing a test/entry point loads — mirrors main.tsx's own `import "./i18n"`.
import "../i18n";
import {
  summarizeChanges,
  restoredSummary,
  resumeOptionsFrom,
  statusLabel,
  GAMING_SESSION_RESOLVED_EVENT,
  GAMING_PANE_MOUNTED_EVENT,
  GAMING_PANE_UNMOUNTED_EVENT,
  suspendableServices,
  type GamingSessionFile,
  type RestoredSummary,
  type StartOptions,
} from "./gaming-mode";
import { readSessionSlot } from "../data/gaming-session-route";
import { lsGet, lsSet } from "../data/safe-storage";
import { useGamingConsoleFlag } from "../design/use-hud";
import "./GamingMode.css";
import "./gaming-console.css";

const CONSENT_KEY = "compy_gaming_consent_v1";
// CR-1102-left owner call (b), delegated 2026-11-10: the extra tiers (UAC: USB, PCIe; service
// suspends) the user has agreed to, as ids "usb", "pcie", "svc:<name>". A newly ticked one asks once
// more, naming only the new ones. Unreadable or malformed storage reads as none agreed (asks again).
const EXTRAS_KEY = "compy_gaming_consent_extras_v1";

/** The extras a start would turn on, as consent ids. */
function tickedExtras(usb: boolean, pcie: boolean, services: readonly string[]): string[] {
  return [...(usb ? ["usb"] : []), ...(pcie ? ["pcie"] : []), ...services.map((n) => `svc:${n}`)];
}

/** The extras already agreed to; anything unreadable is none. */
function agreedExtras(raw: string | null): Set<string> {
  try {
    const v: unknown = raw == null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** The ticked extras not yet agreed to, in tick order. */
function newExtras(ticked: readonly string[], agreed: ReadonlySet<string>): string[] {
  return ticked.filter((id) => !agreed.has(id));
}

function recordExtras(ids: readonly string[]) {
  const agreed = agreedExtras(lsGet(EXTRAS_KEY));
  for (const id of ids) agreed.add(id);
  lsSet(EXTRAS_KEY, JSON.stringify([...agreed]));
}

// Static description of what the CORE (UAC-free) bundle changes — shown idle
// and in the first-use consent modal. The live post-apply list comes from the
// backend session contract (summarizeChanges). `learnId` (where a Blackbook entry
// exists) drives the quiet idle "What's this?" link; WhatsThis self-hides otherwise.
// `key` resolves to gaming.gamingMode.coreItems.<key> — text lives in the i18n JSON, not here.
const CORE_ITEMS: { key: "powerPlan" | "gameMode" | "gameBar"; learnId?: string }[] = [
  { key: "powerPlan" },
  { key: "gameMode", learnId: "game-mode" },
  { key: "gameBar" },
];

// Suspendable-service → its Blackbook entry (idle "What's this?"); only where one exists.
const SERVICE_LEARN: Record<string, string> = {
  SysMain: "sysmain-superfetch",
  DiagTrack: "diagtrack",
};

export function GamingMode() {
  const { t } = useTranslation();
  const [session, setSession] = useState<GamingSessionFile | null>(null);
  const [recovery, setRecovery] = useState<GamingSessionFile | null>(null);
  // "Not now" folds the recovery card into one row instead of dropping it: the contract stays on
  // disk (recover(false) leaves it), so the pane keeps a way back to it and Engage stays shut —
  // a start would only refuse "recover it first" (codebase review 2026-11-03).
  const [recoveryDeferred, setRecoveryDeferred] = useState(false);
  // Restore-success confirmation (owner-caught UX gap: a successful restore showed nothing).
  // Set ONLY after the backend confirms a full restore; cleared on dismiss or next start.
  const [restored, setRestored] = useState<RestoredSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [needConsent, setNeedConsent] = useState(false);
  // CR-1102-left owner call (b): the newly ticked extras the confirm names, or null.
  const [needExtras, setNeedExtras] = useState<string[] | null>(null);
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

  // Codebase review 2026-11-03: a failed start can leave a rollback contract on disk — a start whose
  // own undo failed is left restore-failed ("your system may still be changed"), and a start refused
  // because a contract already exists leaves that one applied. So a failed start re-reads the slot
  // and shows whatever is there, routed exactly as on mount. Only an empty slot gets the plain
  // "try again", because only then is nothing of Gaming Mode's left on this PC.
  const failStart = async (message: string, detail: unknown) => {
    const slot = await readSessionSlot();
    if (slot.route === "none") {
      failGaming(message, detail);
      return;
    }
    if (slot.route === "resume") setSession(slot.session);
    else {
      setRecovery(slot.session);
      setRecoveryDeferred(false);
    }
    failGaming(t("gaming.gamingMode.errorStartLeftChanged"), detail);
  };

  // On mount: an on-disk session that wasn't cleanly cleared = interrupted →
  // prompt to recover. Never auto-restores. Only THIS run's own active session
  // (a tab-switch remount) resumes; an active session left by a prior run that
  // died (reboot/crash) routes to recovery, never silently shown as "on" —
  // that "looks fine" appearance is exactly the trap that left tweaks applied.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const slot = await readSessionSlot();
      if (cancelled || slot.route === "none") return;
      if (slot.route === "resume") setSession(slot.session);
      else setRecovery(slot.session);
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
      setRecoveryDeferred(false);
      setSession(null);
    };
    window.addEventListener(GAMING_SESSION_RESOLVED_EVENT, onResolved);
    return () => window.removeEventListener(GAMING_SESSION_RESOLVED_EVENT, onResolved);
  }, []);

  // Esc closes the first-use consent modal (a11y parity with the app's other modals), and the
  // newly-ticked-extras confirm the same way; closing either starts nothing.
  useEffect(() => {
    if (!needConsent && needExtras == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setNeedConsent(false);
        setNeedExtras(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [needConsent, needExtras]);

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
      await failStart(t("gaming.gamingMode.errorStart"), e);
    } finally {
      setBusy(false);
    }
  };

  // Guarded storage: a bare localStorage throws where WebView2 storage is disabled, and Engage
  // then did nothing at all. Unreadable consent just asks again.
  const ticked = tickedExtras(advUsb, advPcie, suspendSvcs);
  // Review r1 (opus) SHOULD-FIX: the tier boxes are shut while either confirm is open, so what a
  // confirm names is what starts (keyboard focus could otherwise tick one behind the backdrop).
  const dialogOpen = needConsent || needExtras != null;
  const onStartClick = () => {
    if (lsGet(CONSENT_KEY) !== "1") {
      setNeedConsent(true);
      return;
    }
    // CR-1102-left owner call (b): after the one-time consent, extras ticked since ask once more.
    const fresh = newExtras(ticked, agreedExtras(lsGet(EXTRAS_KEY)));
    if (fresh.length > 0) {
      setNeedExtras(fresh);
      return;
    }
    void doStart();
  };

  const confirmConsent = () => {
    lsSet(CONSENT_KEY, "1");
    // The first-use modal listed every ticked extra, so agreeing covers them.
    recordExtras(ticked);
    setNeedConsent(false);
    setNeedExtras(null); // review r2 (opus) nit: no stale extras confirm over the started session
    void doStart();
  };

  // Only what this confirm named AND is still ticked is recorded (review r1 nit: an item un-ticked
  // before Enable isn't agreed to); anything ticked since it opened asks again.
  const confirmExtras = () => {
    const named = (needExtras ?? []).filter((id) => ticked.includes(id));
    const agreed = agreedExtras(lsGet(EXTRAS_KEY));
    const still = newExtras(ticked, new Set([...agreed, ...named]));
    recordExtras(named);
    if (still.length > 0) {
      setNeedExtras(still);
      return;
    }
    setNeedExtras(null);
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
      setRestored(restoredSummary(changes, t)); // backend confirmed: every change restored
      window.dispatchEvent(new Event(GAMING_SESSION_RESOLVED_EVENT)); // clear sibling prompts
    } catch (e) {
      failGaming(t("gaming.gamingMode.errorStop"), e);
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
      setRecoveryDeferred(false);
      if (confirm) {
        setSession(null);
        setRestored(restoredSummary(changes, t)); // backend confirmed: every change restored
        window.dispatchEvent(new Event(GAMING_SESSION_RESOLVED_EVENT)); // clear sibling prompts
      }
    } catch (e) {
      failGaming(t("gaming.gamingMode.errorRecover"), e);
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
    } catch (e) {
      // The restore leg failed: the session is still tracked and its card stays up.
      failGaming(t("gaming.gamingMode.errorRecover"), e);
      setBusy(false);
      return;
    }
    setRecovery(null);
    setRecoveryDeferred(false);
    window.dispatchEvent(new Event(GAMING_SESSION_RESOLVED_EVENT)); // clear sibling prompts
    try {
      const file = await invoke<GamingSessionFile>("start_gaming_session", { opts });
      setSession(file);
    } catch (e) {
      await failStart(t("gaming.gamingMode.errorResume"), e);
    } finally {
      setBusy(false);
    }
  };

  const summary = session ? summarizeChanges(session.changes, t) : null;

  // Console face (compy_gaming_console, DEFAULT ON — "0" devtools failsafe restores the classic
  // card below). Presentation only: both faces share every hook/handler above — same audited
  // commands, same consent gate, same recovery routing. Zero new IPC.
  const consoleOn = useGamingConsoleFlag();

  // The first-use consent modal + error line render identically in both faces — the consent gate
  // is a mutation boundary, not a styling surface, so it stays ONE tree regardless of the flag.
  // CR-1102-left owner call (b): the same modal, after the one-time consent, names only the extras
  // ticked since the user agreed (`needExtras`); the first-use form wins while it is open.
  const extraLabel = (id: string) => {
    if (id === "usb") return t("gaming.gamingMode.usbToggleLabel");
    if (id === "pcie") return t("gaming.gamingMode.pcieToggleLabel");
    const n = id.slice("svc:".length);
    return t("gaming.gamingMode.suspendServiceItem", {
      service: suspendableServices(t).find((s) => s.name === n)?.label ?? n,
    });
  };
  const extrasOnly = !needConsent && needExtras != null;
  const consentModal = (needConsent || needExtras != null) && (
    <div
      className="gaming-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t(extrasOnly ? "gaming.gamingMode.extrasConsentTitle" : "gaming.gamingMode.consentTitle")}
    >
      <div className="gaming-modal">
        <h3>{t(extrasOnly ? "gaming.gamingMode.extrasConsentTitle" : "gaming.gamingMode.consentTitle")}</h3>
        <p>{t(extrasOnly ? "gaming.gamingMode.extrasConsentIntro" : "gaming.gamingMode.consentIntro")}</p>
        {extrasOnly ? (
          <ul className="gaming-diff" data-testid="gaming-extras-consent-list">
            {(needExtras ?? []).map((id) => (
              <li key={id}>{extraLabel(id)}</li>
            ))}
          </ul>
        ) : (
          <ul className="gaming-diff">
            {CORE_ITEMS.map((it) => (
              <li key={it.key}>{t(`gaming.gamingMode.coreItems.${it.key}`)}</li>
            ))}
            {advUsb && <li>{t("gaming.gamingMode.usbToggleLabel")}</li>}
            {advPcie && <li>{t("gaming.gamingMode.pcieToggleLabel")}</li>}
            {suspendSvcs.map((n) => (
              <li key={n}>
                {t("gaming.gamingMode.suspendServiceItem", {
                  service: suspendableServices(t).find((s) => s.name === n)?.label ?? n,
                })}
              </li>
            ))}
          </ul>
        )}
        <p className="gaming-guarantee">
          <strong>{t("gaming.gamingMode.guaranteeLabel")}</strong>{" "}
          {t("gaming.gamingMode.guaranteeMid")}{" "}
          <strong>{t("gaming.gamingMode.guaranteeEmph")}</strong>{" "}
          {t("gaming.gamingMode.guaranteePost")}
        </p>
        <div className="gaming-actions">
          <button className="btn-small btn-small-on" onClick={extrasOnly ? confirmExtras : confirmConsent} autoFocus>
            {t("gaming.gamingMode.enableButton")}
          </button>
          <button
            className="btn-small"
            onClick={() => {
              setNeedConsent(false);
              setNeedExtras(null);
            }}
          >
            {t("gaming.gamingMode.cancelButton")}
          </button>
        </div>
      </div>
    </div>
  );

  const errorLine = error && (
    <div className="gaming-error">
      <span aria-hidden="true">⚠</span> {error}
    </div>
  );

  if (consoleOn) {
    return (
      <section className="tab-pane gaming-pane gc-pane">
        <div className="section-header">
          <h2 className="section-title">{t("gaming.gamingMode.heading")}</h2>
          <div className="read-only-pill">{t("gaming.gamingMode.sessionScopedPill")}</div>
        </div>

        {/* Status strip — the armed/engaged state word + the restore guarantee as the STANDING
            light (always lit: the receipt discipline holds whether idle, engaged, or recovering). */}
        <div className="gc-strip">
          <span
            className={`gc-led ${active ? "gc-led-on" : recovery ? "gc-led-warn" : ""}`}
            aria-hidden="true"
          />
          <span className="gc-state">
            {active
              ? t("gaming.gamingMode.stateEngaged")
              : recovery
                ? t("gaming.gamingMode.stateInterrupted")
                : t("gaming.gamingMode.stateStandingBy")}
          </span>
          <span className="gc-guarantee">
            <span className="gc-led gc-led-hold" aria-hidden="true" />
            {t("gaming.gamingMode.restoreReceiptLine")}
          </span>
        </div>

        {/* Interrupted-recovery panel — highest priority (same choices + copy as classic) */}
        {recovery && recoveryDeferred && (
          <div className="gc-panel gc-recovery gc-recovery-deferred" role="status">
            <p className="gc-prose">{t("gaming.gamingMode.recoveryDeferredLine")}</p>
            <div className="gaming-actions">
              <button className="gc-btn" onClick={() => setRecoveryDeferred(false)}>
                {t("gaming.gamingMode.recoveryReviewButton")}
              </button>
            </div>
          </div>
        )}
        {recovery && !recoveryDeferred && (
          <div className="gc-panel gc-recovery">
            <div className="gc-panel-title">{t("gaming.gamingMode.recoveryTitle")}</div>
            <p className="gc-prose">
              {t("gaming.gamingMode.recoveryIntro", { status: statusLabel(recovery.status, t) })}
            </p>
            <ul className="gaming-recovery-choices">
              <li>
                <strong>{t("gaming.gamingMode.resumeButton")}</strong>{" "}
                — {t("gaming.gamingMode.resumeChoiceDesc")}
              </li>
              <li>
                <strong>{t("gaming.gamingMode.returnNormalButton")}</strong>{" "}
                — {t("gaming.gamingMode.returnNormalDesc")}
              </li>
            </ul>
            <div className="gaming-actions">
              <button className="gc-btn gc-btn-primary" disabled={busy} onClick={onResume}>
                {busy ? t("gaming.gamingMode.workingEllipsis") : t("gaming.gamingMode.resumeButton")}
              </button>
              <button className="gc-btn" disabled={busy} onClick={() => onRecover(true)}>
                {t("gaming.gamingMode.returnNormalButton")}
              </button>
              <button className="link-btn" disabled={busy} onClick={() => setRecoveryDeferred(true)}>
                {t("gaming.gamingMode.notNow")}
              </button>
            </div>
          </div>
        )}

        {/* Restore-success confirmation */}
        {restored && !session && (
          <div className="gc-panel gc-restored" role="status">
            <div className="gc-panel-title">
              <span className="gaming-restored-check" aria-hidden="true">✓</span>{" "}
              {restored.headline}
            </div>
            <p className="gc-prose">{restored.detail}</p>
            {restored.labels.length > 0 && (
              <ul className="gc-contract">
                {restored.labels.map((label) => (
                  <li key={label} className="gc-contract-row gc-contract-done">
                    <span className="gc-tick" aria-hidden="true" />
                    {label}
                  </li>
                ))}
              </ul>
            )}
            <div className="gaming-actions">
              <button className="gc-btn" onClick={() => setRestored(null)}>
                {t("gaming.gamingMode.doneButton")}
              </button>
            </div>
          </div>
        )}

        {/* The engage console — armed-tier readouts + ONE staged engage control. */}
        <div className="gc-panel">
          {active && summary ? (
            <>
              {/* Session contract as a LIVE checklist: the real applied changes from the
                  backend session file, each held under the restore receipt. */}
              <div className="gc-panel-title">{t("gaming.gamingMode.sessionContractLive")}</div>
              <ul className="gc-contract">
                {summary.rows.map((r, i) => (
                  <li key={i} className="gc-contract-row gc-contract-live">
                    <span className="gc-tick" aria-hidden="true" />
                    {r.label}
                    {r.elevated && (
                      <span className="gaming-uac"> {t("gaming.gamingMode.needsAdminSuffix")}</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="gc-honesty">{summary.line}</p>
              <button className="gc-engage gc-engage-on" disabled={busy} onClick={onStop}>
                {busy ? t("gaming.gamingMode.restoringEllipsis") : t("gaming.gamingMode.disengageButton")}
              </button>
            </>
          ) : (
            <>
              {/* Armed-tier readouts: the core tier always arms; advanced tiers arm per session. */}
              <div className="gc-panel-title">{t("gaming.gamingMode.armedTitle")}</div>
              <ul className="gc-contract">
                {CORE_ITEMS.map((it) => (
                  <li key={it.key} className="gc-contract-row">
                    <span className="gc-tick" aria-hidden="true" />
                    {t(`gaming.gamingMode.coreItems.${it.key}`)}
                    {it.learnId && <>{" "}<WhatsThis id={it.learnId} onOpen={openLibrary} /></>}
                  </li>
                ))}
              </ul>
              <div className="gc-tier">
                <div className="gc-tier-title">
                  {t("gaming.gamingMode.advancedTierTitle")}
                </div>
                <label className="gaming-toggle">
                  <input
                    type="checkbox"
                    checked={advUsb}
                    disabled={dialogOpen}
                    onChange={(e) => setAdvUsb(e.target.checked)}
                  />
                  {t("gaming.gamingMode.usbToggleLabel")}
                </label>
                <label className="gaming-toggle">
                  <input
                    type="checkbox"
                    checked={advPcie}
                    disabled={dialogOpen}
                    onChange={(e) => setAdvPcie(e.target.checked)}
                  />
                  {t("gaming.gamingMode.pcieToggleLabel")}
                </label>
                <div className="gc-tier-title gc-tier-sub">
                  {t("gaming.gamingMode.suspendServicesTitle")}
                </div>
                {suspendableServices(t).map((s) => (
                  <label className="gaming-toggle" key={s.name}>
                    <input
                      type="checkbox"
                      checked={suspendSvcs.includes(s.name)}
                      disabled={dialogOpen}
                      onChange={() => toggleSvc(s.name)}
                    />
                    {s.label}
                    {SERVICE_LEARN[s.name] && (
                      <WhatsThis id={SERVICE_LEARN[s.name]} onOpen={openLibrary} />
                    )}
                  </label>
                ))}
              </div>
              {/* Shut while a contract is on disk: a start would only refuse "recover it first". */}
              <button className="gc-engage" disabled={busy || recovery !== null} onClick={onStartClick}>
                {busy ? t("gaming.gamingMode.engagingEllipsis") : t("gaming.gamingMode.engageButton")}
              </button>
              {/* The promise explainer lives HERE, collapsed on the control it describes —
                  never as a standing lede under the title (title-header law, self-review
                  2026-07-15). The classic fallback face keeps its original paragraph. */}
              <details className="gc-what">
                <summary>{t("gaming.gamingMode.engageDetailsSummary")}</summary>
                <p>
                  {t("gaming.gamingMode.engageExplainPre")}{" "}
                  <strong>{t("gaming.gamingMode.engageExplainEmph1")}</strong>{" "}
                  {t("gaming.gamingMode.engageExplainMid")}{" "}
                  <strong>{t("gaming.gamingMode.engageExplainEmph2")}</strong>{" "}
                  {t("gaming.gamingMode.engageExplainPost")}
                </p>
              </details>
            </>
          )}
        </div>

        {errorLine}
        {consentModal}
      </section>
    );
  }

  return (
    <section className="tab-pane gaming-pane">
      <div className="section-header">
        <h2 className="section-title">{t("gaming.gamingMode.heading")}</h2>
        <div className="read-only-pill">{t("gaming.gamingMode.sessionScopedPill")}</div>
      </div>
      <p className="section-help">
        {t("gaming.gamingMode.sectionHelpPre")}{" "}
        <strong>{t("gaming.gamingMode.sectionHelpEmph1")}</strong>{" "}
        {t("gaming.gamingMode.sectionHelpMid")}{" "}
        <strong>{t("gaming.gamingMode.sectionHelpEmph2")}</strong>{" "}
        {t("gaming.gamingMode.sectionHelpPost")}
      </p>

      {/* Interrupted-recovery prompt — highest priority */}
      {recovery && recoveryDeferred && (
        <Card className="gaming-recovery gaming-recovery-deferred">
          <p>{t("gaming.gamingMode.recoveryDeferredLine")}</p>
          <div className="gaming-actions">
            {/* A link, not a bare .btn-small: that one hovers red, and reopening the card is not destructive. */}
            <button className="link-btn" onClick={() => setRecoveryDeferred(false)}>
              {t("gaming.gamingMode.recoveryReviewButton")}
            </button>
          </div>
        </Card>
      )}
      {recovery && !recoveryDeferred && (
        <Card className="gaming-recovery">
          {/* Protection-first framing — same reframe as the App-level banner (consumer-panel Q4). */}
          <div className="gaming-card-head">{t("gaming.gamingMode.recoveryTitle")}</div>
          <p>
            {t("gaming.gamingMode.recoveryIntro", { status: statusLabel(recovery.status, t) })}
          </p>
          <ul className="gaming-recovery-choices">
            <li>
              <strong>{t("gaming.gamingMode.resumeButton")}</strong>{" "}
              — {t("gaming.gamingMode.resumeChoiceDesc")}
            </li>
            <li>
              <strong>{t("gaming.gamingMode.returnNormalButton")}</strong>{" "}
              — {t("gaming.gamingMode.returnNormalDesc")}
            </li>
          </ul>
          <div className="gaming-actions">
            <button className="btn-small btn-small-on" disabled={busy} onClick={onResume}>
              {busy ? t("gaming.gamingMode.workingEllipsis") : t("gaming.gamingMode.resumeButton")}
            </button>
            <button className="btn-small" disabled={busy} onClick={() => onRecover(true)}>
              {t("gaming.gamingMode.returnNormalButton")}
            </button>
            <button className="link-btn" disabled={busy} onClick={() => setRecoveryDeferred(true)}>
              {t("gaming.gamingMode.notNow")}
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
              {t("gaming.gamingMode.doneButton")}
            </button>
          </div>
        </Card>
      )}

      {/* Main control */}
      <Card>
        <div className="gaming-control">
          <StatusPill
            status={active ? "ready" : "unknown"}
            label={active ? t("gaming.gamingMode.statusOn") : t("gaming.gamingMode.statusOff")}
          />
          {active ? (
            <button className="btn-small btn-small-on" disabled={busy} onClick={onStop}>
              {busy ? t("gaming.gamingMode.stoppingEllipsis") : t("gaming.gamingMode.stopButton")}
            </button>
          ) : (
            <button className="btn-small" disabled={busy || recovery !== null} onClick={onStartClick}>
              {busy ? t("gaming.gamingMode.startingEllipsis") : t("gaming.gamingMode.startButton")}
            </button>
          )}
        </div>

        {/* Always-visible honesty line (active) */}
        {active && summary && (
          <div className="gaming-honesty">
            <span>{summary.line}</span>
            <button className="link-btn" onClick={() => setShowDiff((v) => !v)}>
              {showDiff ? t("gaming.gamingMode.hideButton") : t("gaming.gamingMode.viewChangedButton")}
            </button>
            {showDiff && (
              <ul className="gaming-diff">
                {summary.rows.map((r, i) => (
                  <li key={i}>
                    {r.label}
                    {r.elevated && (
                      <span className="gaming-uac"> {t("gaming.gamingMode.needsAdminSuffix")}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Idle: what it WILL do + advanced opt-ins */}
        {!active && (
          <div className="gaming-preview">
            <div className="gaming-diff-title">{t("gaming.gamingMode.whatItChangesTitle")}</div>
            <ul className="gaming-diff">
              {CORE_ITEMS.map((it) => (
                <li key={it.key}>
                  {t(`gaming.gamingMode.coreItems.${it.key}`)}
                  {/* explicit space — the label and "What's this?" must not run together */}
                  {it.learnId && <>{" "}<WhatsThis id={it.learnId} onOpen={openLibrary} /></>}
                </li>
              ))}
            </ul>
            <div className="gaming-advanced">
              <div className="gaming-diff-title">{t("gaming.gamingMode.advancedOptionalTitle")}</div>
              <label className="gaming-toggle">
                <input
                  type="checkbox"
                  checked={advUsb}
                  disabled={dialogOpen}
                  onChange={(e) => setAdvUsb(e.target.checked)}
                />
                {t("gaming.gamingMode.usbToggleLabel")}
              </label>
              <label className="gaming-toggle">
                <input
                  type="checkbox"
                  checked={advPcie}
                  disabled={dialogOpen}
                  onChange={(e) => setAdvPcie(e.target.checked)}
                />
                {t("gaming.gamingMode.pcieToggleLabel")}
              </label>
              <div className="gaming-diff-title gaming-subgroup">
                {t("gaming.gamingMode.suspendServicesTitleColon")}
              </div>
              {suspendableServices(t).map((s) => (
                <label className="gaming-toggle" key={s.name}>
                  <input
                    type="checkbox"
                    checked={suspendSvcs.includes(s.name)}
                    disabled={dialogOpen}
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

      {errorLine}
      {consentModal}
    </section>
  );
}
