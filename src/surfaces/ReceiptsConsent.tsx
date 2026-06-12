// Receipts consent + "inspect your receipt" — DARK (R3 Lane C2; doctrine Phase 3).
// The gaming_mode pattern: this surface is fully built but renders NOTHING while the backend
// gate is hard-false, and the backend preview command refuses independently (defense in depth).
// No send path exists anywhere — see docs/superpowers/specs/2026-06-12-receipts-telemetry-spec.md.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

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

export default function ReceiptsConsent() {
  const [gate, setGate] = useState(false);
  const [preview, setPreview] = useState<ReceiptPayload | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    invoke<boolean>("get_receipts_gate")
      .then((g) => {
        if (alive) setGate(g);
      })
      .catch(() => {
        /* probe failed → stay hidden (fail-dark) */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!gate) return null; // DARK: the gate is hard-false in every shipped build today.

  const inspect = async () => {
    setPreviewErr(null);
    try {
      setPreview(await invoke<ReceiptPayload>("preview_receipt_payload"));
    } catch (e) {
      setPreview(null);
      setPreviewErr(String(e));
    }
  };

  return (
    <section className="set-section" data-testid="receipts-consent">
      <h2 className="set-section-title">Share your receipts (opt-in)</h2>
      <p className="receipts-hint">
        Off by default, anonymous by design. If you opt in, Compy shares only measured outcomes —
        your hardware class and session numbers, never your name, paths, or anything that
        identifies this PC. You can inspect the exact payload below before anything is ever sent.
      </p>
      <div className="set-row">
        <button className="set-action" onClick={inspect}>
          Inspect your receipt
        </button>
      </div>
      {previewErr && <p className="receipts-hint">{previewErr}</p>}
      {preview && <pre className="receipts-preview">{JSON.stringify(preview, null, 2)}</pre>}
    </section>
  );
}
