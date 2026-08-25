// Receipts consent — the first-run disclosure, the off switch, and "inspect your receipt".
//
// STILL DARK. The gaming_mode pattern: this surface is fully built but renders NOTHING while the
// backend gate is hard-false, and every backend command refuses independently (defense in depth).
// Q9a (2026-08-25) built the send path behind that gate; this is the consent half of it.
//
// The order the backend refuses in — gate → first-run disclosure → your opt-in switch — is the
// order this UI presents, and that is not a coincidence: `receipts::send_decision` is the authority
// and this component must never imply a state the backend would not honour. Notably the disclosure
// is acknowledged FIRST and sharing stays OFF; declining still stamps the disclosure, because "you
// have been told" and "you said yes" are different facts, and merging them is exactly the
// consent-inheritance the outbound tiers forbid.
//
// Default OFF even after arming — owner ruling 2026-08-24 (#207). The shipped app description and
// the public download page already promise "No telemetry"; a claim users already hold outranks a
// later internal amendment. See docs/PRIVACY.md v0.6 and docs/RECEIPTS_DOCTRINE.md §RETIRED.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { BentoTile } from "../design/bento/BentoGrid";
import { Toggle } from "../design/Toggle";
// Side-effect import: guarantees the i18next singleton is initialized even when this component
// is the first (or only) thing a test/entry point loads — mirrors main.tsx's own `import "./i18n"`.
import "../i18n";

type ReceiptPayload = {
  schema_version: number;
  hw_class: { gpu_vendor: string; gpu_model: string; cpu_family: string; ram_gb_bucket: string };
  outcome: {
    kind: string;
    game: string;
    avg_fps: number;
    low1_fps_est: number;
    duration_bucket: string;
    active_change_ids: string[];
  };
};

// Mirrors receipts::ConsentState. `enabled: null` is a fresh install that has made no choice —
// distinct from an explicit `false`, and both mean OFF. Only `true` shares.
type ConsentState = { disclosed_at: string | null; enabled: boolean | null };

export default function ReceiptsConsent() {
  const { t } = useTranslation();
  const [gate, setGate] = useState(false);
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [preview, setPreview] = useState<ReceiptPayload | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [consentErr, setConsentErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    invoke<boolean>("get_receipts_gate")
      .then(async (g) => {
        if (!alive || !g) return;
        // Only read consent behind the gate. A dark build asks the backend nothing about the user.
        const [c, e] = await Promise.all([
          invoke<ConsentState>("get_receipts_consent"),
          invoke<string>("get_receipts_endpoint"),
        ]);
        if (!alive) return;
        setConsent(c);
        setEndpoint(e);
        setGate(true);
      })
      .catch(() => {
        /* probe failed → stay hidden (fail-dark) */
      });
    return () => {
      alive = false;
    };
  }, []);

  // DARK: the gate is hard-false in every shipped build today. `consent` gates alongside it so a
  // half-loaded state can never paint a switch whose position we do not yet know.
  if (!gate || !consent) return null;

  const inspect = async () => {
    setPreviewErr(null);
    try {
      setPreview(await invoke<ReceiptPayload>("preview_receipt_payload"));
    } catch (e) {
      setPreview(null);
      setPreviewErr(String(e));
    }
  };

  // Both disclosure buttons acknowledge; only one of them opts in. Acknowledging FIRST means a
  // failure in the second call leaves the user disclosed-but-off, never opted-in-but-undisclosed.
  const acknowledge = async (optIn: boolean) => {
    setConsentErr(null);
    try {
      let next = await invoke<ConsentState>("acknowledge_receipts_disclosure");
      if (optIn) next = await invoke<ConsentState>("set_receipts_sharing_enabled", { enabled: true });
      setConsent(next);
    } catch (e) {
      setConsentErr(String(e));
    }
  };

  const setSharing = async (enabled: boolean) => {
    setConsentErr(null);
    try {
      setConsent(await invoke<ConsentState>("set_receipts_sharing_enabled", { enabled }));
    } catch (e) {
      setConsentErr(String(e));
    }
  };

  const sharing = consent.enabled === true;

  const inspectRow = (
    <div className="set-row">
      <button className="set-action" onClick={inspect}>
        {t("optimize.receiptsConsent.inspectButton")}
      </button>
    </div>
  );

  // Bento conversion (2026-08-12). span="full" is FORCED, not chosen: this component can return
  // null (the dark gate above), and a narrower tile that vanishes would punch a hole in the strict
  // row-major flow. Mechanised in one-hero-guard.test.ts. The testid rides an inner <div> because
  // BentoTile takes a fixed prop set and does not spread — putting it on the tile would silently
  // drop it and break ReceiptsConsent.test.tsx.
  return (
    <BentoTile title={t("optimize.receiptsConsent.title")} span="full">
      <div data-testid="receipts-consent">
        {consent.disclosed_at === null ? (
          // FIRST RUN. Nothing has been shared and nothing can be until this is answered.
          <div className="receipts-disclosure" data-testid="receipts-disclosure">
            <p className="receipts-hint">{t("optimize.receiptsConsent.hint")}</p>
            <p className="receipts-hint">
              {t("optimize.receiptsConsent.destination", { endpoint })}
            </p>
            {inspectRow}
            <div className="set-row receipts-choice">
              <button className="set-action" onClick={() => acknowledge(true)}>
                {t("optimize.receiptsConsent.acceptButton")}
              </button>
              <button className="set-action" onClick={() => acknowledge(false)}>
                {t("optimize.receiptsConsent.declineButton")}
              </button>
            </div>
          </div>
        ) : (
          <div data-testid="receipts-switch">
            <div className="set-row">
              <div className="set-row-text">
                <div className="set-row-title">{t("optimize.receiptsConsent.switchTitle")}</div>
                <div className="set-row-sub">
                  {sharing
                    ? t("optimize.receiptsConsent.switchOn", { endpoint })
                    : t("optimize.receiptsConsent.switchOff")}
                </div>
              </div>
              <Toggle
                on={sharing}
                onChange={setSharing}
                ariaLabel={t("optimize.receiptsConsent.switchTitle")}
              />
            </div>
            {inspectRow}
          </div>
        )}
        {consentErr && <p className="receipts-hint receipts-error">{consentErr}</p>}
        {previewErr && <p className="receipts-hint receipts-error">{previewErr}</p>}
        {preview && <pre className="receipts-preview">{JSON.stringify(preview, null, 2)}</pre>}
      </div>
    </BentoTile>
  );
}
