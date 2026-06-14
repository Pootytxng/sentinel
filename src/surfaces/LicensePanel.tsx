import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LicenseStatus } from "../types";

// Compy Pro — the license status + key-entry surface (DARK foundation, model-agnostic). Reads
// `get_license_status`; while licensing is disarmed the backend reports free with reason
// "licensing not active", so we show ONLY the honest free state and no entry form (no dead-end). When
// the owner arms licensing (real public key + a chosen model), the entry form appears and a valid Pro
// key flips this to "Pro active." Never paywalls safety — this surface only reports a tier.
function friendlyReason(reason: string): string {
  if (reason.includes("expired")) return "That license has expired.";
  if (reason.includes("signature") || reason.includes("malformed")) return "That key doesn't look valid.";
  if (reason === "licensing not active") return "Pro isn't available yet.";
  return "";
}

export function LicensePanel() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [showEntry, setShowEntry] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<LicenseStatus>("get_license_status").then(setStatus).catch(() => {});
  }, []);

  const isPro = !!status && status.valid && status.tier === "pro";
  // "Armed" = the backend is actually validating licenses (a real key is embedded). Until then there's
  // nothing a key could unlock, so we don't show the entry form — just the honest free state.
  const armed = !!status && status.reason !== "licensing not active";

  const submit = () => {
    setSaving(true);
    setError(null);
    invoke<LicenseStatus>("set_license_key", { key: keyInput })
      .then((s) => {
        setStatus(s);
        if (s.valid) setShowEntry(false);
      })
      .catch((e) => setError(typeof e === "string" ? e : "Couldn't save that key."))
      .finally(() => setSaving(false));
  };

  return (
    <section className="set-section">
      <h2 className="set-section-title">License</h2>
      <div className="set-license">
        {isPro ? (
          <p className="set-license-status set-license-pro">
            ✓ Compy Pro is active{status?.expires_at ? ` · renews ${status.expires_at.split("T")[0]}` : ""}.
          </p>
        ) : (
          <p className="set-license-status">
            You're on the free version. All of Compy's core — including everything safety-critical —
            is free.
          </p>
        )}

        {!isPro && armed && !showEntry && (
          <button className="set-license-link" onClick={() => setShowEntry(true)}>
            Have a license key?
          </button>
        )}

        {!isPro && armed && showEntry && (
          <div className="set-license-entry">
            <input
              className="set-license-input"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="Paste your license key"
              aria-label="License key"
              spellCheck={false}
            />
            <button className="set-license-btn cmp-door" onClick={submit} disabled={saving || !keyInput.trim()}>
              {saving ? "Checking…" : "Apply"}
            </button>
            {error ? (
              <p className="set-license-note">{error}</p>
            ) : (
              status &&
              !status.valid &&
              keyInput.trim() !== "" &&
              friendlyReason(status.reason) && (
                <p className="set-license-note">{friendlyReason(status.reason)}</p>
              )
            )}
          </div>
        )}
      </div>
    </section>
  );
}
