# Receipts telemetry — spec for OWNER review (R3 Lane C1; Phase 3 of the Receipts Doctrine)

> **STATUS: DRAFT — NOT AUTHORIZED TO SHIP.** This spec exists so the owner and a future
> security pass have something concrete to judge. Per `docs/RECEIPTS_DOCTRINE.md` §2, telemetry
> is a NEW outbound-network boundary: it ships only after (1) owner sign-off, (2) its own
> security-grade review, (3) the consent UI below verbatim or stricter. Until then
> `receipts_gate()` is HARD-FALSE (test-pinned) and **no network primitive exists in the app** —
> the dark build (Lane C2) wires logic, not ammo, mirroring the Ed25519 remote-rules pattern.

## 1. What it is

Opt-in, anonymous sharing of MEASURED outcomes ("receipts") so Compy can publish aggregate,
true marketing claims ("RX 6600-class rigs measured +X% 1%-lows after these 3 fixes — N=412").
It is the doctrine's data engine. It is NOT: analytics, usage tracking, crash reporting, an
account, or anything default-on.

## 2. Non-negotiable constraints (doctrine §2, restated as requirements)

1. **Default OFF.** A fresh install sends nothing and shows no nag. The toggle lives in
   Settings → Privacy, off until the user flips it.
2. **Consent-first UI.** Flipping the toggle shows what will be sent (the schema below, in plain
   English) BEFORE the first send. No dark patterns; "No thanks" is the visually equal default.
3. **Anonymous by schema, not by promise.** The payload TYPE cannot carry PII: no hostname, no
   username, no paths, no serials, no MACs/HWIDs, no IP logging server-side (Workers config),
   no timestamps finer than the day. Enforced by the payload builder (strips + rejects) and
   pinned by tests (Lane C3).
4. **User-inspectable.** An "inspect your receipt" preview renders the EXACT payload before any
   send, every time. What you see is byte-for-byte what would leave.
5. **Kill-switch.** The toggle off = stops everything immediately; there is no queue that
   drains after consent is revoked. (V1 ships with no retry queue at all — a failed send is
   dropped, never stored.)
6. **No third-party trackers.** The endpoint is Compy's own (Cloudflare Workers free tier per
   the R3 §3 hosting decision). No SDKs, no analytics libraries, ever.

## 3. Payload schema v1 (`ReceiptPayload`, schema_version = 1)

```jsonc
{
  "schema_version": 1,
  "hw_class": {
    "gpu_vendor": "amd",            // vendor token only
    "gpu_model": "Radeon RX 9070 XT", // retail model name = a CLASS (thousands share it), never a serial
    "cpu_family": "Ryzen X3D-class", // the existing family label, never the full brand string
    "ram_gb_bucket": "24-32"        // bucketed, never exact bytes
  },
  "outcome": {
    "kind": "session",              // v1: session summaries only; "fix-delta" is schema v2
    "game": "elden-ring",            // exe basename, extension stripped, path-impossible by construction
    "avg_fps": 141.0,
    "low1_fps_est": 118.0,
    "duration_bucket": "30-60min",  // bucketed
    "active_change_ids": ["game-dvr-off", "hags"] // catalog ids only — never values/paths
  }
}
```

Explicitly ABSENT, forever (v1 contract): hostname, username, any filesystem path, drive
serials, MAC/HWID, IP (server logs disabled), monitor EDIDs, exact RAM/clock values, free-text.

## 4. Retention stance (server side, for the future security pass)

Aggregates only. Raw receipts are folded into aggregate buckets and the raws deleted on a short
fixed window (≤30 days, target: immediate fold). No per-device identity exists to join on —
deliberately: dedup/abuse-control is rate-limit-by-IP at the edge WITHOUT logging the IP, or
accepted as noise (the benchmark-integration plan's spoofing analysis applies; aggregates get
sanity-banded before any marketing use).

## 5. What flips the gate (in order)

1. Owner reads this spec and signs off (or edits it).
2. The Workers endpoint exists + its own security review (input validation, no logging, CORS).
3. The consent UI + payload builder pass a dedicated /security audit on the real wire path.
4. `receipts_gate()` flips in its own commit with the QA evidence attached.

## 6. KPI (doctrine: ONE metric per phase)

Opt-in rate among active users. If honest, consent-first telemetry can't clear a meaningful
opt-in bar, the doctrine's data engine gets rethought rather than the consent bar lowered.
