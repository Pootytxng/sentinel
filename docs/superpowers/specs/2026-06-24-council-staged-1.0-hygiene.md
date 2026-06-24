# Staged pre-announce hygiene bundle — Council-directed, OWNER-APPROVAL-GATED

**Status: PROPOSED DRAFTS — nothing applied, announced, or spent.** Produced 2026-06-24 by CC as the
Council's Executor-approved next move (full three-stage five-lens council on the road-to-1.0,
run `wf_872cee5b-700`). Every item below is staged for owner sign-off. The legal text is a **draft,
not legal advice** — owner + a professional review before public distribution. Apply on the owner's
word, one item at a time.

> **Why this exists (council ruling, one line):** the road to 1.0 is a *decide-and-measure* problem,
> not a build backlog — monetization is already built, the drafts are current, and the true bottleneck
> is a live dark site no human has been told about. Two cheap fixes are MANDATORY before any announce
> (a real deletion contact + re-framing the Privacy "collects nothing" absolute), and the herd's
> "let people share the installer" instinct is OVERRULED (free the link, keep the binary locked).

---

## A. EULA — license: free the LINK, lock the binary (proposed §2 addition)

Keep proprietary / all-rights-reserved. Do **not** add "you may share the installer" (licensing
redistribution of an unsigned admin binary is the malware-fork's provenance-stripping permission slip,
and §2's grant is personal/non-transferable, so it would legalize the *copy* but leave the friend who
*runs* it unlicensed). Instead add a **link carve-out + downstream use-grant**:

> **2a. Sharing.** You may freely tell others about Compy and direct them to the official download
> (compy.gg or the owner's official channel). The license granted in this section extends to any
> individual who installs the **official, unmodified build obtained from the official source.** You may
> not modify, repackage, rebrand, resell, rent, sublicense, rehost, bundle, or redistribute the
> installer or the Software itself — **share the official link, not the file.**

Effect: licenses the word-of-mouth virality the doctrine needs, keeps the moat (no tampered builds),
and concentrates SmartScreen/signing reputation on one canonical download.

## B. EULA §12 — fill the venue blank  ·  OWNER-ONLY (one word)

`[STATE — owner to insert state of residence]` → **your state of residence.** The rest of §12
(governing law = United States, exclusive jurisdiction) is ready. I cannot fill this — it's yours.

## C. Real deletion contact — replace GitHub-issues-only  ·  proposed Privacy + EULA edit

A non-technical gamer cannot "open a GitHub issue" to delete their waitlist email — it fails the
GDPR/CAN-SPAM "reasonable means" bar, and the waitlist is **already collecting email + a hashed IP**
(personal data under GDPR) today. Proposed contact line for Privacy "Contact & governing law" and
EULA §12:

> To delete your waitlist email at any time, email **privacy@compy.gg** (or reply to the launch email
> you receive). We confirm and remove it.

> ⚠️ **Owner dependency:** this address must be live (a real inbox or forward to you) **before** the
> site is announced. compy.gg isn't attached yet — until it is, use a real address you control. This is
> a $0 fix but it gates the announce.

## D. Privacy — re-frame the "collects nothing" absolute  ·  proposed edit to the "short version"

The body still states a permanent absolute ("no telemetry … no network connections to operate … never
sent anywhere") while the entire money stack is built on a future opt-in telemetry phase. True *today*,
but it's a documented promise that becomes the doctrine's own "they said no telemetry" screenshot.
Re-anchor it to the **architecture**, not an eternal absolute (the existing doctrine pointer at line 8
stays; this softens the headline to match it):

> **The Compy app is built local-first.** It has no accounts, no ad trackers, no analytics, and the
> installed app sends nothing off your PC to operate — you can verify this (it makes no network
> requests beyond opening a link you click). It collects nothing about you unless you explicitly turn on
> a clearly-described, **default-OFF** feature; any such feature will be announced in an updated policy
> **before** it ships and will never be on by default. The only data we ever collect today is the
> website waitlist (your email + a hashed IP), and only if you choose to give it.

Apply the same softening to EULA §10 ("collects no personal data" → "the installed app runs locally and
sends nothing off your PC to operate; any future opt-in data feature is default-off and announced
first").

## E. FTC affiliate-disclosure stub  ·  proposed (add to Privacy + the verdict UI later)

Not live yet, but stub it so the "we prove everything" brand never ships an undisclosed affiliate link
(an FTC + PR risk). The export artifact already carries a footer; the policy + the in-app verdict must
too when Phase-3 ships:

> **Affiliate links (when present).** Some upgrade recommendations may include affiliate links. If Compy
> earns a commission when you buy through one, that is **clearly disclosed** at the recommendation and
> on the website ("we may earn a commission"). Affiliate relationships never change which recommendation
> Compy makes — recommendations are driven by your **measured results**, not by commissions.

## F. Discord seed-announce — DRAFT copy (do NOT send; gated on the checklist below)

> Been heads-down building **Compy** — a free, rollback-first PC optimizer that reads *your actual rig*
> and only suggests safe, reversible tweaks tailored to it (no snake-oil, no copy-paste "best settings").
> Every change is undoable, and it proves what it measures instead of promising magic. Early look +
> waitlist 👉 [link]. Would genuinely love brutal feedback from people who actually game. 🛡️🎮

(Owner owns the send + the brand voice; this is a starting point. Link = compy.gg once attached, else
the pages.dev URL.)

---

## Pre-announce checklist (Council: ALL of these gate any cold-stranger announce)

- [ ] **(C)** Real deletion `mailto:` live (forwarding configured).
- [ ] **(D)** Privacy "collects nothing" absolute re-framed.
- [ ] **Published SHA-256** of the installer + a friendly **"why your AV/SmartScreen may flag this, and
      how to verify it's the real file"** page (AV false-positive has already happened once).
- [ ] **(B)** EULA §12 [STATE] filled.
- [ ] **Real human/entity or DBA name** somewhere on a product that edits the OS — a pseudonym-only
      ("Pootytxng") product reads as fly-by-night at the trust moment (fine for dark beta, not for a
      buy button).
- [ ] **Brand-name monitoring** + a canned honest response ready (the "one Reddit thread" kill-condition
      is currently operationally undefended).

## What the Council explicitly de-prioritized / corrected
- **Do NOT buy a ~$400 EV cert** — doctrine routes signing through **Azure Trusted Signing (~$10/mo)**,
  and even that waits for a measured demand signal (zero-budget law).
- **Code-signing wiring, distribution choice, buy-flow copy** = motion without leverage *today*
  (downstream of a demand signal). Don't wire a faucet with no water.
- **Monetization** is a 4-line owner decision (price model · split · processor), not a sprint —
  `license.rs`/LicensePanel/license-tool already exist (2026-06-14). Doctrine sequences **affiliate
  first** (no processor/entity needed).
- **NVIDIA sensor validation** is a *recruiting requirement* for the closed beta (get ≥2 NVIDIA rigs in
  the 10–20), not a parkable peer — don't let the beta fill with AMD friends and silently re-cap reach.
- **Gaming Mode F1**: do the 10-min reboot QA (free, closes the gate decision), but ship it with honest
  **detect-and-tell**, never a silent re-apply loop — a single AMD-rig pass does NOT generalize
  (Adrenalin reverts Game Mode every login).

## The one measurement nobody has taken
The dark site is live and unannounced; the doctrine's own Phase-2 KPI ("waitlist signups in N days") has
**zero data**. Every owner spend below (cert, processor, lawyer) is being weighed against no demand
signal. **Measure first.**
