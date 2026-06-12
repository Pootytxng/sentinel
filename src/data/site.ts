// THE single swap point for everything that points at Compy's web presence (R3 Lane A2,
// Zero-Budget Law: no account, no purchase — placeholder values until the owner's KPI triggers
// fire). The app (share card / export footers), the full-library exporter, and the dark site
// generator ALL read these constants, so going live is a one-file edit + regenerate.
//
// Receipts law note: SITE_URL is the *intended* home (domain purchase is owner-gated on waitlist
// signal); nothing in the app fetches it — it is plain copyable/printable text, never a request.

/** Where shared artifacts point home. Owner swap order (R3 spec §3 hosting decision): first the
 *  real Cloudflare Pages URL (`https://<project>.pages.dev`) at publish time, then
 *  `https://compy.gg` when the domain trigger fires. Until a real URL exists this stays the
 *  recorded intended domain — never an invented subdomain. */
export const SITE_URL = "https://compy.gg";

/** The doctrine §5 voice line that travels on every shared artifact. */
export const SITE_TAGLINE = "Measured, not promised — Compy.";

/** The REAL waitlist form (spec 2026-06-12-waitlist-wiring) — a native same-origin POST to our
 *  own Pages Function (/api/waitlist → D1). No provider, no third-party script, works with JS
 *  off (303 back to /?waitlist=ok). The hidden "website" field is the spam honeypot — humans
 *  never see it; bots fill it and get silently dropped. The page script progressive-enhances
 *  this into an inline fetch + thanks state. */
export const WAITLIST_SLOT = [
  `      <form class="waitlist-form" method="POST" action="/api/waitlist" data-waitlist>`,
  `        <input type="email" name="email" required placeholder="you@example.com" aria-label="Email address" />`,
  `        <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" />`,
  `        <button class="btn" type="submit">Notify me</button>`,
  `      </form>`,
  `      <p class="waitlist-pending" data-waitlist-status role="status"></p>`,
].join("\n");

/** Ko-fi (or similar $0 bridge) profile URL. Empty = the site omits the support link entirely.
 *  Owner swap: the real profile URL once an account exists. */
export const KOFI_URL = "";
