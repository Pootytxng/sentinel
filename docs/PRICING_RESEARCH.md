# Pricing research — what Compy can defend charging, and why

> **Owner ask, 2026-08-22:** *"do some research to truly figure out the monetary value and
> justification … so it's to be determined as of now."* This doc is that research.
>
> **Status: the owner ruled on §5 the same day — see §7.** The band is $4.99/mo · $39/yr · $89
> lifetime. The research below is left intact as the reasoning behind it.
>
> **This doc does not set a price by itself.** Price presentation is owner/brand/money territory
> (`CLAUDE.md` → taste decree; `OWNER_ACTION_CHECKLIST.md` §B6, §C). It gathers the evidence,
> names a recommendation, and states plainly what is still unmeasured.
>
> **It does not block PR #193.** That PR removes the word *free* from `site/llms.txt` and names
> no price at all. The two are independent.

## 1. What we currently assert, and on what basis

`RECEIPTS_DOCTRINE.md:81` states Compy Pro at **$3–4/mo or ~$25/yr**, and B2B at **$10–30/seat/mo**.
Neither number has a source behind it in this repo. They were written as a plausible band, not
derived from comparables or from demand. Treat both as **unevidenced placeholders** until this doc's
recommendation is accepted or replaced.

## 2. What comparable Windows tools actually charge (Aug 2026 list prices)

| Product | What it is | List price | Note |
|---|---|---|---|
| **HWiNFO Pro (Personal)** | Read-only sensor readout, no mutation, no support burden | **$29/yr** | The spartan floor of the category |
| **Process Lasso Pro** | Enthusiast/gamer CPU + process tuner, trusted, ~20 yrs old | **$27** 1 PC · **$99.95 lifetime** | The closest cultural comparable to Compy |
| **CCleaner Professional** | Cleaner + optimizer + driver updater | **$29.95–$44.95/yr** (1 device) | Pro Plus $64.95/yr, 3 devices |
| **GlassWire** | Local network monitor, free tier + paid | **from $35.88/yr** (range $39–99) | Free-tier-plus-paid, same shape as Compy |
| **Restoro** | "PC repair" | **$39.95/yr** (1 PC) · $59.95 (3) | Category's reputation problem, see §4 |
| **Fortect** | "PC repair" | **~$31–34 first yr → ~$69.95/yr renewal** | The renewal trap the audience resents |

**Every single comparable charges more than $25/yr.** The doctrine's band sits *below the floor of
the entire category*, including below a tool (HWiNFO) that mutates nothing and answers no support
tickets. That is money left on the table and, worse, a signal — under-pricing reads as hobby project.

## 3. The real value anchor is not software, it is the trip to the shop

Compy's stated identity is *"the first place a user goes after a crash, freeze, or slowdown"* — i.e.
the thing that happens **instead of** taking the PC somewhere. So the honest anchor is what that trip
costs:

- **Diagnostic fee alone: $45–$95** typical when a shop charges one; **$50–$150** for home users.
- Many shops advertise **$0 diagnosis** — but the free diagnosis is a lead-in to the paid repair, and
  it still costs the user the drive, the wait, and the machine.

**One year of Compy should cost less than one diagnostic visit.** That is a sentence a non-technical
gamer can check for himself, which is exactly the kind of claim this project is allowed to make.

## 4. The category's reputation is the constraint, and also the opening

The "PC optimizer / PC repair" category is actively distrusted: documented complaints of charging
more than advertised, of causing the errors they claim to fix, and of renewal prices roughly double
the advertised first year (Fortect: ~$33 → ~$70). Reviewers routinely note that the "junk" these
tools find is temp files and the recycle bin.

Two consequences, and they pull in opposite directions:

- **Pricing at the scam tier's number invites the scam tier's suspicion.** $39.95/yr with an
  auto-renew is *literally Restoro's price and structure*.
- **Pricing far under it does not buy trust either** — it buys "why is this free, what's the catch."

The escape is not the number, it is **the structure and the proof**. Compy is the only product in the
table that can show a receipt for every change and undo it. Nobody in the scam tier can copy rollback
+ receipts, because both require actually doing the work.

## 5. Recommendation

**Anchor Compy Pro at $39/yr (≈$4.99/mo), and sell a $89 one-time lifetime license alongside it.**

Why this, specifically:

1. **$39/yr sits with the trusted tools** (GlassWire $35.88, CCleaner $29.95–44.95) and **under the
   renewal traps** ($69.95). It is defensible on a comparison table without an asterisk.
2. **It is under one diagnostic visit** ($45–95). That is the whole pitch in one line.
3. **The lifetime SKU is the trust move.** The category's single loudest complaint is the
   auto-renewing subscription. Offering a permanent alternative is a claim the scam tier structurally
   cannot match — and **Process Lasso proves $99.95 lifetime sells to this exact audience.** $89
   undercuts it while staying a real number.
4. **The monthly stays cheap enough to be an impulse** for the "my PC just crashed, help" moment,
   which is the actual acquisition trigger.

**Raise the doctrine's band from $3–4/mo · $25/yr to $4.99/mo · $39/yr, and add the $89 lifetime.**

B2B: **the $10–30/seat/mo band has no evidence behind it and none was gathered here.** Do not treat
it as researched. It needs its own pass, and it needs at least one real repair-shop conversation.

## 6. What this research cannot tell us

Stated plainly, because the honest-measurement law applies to money claims too:

- **This is comparable-based pricing, not demand-based.** Zero Compy users have been asked to pay
  anything. Nobody has clicked a price.
- **The waitlist is the instrument we already own to fix that** — it can carry a price and measure
  who still signs up. That is a $0 experiment and it is the correct next step before any number is
  committed to.
- **Nothing here changes what Pro must contain.** A price is only defensible once there is enough
  shipped Pro value to be worth it (`MONETIZATION_PLAN.md` Layer 3, gate ③).

## 7. Owner decisions — ✅ RULED 2026-08-22

The owner accepted the recommendation the same day it was written: *"i like the 4.99/39yr/89
lifetime."*

| Question | Ruling |
|---|---|
| Working band for Compy Pro | **$4.99/mo · $39/yr · $89 one-time lifetime.** Written into [`RECEIPTS_DOCTRINE.md`](RECEIPTS_DOCTRINE.md) §Money stack 3 and [`MONETIZATION_PLAN.md`](MONETIZATION_PLAN.md) Layer 3; the old $3–4/mo · ~$25/yr placeholder is superseded. |
| Is a lifetime SKU acceptable | **Yes** — named explicitly in the ruling. It caps revenue per user and is hard to withdraw once offered; that cost was accepted for the trust it buys in this category. |
| Publish the price on the site | **No — not yet.** Not addressed in the ruling, so decided here and recorded as reversible: the site's Pro card stays price-free until Pro exists, per `MONETIZATION_PLAN.md`'s Director HOLD. A price on a page that cannot sell anything is the one move this doc's own §4 argues against. Flip it the day Pro is purchasable. |

**Still unmeasured, and still the next step:** nothing above is demand evidence (§6). Put the band in
front of the waitlist and measure who still signs up before a payment processor is ever wired.

**B2B is not covered by this ruling.** The $10–30/seat/mo band remains unevidenced and needs its own
pass, starting with one real repair-shop conversation.

## Sources

CCleaner: [cybernews](https://cybernews.com/privacy-tools/ccleaner-review/) ·
[softwaresuggest](https://www.softwaresuggest.com/ccleaner) — Fortect / Restoro:
[windowsreport](https://windowsreport.com/fortect-review/) ·
[pctested](https://pctested.com/fortect-review/) ·
[techradar](https://www.techradar.com/reviews/restoro) — Process Lasso:
[bitsum](https://bitsum.com/get-lasso-pro/) — HWiNFO:
[technologycounter](https://technologycounter.com/products/hwinfo) — GlassWire:
[glasswire.com/pricing](https://www.glasswire.com/pricing/) — Repair-shop diagnostic fees:
[HomeGuide](https://homeguide.com/costs/computer-repair-prices) ·
[techvoo](https://www.techvoo.com/computer-repair-pricing-guide-2026-transparent-costs-turnaround-and-whats-included) ·
[ICU Computer Services](https://www.icucomputerservices.com/cost-of-computer-diagnostic/)
