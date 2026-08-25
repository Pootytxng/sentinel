import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import type { LicenseStatus } from "../types";
import { BentoTile } from "../design/bento/BentoGrid";
// Side-effect import: guarantees the i18next instance is initialized before this file's t() calls run.
import "../i18n";

// Compy Pro — the license status + key-entry surface (DARK foundation, model-agnostic). Reads
// `get_license_status`; while licensing is disarmed the backend reports free with reason
// "licensing not active", so we show ONLY the honest free state and no entry form (no dead-end). When
// the owner arms licensing (real public key + a chosen model), the entry form appears and a valid Pro
// key flips this to "Pro active." Never paywalls safety — this surface only reports a tier.
// `t` threaded in explicitly (not a component/hook, so it can't call useTranslation() itself).
function friendlyReason(reason: string, t: (key: string) => string): string {
  if (reason.includes("expired")) return t("common.licensePanel.reasonExpired");
  if (reason.includes("signature") || reason.includes("malformed"))
    return t("common.licensePanel.reasonInvalid");
  if (reason === "licensing not active") return t("common.licensePanel.reasonNotAvailable");
  return "";
}

export function LicensePanel() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [showEntry, setShowEntry] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<LicenseStatus>("get_license_status").then(setStatus).catch(() => {});
  }, []);

  const isPro = !!status && status.valid && status.tier === "pro";
  // "Armed" = the backend is actually validating licenses (a real key is embedded). Read the backend's
  // explicit `armed` flag directly — NOT a string-match on `reason` (reworded copy must never arm the
  // gate). Until armed there's nothing a key could unlock, so we don't show the entry form.
  const armed = !!status && status.armed === true;
  // A key the backend rejected is a FAILURE, not a note, and it now wears the same red as a thrown
  // save error. Hoisted rather than called twice inline so the render reads as what it is.
  const keyRejectionError =
    status && !status.valid && keyInput.trim() !== "" ? friendlyReason(status.reason, t) : "";

  const submit = () => {
    setSaving(true);
    setError(null);
    invoke<LicenseStatus>("set_license_key", { key: keyInput })
      .then((s) => {
        setStatus(s);
        if (s.valid) setShowEntry(false);
      })
      .catch((e) => setError(typeof e === "string" ? e : t("common.licensePanel.saveError")))
      .finally(() => setSaving(false));
  };

  // Bento conversion (2026-08-12). A third-width tile: the free/Pro line is one sentence, and the
  // key-entry form only ever appears once licensing is armed.
  return (
    <BentoTile title={t("common.licensePanel.title")} span="third">
      <div className="set-license">
        {isPro ? (
          <p className="set-license-status set-license-pro">
            {status?.expires_at
              ? t("common.licensePanel.proActiveWithExpiry", {
                  date: status.expires_at.split("T")[0],
                })
              : t("common.licensePanel.proActiveNoExpiry")}
          </p>
        ) : (
          <p className="set-license-status">{t("common.licensePanel.freeVersion")}</p>
        )}

        {!isPro && armed && !showEntry && (
          <button className="set-license-link" onClick={() => setShowEntry(true)}>
            {t("common.licensePanel.haveKey")}
          </button>
        )}

        {!isPro && armed && showEntry && (
          <div className="set-license-entry">
            <input
              className="set-license-input"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={t("common.licensePanel.placeholder")}
              aria-label={t("common.licensePanel.keyAriaLabel")}
              spellCheck={false}
            />
            <button className="set-license-btn cmp-door" onClick={submit} disabled={saving || !keyInput.trim()}>
              {saving ? t("common.licensePanel.checking") : t("common.licensePanel.apply")}
            </button>
            {error ? (
              <p className="set-license-note set-license-error">{error}</p>
            ) : (
              keyRejectionError && (
                <p className="set-license-note set-license-error">{keyRejectionError}</p>
              )
            )}
          </div>
        )}
      </div>
    </BentoTile>
  );
}
