# MONEY & DISTRIBUTION REPLAN — 2026-08-23

**Why this exists:** the owner's finances are volatile and he cannot sustain recurring costs. He
asked for a full rethink of monetization and marketing — specifically **how Compy acquires customers
without his money and without his personal influence** — and to stop being nagged about the
website-gated tasks, which are gated only by his finances.

**Standing outcome: nothing in Compy's plan requires recurring spend right now.** The domain is
parked and its free path is real. **The code-signing gate's "free path" turned out to be a mirage —
see the corrected #205 section below — but signing is optional and buys nothing today**, so the
zero-spend position holds either way.

---

## 🅿️ THE DOMAIN IS PARKED — do not raise it again unprompted

`compy.gg` is **not registered** (authoritative `.gg` WHOIS, port 43 → `NOT FOUND`). It costs
**~$50/yr**. The zero-budget law already made it the **first** sanctioned spend, triggered by
*"waitlist proves demand"* — **and demand has never been measured**, so the trigger has not fired.

The site runs free on Cloudflare Pages at **`compy-bd6.pages.dev`**. Nothing about launching,
distributing or getting paid needs a custom domain. **Parked indefinitely by owner instruction
2026-08-23.** Issue **#201** holds the detail.

**Do not use RDAP for `.gg`** — IANA lists no RDAP service; it 404s for registered domains too.
Port-43 WHOIS is the only usable registry vantage.

## ⛔ CORRECTED 2026-08-23 — CODE SIGNING **IS** A PAID BLOCKER. #205 IS A **NO-GO ON MSIX**.

**Full scope with sources: `claude/MSIX_STORE_SCOPE_2026-08-23.md`.**

**This section previously said the free signing was Compy's for the taking. That was wrong**, and the
error was not in the facts about the Store — it was in never asking whether Compy could ship the
format the free signing applies to. **It cannot.**

- **The Store rejects apps that need elevation.** Microsoft, verbatim: *"If you plan on publishing
  your app to the Microsoft Store, **apps that require elevation for any part of their functionality
  won't be accepted into the Store**."* Compy elevates for HKLM writes, services, scheduled tasks,
  preload removal and ~60 `powercfg` sites (`actions.rs:918`, `:1036`, `:1105`, `main.rs:12-18`).
- The only escape, the **`allowElevation` restricted capability**, is documented for *"Microsoft
  partners or enterprise organizations"*, needs pre-approval by email to `reportapp@microsoft.com`,
  and is *"subject to approval under strict criteria."* A solo publisher is not the named audience.
- **The free signing is MSIX-only, confirmed both directions.** For the unpackaged path: *"The Store
  does **not** re-sign MSI or EXE installers… you must Authenticode-sign it yourself."*
- **Compy's own resolver also kills a packaged Compy.** `data_root.rs:346` returns `Redirected` for
  any path under `\appdata\local\packages\` — which is exactly where an MSIX Compy's `%APPDATA%`
  resolves — so `MutationRoot::from_decision` (`:241-246`) returns `None` and **every apply, rollback
  and receipt write dies at `history.rs:450`.**

**🔁 AND THE RISK WE WERE WATCHING WAS THE WRONG ONE.** Policy **10.2.8** (v7.19, effective
2025-10-14) requires *"supported methods"* **and** *"user consent"* — it does **not** ban changing
Windows settings. Compy uses documented APIs and its receipts/rollback design answers the consent
half well. **10.2.8 was survivable. The elevation rule is not a judgement call — it is a stated
exclusion.** Precedent search found **no** public 10.2.8 rejection *or* approval of a tweaking
utility; Process Lasso, O&O ShutUp10, FanControl and CCleaner have **no Store listing at all.**

**What survives:** free individual registration is real ($19 waived since 2025-09-10) and costs
nothing to hold. The Store's **unpackaged EXE path (10.2.9)** stays open — but it demands a bought
certificate anyway, plus *"not a downloader stub"*, and **`tauri.conf.json` has no `bundle.windows`
block (`:56-70`)** so WebView2 currently defaults to the download bootstrapper.

**💵 THE REAL PRICE OF SIGNING, VERIFIED.** **Azure Artifact Signing** (renamed from Trusted Signing)
— **$9.99/mo ≈ $119.88/yr**, 5,000 signatures, no hardware token, and **individuals are eligible if
located in the US or Canada.** Certum's €49 open-source cert is **revocable if used commercially**;
SignPath Foundation is free but requires a fully OSI-licensed project — **both closed to Compy.**
SSL.com ≈ $369/yr, Sectigo ≈ $220/yr + token. Hardware/HSM is now mandatory for every code-signing
certificate (CA/B CS-BR v3.11.0, effective 2026-06-16).

**⚠️ AND A CERTIFICATE DOES NOT SWITCH SMARTSCREEN OFF.** Reputation is *file-hash* + *publisher
identity*; *"reputation cannot transfer from previous versions unless both were signed using the same
publisher identity"*, and build-up needs *"several weeks and hundreds of clean installs from a wide
audience."* **Compy has no download volume, so buying the certificate today buys nothing today.**

**⛔ NEW REJECTION — EV CERTIFICATES BUY NOTHING.** Microsoft's own docs: *"EV certificates no longer
bypass SmartScreen… Paying a premium for EV solely to avoid SmartScreen warnings is no longer
justified."* The doctrine already rejected EV on cost; this is a second, independent reason.
**Do not re-propose without naming this.**

**Why unsigned is still worse than it looks:** reputation **resets to zero on every release** unless
builds share a publisher identity, there is no mechanism to request review, and Windows 11 Smart App
Control may block unsigned binaries outright. **A solo dev shipping often is permanently at zero.**
*(No quantified conversion-loss figure exists — treat any percentage as invented.)*

**MSIX effort, recorded so nobody re-scopes it:** Tauri v2 has **no MSIX bundler** (tauri#8548
**closed as not planned**); hand-rolled `makeappx`/`makepri`/`signtool` would be **3–6 days** to first
launch, **10–25 days** to submittable *and materially at risk of never passing*, **0.5–1.5 days per
release** forever after. The updater is structurally dead inside a read-only package. tauri#14935 is
open: a *stock* Tauri v2 project fails the certification kit on blocked `CreateProcessW` /
`ShellExecuteW` / `cmd.exe` references.

## 📦 FOUR FREE CHANNELS, NONE IN USE — issue #206

| Channel | Compy eligible? | Requirement |
|---|---|---|
| **Public GitHub releases repo** | **Already half-exists** — `Pootytxng/compy-releases` is public but bare | FanControl's equivalent has **20,500 stars on a repo with no source in it.** Biggest free lever. |
| **WinGet** | **Yes** — no OSS, no signing requirement | Silent install (`/S` ✓), direct HTTPS publisher URL (✓), **must pass multi-engine AV** ← the real risk for an optimizer (PUA heuristics) |
| **Chocolatey** | **Yes** — commercial explicitly permitted | `#trial`/`#license` tags + disclosure in description; days-to-weeks moderation |
| **Scoop** | `extras` bucket only | Main bucket bans GUI apps and needs 500★/150 forks |

**#206 is now the unblocked half of the distribution question** — none of these requires a
certificate, and discoverability is worth more than a signature while download volume is zero.

**Directories are low-yield:** Softpedia (free, ≤30 days, not guaranteed), MajorGeeks (no published
requirements at all), AlternativeTo (user-created entries — the play is a *user* adding it), Product
Hunt (**a non-featured launch is worth 1–15 signups**).

## 📉 HOW THIS CATEGORY ACTUALLY GROWS — the most useful finding

**Thirteen comparable Windows utilities were checked. Eleven have NO documented breakout moment** —
no founder retrospective, no launch spike, no traffic data. **The pattern is accretion over years,
not a launch.** Planning around "find the channel that breaks it out" may be planning around
something that mostly does not happen here.

**FanControl is the one documented case** and the closest analogue that exists (closed source, solo
dev, Windows, PC gamers): developer posts in a forum where his tool answers a **live, named problem**
(SpeedFan had been abandoned) → a **YouTuber** later makes a setup tutorial, which is what users
credit → **press arrives six years later.** He had no audience either.

**Community rules that matter:**
- **r/pcmasterrace: 9:1 ratio** — nine genuine contributions per self-promotion — **BUT moderators
  "can pre-approve them in special cases."** That is a sanctioned door costing one message.
- **Linus Tech Tips forum:** general self-promo banned; **recommending your tool in reply to
  someone's problem is permitted.**
- **Guru3D** is structurally the strongest channel (official download partner for DDU, developer-run
  threads) but its rules could not be read.

**The mechanic:** not "post my tool" — **answer specific problems until the tool is the answer.** A
receipts-and-rollback product is unusually good at this; a real before/after receipt *is* the useful
comment.

**⚠️ REDDIT WAS UNREACHABLE from the research sandbox.** All subreddit rules above came from PCMR's
own off-Reddit site or third-party scrapers, one of which found **24 of 49 subreddits stricter than
their reputation implied.** **Read every subreddit's rules before posting. A ban is worse than
silence.**

## 💵 THE PRICE SHAPE IS UNDER CHALLENGE — issue #204

The band ($4.99/mo · $39/yr · $89 lifetime, decided 2026-08-22) was set without this comparison:

| | Compy | **Process Lasso** (nearest paid analogue) | Hypertune |
|---|---|---|---|
| Monthly | $4.99 | $4.95 | $9.99 |
| Annual | **$39** | $24.95 | $69.99 |
| Lifetime | **$89** | **$39.95** | none |

**Compy's annual is priced at the comparable's lifetime; its lifetime is 2.2× theirs.** Bitsum steers
buyers to lifetime as *"the best value."*

**Against the monthly tier specifically:** it loses **12–20%** to flat per-transaction fees (Paddle
flags sub-$10 as custom pricing) · it re-creates the auto-renew trap the doctrine's own lifetime
rationale calls *"the category's loudest complaint"* · Hypertune already owns the subscription slot
**and already claims reversibility** · it cannot be operated cheaply by one person · **it cannot be
measured without telemetry.**

The one **demonstrated** large-scale gamer-utility success is **Wallpaper Engine — $4.99 one-time on
Steam**, 20–50M estimated owners. The category norm for credible tools is **free with donations**.

**⚠️ HONEST LIMIT: no hard dataset shows subscriptions fail for Windows utilities.** The case is
circumstantial but strong. **Anyone quoting a churn percentage for this category is inventing it.**

**Free to decide, free to reverse:** `MONETIZATION.md` §5 records the licence format as
**model-agnostic** — `expires_at: None` = lifetime, `Some(..)` = subscription. **Changing the model
needs no code change** until a processor is wired.

## ⚖️ PAYMENTS — all zero monthly fee

**Paddle** (5% + 50¢, merchant-of-record) remains the right route: MoR means international VAT/GST
and US sales tax are Paddle's legal problem, not a solo owner's. **⚠️ Lemon Squeezy is being absorbed
into Stripe — do not build on it new.** Stripe Managed Payments is the successor at ~6.4% + 30¢.
Plain Stripe is cheaper (2.9% + 30¢) but leaves the owner personally liable for international tax
compliance — a bad trade here.

**The $0 manual path already exists and is sanctioned:** `scripts/license-tool.mjs` mints an
Ed25519-signed key offline, `license.rs` verifies it offline, and the owner can sell a licence by
hand before any processor exists.

## 🔴 WHAT THE REPLAN FOUND WRONG IN THE DOCS

Landed in `lane/copy-truth-2026-08-23` (commit `d0e3ffc6`) — see the branch and #204–#207:
- `COMPY_OVERVIEW.md` carried the **dead price band in two places**, one under a heading calling the
  price *"still genuinely open."* Fixed.
- `MONETIZATION_PLAN.md` gated Layer 3 on *"worth $25/yr"* — the dead number as a live criterion. Fixed.
- `OWNER_ACTION_CHECKLIST.md` kept a **fixed bug open as live** (the dead GitHub link in the legal
  docs — actually repaired weeks ago). It caused a real near-miss this session: the "defect" was
  re-reported from that line and nearly re-fixed. Corrected.
- **`RECEIPTS_DOCTRINE.md` CONTRADICTS ITSELF on the receipts-telemetry default** — Phase 3 says
  *"opt-in… default OFF"*, the amended line says *"on by default once armed."* **The law disagrees
  with itself on a privacy promise. Filed as #207; nobody should quote either as settled.**
- **NOT touched:** the eight *"free forever"* lines in `site-app/` marketing copy. A research pass
  called them a decree violation; the decree is genuinely ambiguous (the 2026-07-15 owner-approved
  fix was *to* "core stays free forever" language) and **marketing copy is the owner's territory.**

## 🛠️ NEW GUARD — `scripts/doc-truth-guard.test.mjs`

Pins the class: **a decision that supersedes wording must not leave the old wording alive in a
document whose job is to say what is true now.** Scope is deliberately just `COMPY_OVERVIEW.md` and
`PRODUCT.md`.

**Two removals from it are the durable lesson.** Sweeping every `.md` produced **nine hits, all
honest history** — a doc explaining why a price died is not asserting it. And the telemetry entry
**flagged the doctrine itself**, disproving the premise it was built on. **A guard that encodes one
side of an unsettled question is worse than no guard.**

## ▶ WHAT NEEDS THE OWNER

1. **#204** — does the price shape change? (Free to decide, free to reverse.)
2. **#205** — **MSIX is a NO-GO and needs no decision.** What is left is one money question:
   **buy Azure Artifact Signing at $119.88/yr, or not?** **Recommendation: not yet** — it buys
   nothing until there is download volume for reputation to accrue against.
3. **#206** — go/no-go on making Compy publicly discoverable (WinGet, releases repo). **This is now
   the unblocked one, and it costs nothing.**
4. **#207** — which line of the doctrine is the law?

**Only #205's residue spends money, and the recommendation there is to wait. Nothing above has been
implemented.**
