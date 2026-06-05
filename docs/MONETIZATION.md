# Compy — Monetization (decision doc)

**Status: DECISION NEEDED (2026-06-02).** This frames the model + processor choice so the build is a
fast follow once you pick. **Nothing here is built yet** — picking the model is the checkpoint, because
you can't build licensing infrastructure for a model that isn't chosen (and "free" means no licensing
at all). Honest framing per Compy's identity: **local-only, no account, no telemetry.** That identity
should *shape* the monetization, not get sacrificed for it.

---

## 1. The decision (what I need from you)
1. **Do we charge at all**, and if so **which model** (§2)?
2. If freemium: **what's free vs Pro** (§3)?
3. **Payment processor** (§4)?
4. **Price** (your call; §2 has napkin ranges).

Everything else (the licensing tech) I can build once these are set — see §5.

## 2. Models — fit for a local-only indie gamer utility
| Model | Fits Compy's "no-account/local/no-telemetry" identity? | Pros | Cons | Verdict |
|---|---|---|---|---|
| **Free** | Perfectly | Max adoption, reputation, zero billing surface | $0; monetize later/never | Fine if the goal is portfolio/reach. |
| **One-time purchase** | **Excellent** — pairs with **offline license keys** (no phone-home) | "Own your tool," no sub fatigue, privacy-preserving, simple | No recurring revenue; major versions may need paid upgrades | **Recommended** if charging. |
| **Freemium (free core + one-time Pro unlock)** | **Excellent** | Adoption *and* revenue; Pro = power-user value (e.g. the Advanced Black Book, multi-rig profiles, future F6 benchmark proofs) | Must draw a fair free/Pro line that doesn't feel crippled | **Recommended** sweet spot. |
| **Subscription** | **Poor** — recurring billing wants an account + online validation, which **fights the no-account/local ethos** | Predictable revenue | Sub fatigue for a *utility*; needs server validation = erodes the privacy story; higher refund/chargeback churn | **Avoid** unless there's a genuine ongoing service (there isn't — it's local). |

**Recommendation:** **Freemium with a one-time "Pro" unlock** (or plain one-time purchase). Both preserve
the offline/no-account identity via signed license keys. **Subscription is off-brand** for a local tool.
Napkin price: one-time **$15–30**, or free core + Pro **$10–20 one-time**. (Your call.)

## 3. If freemium — candidate free/Pro split (illustrative, your call)
- **Free (the trust-builder):** hardware detection, Readiness, Monitoring, Sessions, Export, Priorities,
  the safe reversible recommendations, Gaming Mode. *(The core safety value stays free — that's the brand.)*
- **Pro (one-time unlock):** the **Advanced Black Book** (already trust-gated — natural Pro tier),
  multi-rig / saved profiles, future **F6 benchmark proofs**, priority of new advanced content.
- **Principle:** never paywall *safety* (rollback, the core recs). Charge for *depth/power-user* surface.
  This keeps Compy honest and the free tier genuinely useful.

## 4. Payment processor — for a solo indie selling a Windows app globally
| Option | Tax/VAT handled for you? | Notes |
|---|---|---|
| **Paddle** | **Yes (Merchant of Record)** | MoR: handles global sales tax/VAT, compliance, refunds, chargebacks, fraud — huge load off a solo dev. License-key + webhook friendly. **Recommended.** |
| **Lemon Squeezy** | **Yes (MoR)** | Same MoR benefits, indie-friendly UX, built-in license-key API + webhooks. **Recommended (esp. simplest setup).** |
| **Stripe** | **No — you own tax/VAT/compliance** | Most control + lowest fees, but you become responsible for global tax remittance + chargebacks. Heavy for a solo dev. |
| **Microsoft Store** | Store handles it | If distributing via Store; takes a cut + Store constraints; ties to the distribution decision in `PACKAGING_SIGNING_PLAN.md`. |

**Recommendation:** a **Merchant-of-Record (Lemon Squeezy or Paddle)** — it removes the global-tax burden
that otherwise lands on you, and both have first-class license-key issuance + webhooks that drop straight
into the architecture below.

## 5. License architecture (what I build once §1 is decided) — preserves the privacy identity
**Offline, Ed25519-signed license keys — no phone-home, no account.** Reuses the crypto already in the
repo (`ed25519-compact` + the signed-manifest verify pattern in `remote_rules.rs`).
- A license key = a signed token: `{ buyer_id/email_hash, tier, issued_at, (optional expiry/version_max) }`
  + an **Ed25519 signature**. Compy verifies it **offline** against an **embedded public key** — same
  trust model as the rules manifest. No server call to validate → the no-telemetry/local promise holds.
- **Issuance:** the processor's webhook (Lemon Squeezy/Paddle license API, or a tiny signing endpoint)
  signs + delivers the key on purchase. **The private signing key NEVER enters the repo / app / `.env` /
  CI** — same locked rule as the rules key and the (future) code-signing cert.
- **In-app:** an "Enter license / Pro status" surface; Pro features gate on a verified key (like the
  existing flag-gating). Free tier needs no key.
- **Buildable solo once decided:** the **verify** module + tests + the licensing UI (all model-agnostic).
  The **issuance** side needs the chosen processor. None of this mutates Windows → no mutation-QA gate.

## 6. Non-negotiables (whatever model wins)
- **Never paywall safety** (rollback, core recs) — that's the brand.
- **No account / no telemetry / offline validation** — monetization must not break the privacy promise.
- Signing/issuance **private key stays out of the repo** (locked, like Ed25519 rules + code-signing cert).
- Ties to distribution (`PACKAGING_SIGNING_PLAN.md` §4) — Store vs direct changes the processor calculus.

---

**CHECKPOINT (owner):** pick **model** (§2) + **free/Pro split if freemium** (§3) + **processor** (§4) +
**price**. Then I build §5 (offline license verify + UI, model-agnostic) and wire the chosen processor's
issuance. *Recommendation in one line: **freemium, one-time Pro unlock, Lemon Squeezy (MoR), offline
Ed25519 keys** — revenue without betraying the local/no-account identity.*
