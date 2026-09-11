# EULA + PRIVACY REVIEW — **NOT LEGAL ADVICE** — 2026-08-23

**⚠️ I am not a lawyer and this is not legal advice.** This is an engineering-grade check of the
documents against the code, plus research. **Anything touching liability for damage to a customer's
computer — EULA §4, §8, §9 and the `LICENSE` liability sentence — must be reviewed by a real lawyer
before money changes hands or the product launches publicly.** That clause decides whether a bricked
PC is a refund or a lawsuit.

---

## VERDICT

| Document | Verdict |
|---|---|
| `docs/PRIVACY.md` (DRAFT v0.4) | **Needs specific fixes** — four real data flows are undisclosed. The fixes are **factual, not legal**; they can be written today. |
| `docs/EULA.md` (DRAFT v0.3) | **Needs a lawyer — for §9 only.** Everything else is specific fixes. |
| `LICENSE` | **One fix**, then fit. It contradicts the EULA. |

## ✅ THE GOOD NEWS, AND IT IS LOAD-BEARING

**The "no telemetry" claim is TRUE, and it was verified in code, not taken on trust.** A search of
all `src-tauri/src` for `reqwest`, `ureq`, `http::`, `TcpStream`, `Client::new` returns **zero HTTP
client code in the Rust backend.** `remote_rules.rs:395-397` is a `// Future:` comment, not a call.
The webview CSP is locked to `connect-src 'self' ipc:` (`tauri.conf.json:47`). **The only outbound
connection in the product is the Tauri updater** (`tauri.conf.json:74-76`), pointing at exactly the
URL `PRIVACY.md` names.

Also verified real: the support-evidence redaction masks (`support_evidence.rs:64-93`), the
400-entry/250 KiB cap (`:48-58`), offline licensing (`license.rs:32`, `:42`), and that
`FeedbackExport.tsx:88-106` writes a local file and opens the user's own mail client — **nothing is
ever sent automatically.**

**No claim in the policy was found that the code fails to support.** That direction is clean, which
is unusual and worth saying out loud.

## ⛔ WHAT THE CODE DOES THAT THE POLICY DOES NOT DISCLOSE

This is the dangerous direction — undisclosed collection is what gets a product flagged.

1. **`sessions.json` is absent from the policy entirely.** `sessions.rs:12`, `:19` persist it to
   `compy_data_dir()`; `:47-80` retains **game executable names** (`process_name`), timestamps,
   durations, rig fingerprint and stutter events. **A persistent record of which games someone played
   and when** is exactly what a reviewer flags.
2. **Full running-process enumeration is undisclosed — the sharpest mismatch.**
   `monitoring.rs:1126-1152`: while capturing, **every second**, Compy enumerates **all** running
   process names via `sysinfo`, diffs them, and writes newly-started third-party application names
   into stutter events as `"{name} starting"`. These persist (`sessions.rs:80`) and ride into
   exports. The policy stops at *"GPU/CPU usage, temperatures, RAM, and FPS/frametime for a running
   game."* **The code reads more than the policy admits.**
3. **`hw_fingerprint` is undisclosed** — and disclosing it is a *strength*. Defined at
   `hardware.rs:2339-2365`: the first 8 bytes of a SHA-256 over `"{gpu}|{gpu_driver}|{ram_gb}GB|
   {display}"`. Stamped onto ledger entries (`history.rs:275`, compared at `:262`) and sessions
   (`monitoring.rs:1159`), both local. **It is NOT a machine ID** — no serial, no MAC, no Windows
   UUID, no disk ID; thousands of identical rigs produce the same value, and it never leaves the
   disk. **Say all of that.**
4. **`license.key` is undisclosed.** `license.rs:181` writes it into `compy_data_dir()`; the payload
   includes **`email_hash`**, a hash of the buyer's email (`license.rs:57`).
5. **⚠️ THE FEEDBACK MAILBOX IS UNDISCLOSED, AND IT IS THE ONE REAL PERSONAL-DATA FLOW.**
   **`FeedbackExport.tsx:21` hardcodes `INTAKE_EMAIL = "christian.mcniel@gmail.com"`.** Nothing
   auto-sends — but a user who clicks Email hands over their address plus a hardware/session report.
   **The policy's claim that the waitlist is the only personal data ever collected is now false.**
   **It is also a personal Gmail address shipping inside a consumer product.**
6. **Hostname reaches the Markdown and Discord outputs.** `export.rs:645-648` strips `hostname` from
   the JSON bundle **after** the Markdown and Discord blocks were already built from the full value.
   **Hostnames commonly contain real names.** The policy never mentions the computer name.
7. **Affiliate commissions are undisclosed in both documents.** `priorities.rs:82` says *"If you buy
   through Compy links we may earn a commission."* Disclosed in-product (good, and FTC-relevant),
   absent from the EULA and policy.
8. **Minor:** the update check resolves `github.com` → `objects.githubusercontent.com`. Name both.

**Document vs document:** `LICENSE` says *"In no event shall the copyright holder be liable…"* —
**unqualified, with no "to the maximum extent permitted by law" savings clause**, unlike EULA §9. An
unqualified total exclusion against a consumer is the version courts most often strike, **and it
contradicts your own EULA.**

## 🚨 BLOCKERS

- **EULA §12 carries an unfilled `[STATE]` blank.** An empty venue clause is unenforceable and
  advertises that nobody reviewed the document.
- **Both documents are labelled DRAFT and are now linked from a public download page.** A DRAFT
  banner is an admission the terms are not final, which invites the argument that **no contract was
  formed.** Version them (`v1.0` + effective date) or do not ship them.
- **EULA §9 does not cap DIRECT damages.** It excludes indirect/consequential/punitive but never caps
  direct liability, typically to the purchase price. **For software that edits registry keys,
  services and power plans, direct damage to the machine IS the whole exposure. This is the single
  most load-bearing omission in either document. Lawyer.**
- **PRIVACY items 1, 2, 4 and 5 above.**
- **No refund policy anywhere** — required by card networks, and by Paddle if used.
- **No legal-notice address.** GitHub issues and a waitlist reply are not a service address.
- **The EULA has no purchase terms at all.** §2 grants a licence but says nothing about payment,
  licence keys, or what a paid tier buys — **it was written before the paid tier existed.**

## 🔧 SHOULD-FIX

- **EULA §8** — add the consumer savings sentence §9 already has; implied warranties are
  non-disclaimable in several states.
- **Refunds / EU-UK.** EU/UK consumers get a **14-day withdrawal right** on digital downloads unless
  they expressly consent to immediate delivery and acknowledge losing it at checkout. **A
  merchant-of-record like Paddle becomes seller of record and handles refunds, VAT and that consent
  flow — that genuinely shifts the burden. It does NOT shift product liability for damaging a PC.
  That stays yours.**
- **Licence grant scope.** §2 says *"PCs you own or control"* — per-user, unlimited devices,
  non-transferable — and the key has **no device binding** (`license.rs:53-66` carries only
  `email_hash`/`tier`/`issued_at`/`expires_at`). Consistent, but state a device count. **This ties
  directly to the pricing recommendation of 3 PCs per licence.**
- **GDPR/CCPA — be precise.** The app processes nothing off-device, so it makes him no controller.
  **Three touchpoints do:** the waitlist email + hashed IP in Cloudflare D1 (disclosed), the IP
  GitHub sees on the update check (disclosed), and **the feedback email + report to his Gmail
  (undisclosed).** GDPR has no revenue threshold — if EU residents join the waitlist it applies.
  **CCPA/CPRA almost certainly does NOT apply** (none of the $25M / 100k-consumer / 50%-data-revenue
  thresholds are met).
- **No website Terms of Service** — the site collects emails and has no terms page.
- **Age/eligibility clause** — absent, and it backs the "not directed at children" claim.
- **Arbitration — currently absent, and that is the RIGHT call for a solo dev**; mass-arbitration
  filing fees can exceed the claims. The exclusive-venue clause in §12 is the sane choice. **Do not
  add arbitration without counsel.**
- **Beta vs paid.** §3 says pre-release, do not rely on it. **Charging money while disclaiming
  reliability weakens both the sale and the disclaimer.** Reconcile before launch.
- **Export controls / sanctions** — absent; a standard one-liner.

## 🟢 NICE-TO-HAVE

Third-party OSS attribution (the Rust dependencies' MIT/Apache terms require it) · severability,
entire-agreement, assignment and termination clauses, all absent from the EULA · add
`objects.githubusercontent.com` to the network section. **DMCA agent: not needed** — no user content
is hosted.

## 💬 "I don't understand the point of that stuff other than that it's required"

**They are not paperwork. They are the two sentences a judge reads if a customer says Compy broke
their PC.**

The EULA is the only place to say, in advance and in writing, **what was promised and what was
not** — that rollback is best-effort, that the advanced tweaks are the user's own hands on the wheel,
and that the most anyone can recover is what they paid. Without that, the default rules fill the gap,
and the defaults were not written with a solo developer in mind: implied warranties attach
automatically, and a customer whose machine will not boot can argue for the cost of the machine, the
data, and the time. **The EULA is the difference between a $29 refund and an uncapped claim.** That
is why the liability cap is the one clause to send to a lawyer even if every other item here is
skipped.

The privacy policy does the opposite job: **it is a promise that has to be kept.** Its value is not
that it is required — it is that this one is a **genuine competitive asset.** Compy really does keep
everything on the machine, and in a category full of scareware that is rare enough to be worth
saying precisely. But it only works if it is exact. **A policy describing behaviour the software does
not have is worse than none**, because it converts an engineering fact into a false statement — and
in the US a false privacy claim is an FTC deception matter, not a contract dispute. **Right now the
code is MORE private than most competitors and SLIGHTLY LESS private than its own policy says**: it
reads running process names and keeps a game history the policy never mentions. **Close that gap and
the policy becomes provable — and advertisable.**

---

**Sources:** EUR-Lex (right of withdrawal) · EU withdrawal rights for digital goods · Paddle
merchant-of-record model and refund policy · MoFo on FTC scrutiny of the MoR model · EULA
requirements for software companies · UCC §2-316 conspicuousness · limitation-of-liability caps and
carve-outs · desk read of `sentinel` @ `b6727dfc`.
