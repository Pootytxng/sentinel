// Post and renew the Work Control claim, and read a thread's lease. A lease is ENDED by
// tools/entry/release.mjs; this file holds what that release is decided and rendered from.
//
// The load-bearing refusal: postClaim THROWS unless handed a PASS verdict. A claim asserts that the
// governing invariant holds, so a claim that can be posted without a verdict is a claim that can
// describe a state nobody verified. That refusal is a guard, not a convention.
//
// Its twin (#643) is `postRelease` in release.mjs, which measures who is asking before it ends a
// lease. Every session posts through one GitHub account, so a released Handoff ends whichever lease is
// live, whoever wrote it. Nothing exported here can post one: `execPlan` runs only a plan this file
// built, whole and as built, and refuses one whose comment reads as a release or as a claim. Both
// writers here, `postClaim` and `execPlan`, run for the launcher alone: neither reads who holds the
// board row it edits, so neither is left open to a seat nobody checked.
//
// Every board mutation is expressed as a PLAN of `gh` invocations before anything runs, so a dry run
// shows exactly what would be written, and the field quirks stay pinned by tests: date fields need
// `--date` (`--text` fails with "Did not receive a date value") and clearing an expiry needs `--clear`.

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scopeTextFromMarkdown } from "../../scripts/lib/claim-scope.mjs";
import { writeClaimCache } from "../../scripts/lib/scope-drift.mjs";
import { samePath } from "./worktree-field.mjs";

export const CLAIM_HEADER = "### Ownership claim";
export const HANDOFF_HEADER = "### Handoff";
export const TAKEOVER_HEADER = "### Verified takeover";
/** What `release.mjs` ends every release with: the one claim the release ends (`parseReleaseRecord`). */
export const RELEASE_RECORD_HEADER = "### Release record";
/** docs/WORK_CONTROL.md, the claim template: "Claim expires: (default 12 hours; alarm only)". */
export const DEFAULT_CLAIM_HOURS = 12;

const line = (label, value) => `- ${label}: ${value}`;

/** The WORK_CONTROL claim block, filled from MEASURED facts plus the verdict that licensed it. */
export function renderClaim(facts) {
  const procs = facts.processes?.length
    ? facts.processes.map((p) => `${p.name} ×${p.count}${p.note ? ` (${p.note})` : ""}`).join(", ")
    : "none";
  const verdictLines = (facts.verdict?.checks ?? [])
    .map((c) => `| \`${c.name}\` | ${c.expected} | ${c.actual} | ${c.ok ? "ok" : "**FAIL**"} |`)
    .join("\n");

  return [
    CLAIM_HEADER,
    "",
    line("Lane", facts.lane),
    line("Executor/tool", facts.executor),
    line("Repository", facts.repository),
    line("Worktree folder", facts.folder),
    line("Branch", facts.branch),
    line("Write scope", facts.scope),
    line("Started", facts.started),
    line("Claim expires", facts.expires),
    line("Next action", facts.nextAction),
    line("Active build/install/helper processes", procs),
    "",
    `#### Preflight verdict: ${facts.verdict?.verdict ?? "(none)"}`,
    "",
    "| Check | Expected | Actual | |",
    "|---|---|---|---|",
    verdictLines,
    "",
    "This claim was rendered from the preflight's own measurements. It is not a description of what",
    "the folder was expected to look like.",
  ].join("\n");
}

/** The WORK_CONTROL handoff block. Its `Exact next action` is what guard 7 compares against. */
export function renderHandoff(h) {
  return [
    HANDOFF_HEADER,
    "",
    line("Outcome", h.outcome ?? ""),
    line("Files/commits/PR", h.files ?? ""),
    line("Verification", h.verification ?? ""),
    line("Remaining work", h.remaining ?? ""),
    line("Gates or owner actions", h.gates ?? ""),
    line("Worktree state", h.worktreeState ?? ""),
    line("Active processes", h.processes ?? ""),
    line("Exact next action", h.nextAction ?? ""),
    line("Claim", h.claim ?? ""),
  ].join("\n");
}

const esc = (s) => s.replace(/[.*+?^{}()|[\]\\/$]/g, "\\$&");
// One enclosing backtick pair, trimmed — a hand-written claim quotes its folder or branch as code. So a
// name that is itself one code span reads as the name inside it, and `postClaim` posts no such claim.
const plain = (v) => (v && /^`[^`]*`$/.test(v) ? v.slice(1, -1) : v);

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/; // as deep as its fence allows: see `authored`
// Raw HTML blocks that end at a marker, by opener and end: CommonMark's kinds 1 and 3 to 5 (2 is a comment).
const HTML_ENDS = [
  [/^ {0,3}<(?:pre|script|style|textarea)(?:[ \t>]|$)/i, /<\/(?:pre|script|style|textarea)>/i],
  [/^ {0,3}<\?/, /\?>/],
  [/^ {0,3}<![A-Z]/, />/],
  [/^ {0,3}<!\[CDATA\[/, /\]\]>/],
];
// Kind 6: a block-level tag, opening or closing, which a blank line ends. GitHub's list: no `search`.
const HTML_BLOCK_TAG = /^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t>]|\/>|$)/i;
// Kind 7: any other complete tag alone on its line, which a blank line ends. It cannot interrupt a paragraph.
const HTML_LONE_TAG = /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^ \t"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t]*\/?>|<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>)[ \t]*$/;
// What `authored` tells apart to know whether a lone tag continues a paragraph.
const ATX = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/;
const LIST_ITEM = /^ {0,3}(?:[-+*]|(\d{1,9})[.)])(?:[ \t]|$)/;
const QUOTE = /^ {0,3}>/;
const FOOTNOTE = /^ {0,3}\[\^[^\]\s]+\]:/;
const indent = (l) => [.../^[ \t]*/.exec(l)[0]].reduce((n, c) => (c === "\t" ? n + 4 - (n % 4) : n + 1), 0);

/**
 * A comment's lines with everything that does not render as Markdown blanked. Headers and fields are
 * read only from these, so an example is never an event: on e56c6395 a `### Handoff` / `- Claim:
 * released` quoted inside a fence released the live claim above it (HQ review 5165670535), and on
 * 3ce1beb9 one quoted inside `<pre>` still did (HQ review 5167660647). Blanked, as GitHub renders
 * them (checked against its /markdown endpoint on 2026-09-10):
 * - fenced code, from an opener of three or more backticks or tildes indented at most three spaces
 *   (a backtick opener whose info string holds a backtick is inline code, not a fence) to a closer of
 *   the same character, at least as long, with only spaces or tabs after it, or to the comment's end;
 * - an HTML comment, from a line opening `<!--` through the line carrying `-->`. It renders as
 *   nothing, which makes it the worst place for a release to hide;
 * - every other raw HTML block, by CommonMark's rules with GitHub's list of tags (`<textarea>` and
 *   `<source>` on it, `<search>` not, and `<!` a declaration only before a capital letter): `<pre>`,
 *   `<script>`, `<style>` or `<textarea>` through the line carrying any of their end tags, blank
 *   lines and all; `<?` through `?>`; `<!X` through `>`; `<![CDATA[` through `]]>`; a block-level tag
 *   (`<div>`, `<details>`, `</p>`) up to a blank line; and any other complete tag alone on its line
 *   (`<span>`, `</pre>`) up to a blank line, unless it continues a paragraph.
 * Indented code, blockquotes and mentions need no blanking: a header counts only after at most three
 * spaces (a tab makes it indented code), and a field only at the start of its line.
 *
 * Whether a lone tag continues a paragraph turns on list, quote, footnote and table context, which is
 * followed only as far as the next line needs. Where it is in doubt, `strict` settles it toward
 * keeping a lease live: for a Handoff (`strict`) the block is open, and for a claim it is not.
 *
 * A block opened inside a list item ends with the item, at a line indented less than the item's text,
 * and that line may open a block of its own: on c71c6d3c a fence left open in an item hid the claim
 * after it (HQ review 5171061412), and a fence closed at column 0 released the claim above it, though
 * GitHub reads that line as opening a fence. Where an item's text starts is known only to within a
 * few columns, so past a line that may have ended the item, blocks are no longer followed: a claim is
 * read from the rest of the comment, and a Handoff from none of it (`within`).
 *
 * Every shape GitHub settles the other way fails closed. Among them: a Handoff after a lone tag
 * indented into a list item's paragraph, or anywhere after a block left open inside a list item, is
 * not read; a claim after a table and a lone tag, or in a block opened after a list item's block
 * ended, is. A Handoff header also counts only at the very start of its line (`headed`), where
 * nothing a list item holds can be. None of the 851 comments here on 2026-09-10 reads differently for
 * any of this.
 *
 * `Write scope` is not read through this: `scopeTextFromMarkdown` (#408) skips fenced lines by its own
 * rule. That rule is not reused here, because its opener is looser (`/^\s*```/`): safe for a scope,
 * which fails closed when hidden, and unsafe for a header, because a hidden claim lets a close through.
 */
const authored = (body, strict = false) => {
  let fence = null; // the fence open: its opening `run`, e.g. "````", and its `deep`
  let comment = null; // the HTML comment open: its `deep`
  let html = null; // the raw HTML block open: its `end` (null: a blank line), and its `deep`
  let para = null; // what the last line left open for a lone tag on this one: see `lone`
  let list = false; // false, or the least column a list item's text can start at since the last reset
  let lost = false; // whether a line may have ended the list item a block was open in: see `within`
  // A block opened no shallower than a list item's text may be inside the item, and then GitHub ends
  // it with the item, at a later line indented less than the block's opener: its `deep`. Past such a
  // line, what GitHub has open is no longer followed: the block may run on, or that very line may open
  // another. So a claim is read from the rest of the comment, and a Handoff from none of it. For a
  // claim a comment has no `deep`: GitHub hides everything after one that its item ended.
  const within = (n) => (list && n >= list ? n : 0);
  const code = (l, n) => {
    if (fence) {
      const close = FENCE_CLOSE.exec(l);
      if (close && close[1][0] === fence.run[0] && close[1].length >= fence.run.length && n <= (strict ? 3 : fence.deep + 3)) {
        fence = null;
        if (n > 3) lost = true; // a closer only as deep as an item's text allows: GitHub may read it as code
      }
      return "";
    }
    if (comment) {
      if (l.includes("-->")) comment = null;
      return "";
    }
    const open = FENCE_OPEN.exec(l);
    if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
      fence = { run: open[1], deep: within(n) };
      return "";
    }
    if (/^ {0,3}<!--/.test(l)) {
      if (!l.includes("-->")) comment = { deep: strict ? within(n) : 0 };
      return "";
    }
    return l;
  };
  // A lone tag opens a block unless it continues a paragraph. `para` is null where nothing is open,
  // "top" in a paragraph outside any list or quote, "container" after a line inside one (a lone tag
  // opens a block at the start of its line, and continues the item's paragraph indented under it),
  // and "maybe" where this cannot tell. Doubt goes to `strict`.
  const lone = (n) => para === null || (para === "container" && n === 0) || (para !== "top" && strict);
  // What a visible line leaves open for the next one.
  const track = (l, n) => {
    if (ATX.test(l) || BREAK.test(l) || (para === "top" && SETEXT.test(l))) {
      if (n === 0) list = false;
      return null;
    }
    const item = LIST_ITEM.exec(l);
    if (item) {
      const empty = !/\S/.test(l.slice(item[0].length));
      // A paragraph runs on through a marker that cannot interrupt it: an empty item, or a number but 1.
      if (para === "top" && (empty || (item[1] !== undefined && Number(item[1]) !== 1))) return "top";
      // Its text starts past the marker and one to four spaces, or else (nothing after the marker, a
      // tab, or five spaces, which start indented code) no nearer than one past the marker.
      const mark = item[0].trimEnd().length;
      const lead = mark + (/^ {1,4}(?=[^ \t])/.exec(l.slice(mark))?.[0].length ?? 1);
      list = list ? Math.min(list, lead) : lead;
      if (!empty) return "container";
      return n === 0 || para === null ? null : "maybe";
    }
    const quote = QUOTE.exec(l);
    if (quote) {
      if (n === 0) list = false;
      return /\S/.test(l.slice(quote[0].length)) ? "container" : null;
    }
    if (FOOTNOTE.test(l)) {
      if (n === 0) list = false;
      return "container"; // GitHub's footnote definitions hold their text like a list item, and interrupt a paragraph
    }
    if (l.includes("|")) return "maybe"; // a table, or not
    if (para === "container") return n === 0 ? "maybe" : "container"; // a lazy line, or a new paragraph
    if (para !== null) return para;
    if (list && n > 0) return "maybe"; // the item's next paragraph, or not
    if (n >= 4) return null; // indented code
    if (n === 0) list = false;
    return "top";
  };
  return String(body ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n").map((l) => {
    if (lost) return strict ? "" : l;
    const n = indent(l);
    if ((fence ?? comment ?? html)?.deep > n && /\S/.test(l)) {
      lost = true;
      return strict ? "" : l;
    }
    if (html) {
      if (html.end ? html.end.test(l) : !/\S/.test(l)) html = null;
      return "";
    }
    const out = code(l, n);
    if (!/\S/.test(out)) {
      para = null;
      return out;
    }
    const ends = HTML_ENDS.find(([open]) => open.test(l));
    if (ends || HTML_BLOCK_TAG.test(l) || (HTML_LONE_TAG.test(l) && lone(n))) {
      const end = ends ? ends[1] : null;
      if (!end || !end.test(l)) html = { end, deep: within(n) };
      para = null;
      if (n === 0) list = false;
      return "";
    }
    para = track(l, n);
    return l;
  });
};

/**
 * One field of a claim or handoff, by label, from its `authored` lines. Reads the block this module
 * renders (`- Label: value`), the bold variants a hand-written comment uses (`- **Label:** value`,
 * `- **Label**: value`), and a two-column table row (`| **label** | value |`) — the form another
 * session posted on #224, which read as a claim with no fields and so, under #358, as a live writer
 * whose scope nobody could see (collision rule 4: a refusal the other side could not cure). Aliases
 * are the labels other writers use for the same fact.
 *
 * Every field here is read ONE LINE at a time. The one field that is not — `Write scope`, which
 * wraps — is not read here at all: it goes through `scopeTextFromMarkdown` (#408), the one
 * extraction contract in this repo, so a claim and an issue body cannot disagree about the same
 * Markdown. This function keeping its own copy of that rule is how they came to disagree.
 */
const field = (lines, label, aliases = []) => {
  for (const name of [label, ...aliases]) {
    const bullet = new RegExp("^[-*]\\s*(?:\\*\\*)?" + esc(name) + "(?::\\s*\\*\\*|\\*\\*\\s*:|:)\\s*(.*)$", "i");
    for (let i = 0; i < lines.length; i += 1) {
      const m = bullet.exec(lines[i]);
      if (m) return m[1].trim();
    }
    const row = new RegExp("^\\|\\s*(?:\\*\\*)?" + esc(name) + "(?:\\*\\*)?\\s*\\|\\s*(.*?)\\s*\\|\\s*$", "i");
    for (const l of lines) {
      const m = row.exec(l);
      if (m) return m[1].trim();
    }
  }
  return null;
};

/**
 * A claim's expiry as a Date. Writers spell it "2026-09-03", "2026-09-02T04:55Z (12 hours)",
 * "2026-09-02T12:00:00Z" or "2026-08-03 (12-hour alarm; no automatic takeover)"; a date alone ends at
 * the end of its day (UTC). A bare term — "12 hours", "12h", "2 days" — means that long after the
 * claim was POSTED, and is readable only with the posting time (`anchor`) in hand: the claim on #313
 * spelled it that way, and read without an anchor it never expired, so a lane that finished on
 * 2026-09-01 refused every overlapping writer for good. Unparseable is null — a claim stays live
 * until its expiry is READ as past, never assumed past.
 */
export function claimExpiry(text, { anchor = null } = {}) {
  const s = String(text ?? "");
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?)?/.exec(s);
  if (m) {
    const [, y, mo, d, h, mi, sec, zone] = m;
    // A date alone means the end of its day; a time without seconds means the top of its minute.
    const wall = h === undefined ? calendarMs(y, mo, d, "23", "59", "59") : calendarMs(y, mo, d, h, mi, sec ?? "00");
    if (!Number.isFinite(wall)) return null;
    // The zone, when one is written, is taken off the wall-clock reading; none or Z reads as UTC.
    const z = zone && zone !== "Z" ? /^([+-])(\d{2}):?(\d{2})$/.exec(zone) : null;
    if (z && (Number(z[2]) > 23 || Number(z[3]) > 59)) return null;
    const offset = z ? (z[1] === "-" ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3])) * 60_000 : 0;
    return new Date(wall - offset);
  }
  const rel = /^\s*[(~]?\s*(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|d|day|days)\b/i.exec(s);
  if (!rel || !anchor) return null;
  const at = anchor instanceof Date ? anchor.getTime() : instant(anchor);
  if (!Number.isFinite(at)) return null;
  const n = Number(rel[1]);
  return new Date(at + n * (/^d/i.test(rel[2]) ? 86_400_000 : 3_600_000));
}

/**
 * Whether a comment's `authored` lines carry a header: at the start of a line, after at most three
 * spaces. A sentence that mentions `### Handoff` is not a handoff. Ten of the 840 comments in this
 * repository on 2026-09-10 did exactly that, and each one read as a lease event: #283's close comment
 * as a handoff, and #408's and #409's retellings as fresh claims (#411). A Handoff counts only at the
 * very start of its line (`spaces` 0), which no list item or quote reaches: an example nested in one,
 * in a block `authored` does not follow there, cannot release (HQ review 5167660647). GitHub shows a
 * Handoff indented one to three spaces too; none of the 851 comments here indents one, and not reading
 * it keeps a lease live.
 */
const headed = (lines, header, spaces = 3) => {
  const at = new RegExp(`^ {0,${spaces}}${esc(header)}`);
  return lines.some((l) => at.test(l));
};

/** Parse a claim comment back into facts. Returns null when the comment is not a claim. */
export function parseClaim(body) {
  const lines = authored(body);
  if (!headed(lines, CLAIM_HEADER)) return null;
  return {
    lane: field(lines, "Lane"),
    executor: field(lines, "Executor/tool", ["executor", "writer"]),
    repository: plain(field(lines, "Repository", ["repo"])),
    folder: plain(field(lines, "Worktree folder", ["worktree", "folder"])),
    branch: plain(field(lines, "Branch")),
    // The one field NOT read here: extraction is one contract, shared with the issue-body reader
    // (#408). `scope` stays a claim-only alias — an issue body is prose, and `- scope:` in prose is
    // as likely to be a sentence as a declaration.
    scope: scopeTextFromMarkdown(body, { aliases: ["scope"] }),
    started: field(lines, "Started"),
    expires: field(lines, "Claim expires", ["expiry", "expires"]),
    nextAction: field(lines, "Next action"),
  };
}

// What opens another section of a comment, even under a list or quote marker: a heading, a thematic
// break or a setext underline, on `authored` lines, where code and raw HTML are blank. And an HTML
// heading or rule, on the line as written, outside code spans.
const SECTION = /^[ \t]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+|>[ \t]*)*(?:#{1,6}(?:[ \t]|$)|([-*_])(?:[ \t]*\1){2,}[ \t]*$|(?:=+|-+)[ \t]*$)/;
const HTML_SECTION = /<(?:h[1-6]|hr)(?:[\s/>]|$)/i;
// An underline two columns in or more (a tab reaches four) may be inside a list item and make the
// item's text a heading: `- Claim: released` over `  ---` is an h2 in the item, not a Claim line.
const ITEM_UNDERLINE = /^(?: {2}| ?\t)[ \t]*(?:=+|-+)[ \t]*$/;

/**
 * The lines of a comment's Handoff sections, or null when it has none. A Handoff reads its fields only
 * from these: on afc6dfc7 it read them from the whole comment, so a `- Claim: released` above its
 * header, or under a later heading, released a live lease (HQ review 5172037615). A section opens at a
 * Handoff header (`headed`) and ends before the next line that may open another section (`SECTION`),
 * and a setext underline also takes back the lines above it that it may make a heading, a list item's
 * text among them when the underline is indented into the item (`ITEM_UNDERLINE`). Another Handoff
 * header opens a section of its own. Where a line may open a section it ends one, so a release after
 * it is not read and the lease stays live.
 *
 * The Release record's sections are read by the same rule (#643), with doubt settled the other way
 * (`strict` false, a header after up to three spaces): a record that is read can only narrow what a
 * release ends, so reading one keeps a lease live where missing one would end it.
 */
const sectionLines = (body, header, { strict = true, spaces = 0 } = {}) => {
  const raw = String(body ?? "").replace(/\r\n?/g, "\n").split("\n");
  let own = null; // what the sections under this header hold so far
  let open = false; // whether this line is in one
  let text = 0; // how many of their last lines are a paragraph, which a setext underline makes a heading
  let item = 0; // how many are a list item's text, which an underline indented into the item makes one
  authored(body, strict).forEach((l, i) => {
    if (headed([l], header, spaces)) {
      own ??= [];
      open = true;
      text = item = 0;
    } else if (SECTION.test(l) || HTML_SECTION.test(raw[i].replace(/`[^`]*`/g, ""))) {
      const heading = item && ITEM_UNDERLINE.test(l) ? item : SETEXT.test(l) ? text : 0;
      if (open) own.splice(own.length - heading, heading);
      open = false;
    } else if (open) {
      own.push(l);
      text = /\S/.test(l) && !LIST_ITEM.test(l) ? text + 1 : 0;
      item = !/\S/.test(l) ? 0 : LIST_ITEM.test(l) ? 1 : item && item + 1;
    }
  });
  return own;
};
const handoffLines = (body) => sectionLines(body, HANDOFF_HEADER);

/** Parse a handoff comment. `nextAction` is the durable record guard 7 checks the board against. */
export function parseHandoff(body) {
  const lines = handoffLines(body);
  if (!lines) return null;
  const claims = lines.flatMap((l) => field([l], "Claim") ?? []);
  return {
    outcome: field(lines, "Outcome"),
    files: field(lines, "Files/commits/PR"),
    verification: field(lines, "Verification"),
    remaining: field(lines, "Remaining work"),
    gates: field(lines, "Gates or owner actions"),
    worktreeState: field(lines, "Worktree state"),
    processes: field(lines, "Active processes"),
    nextAction: field(lines, "Exact next action"),
    // The Claim line has to open with "released". "**HELD.** ... Released only when a review verdict
    // lands" (#399, #407) is a held lease that mentions its release; read as released, it would let a
    // close through while the lease was live (#411). So does every other Claim line in the Handoff's
    // sections: one that holds, beside one that releases, keeps the lease live.
    released: claims.length > 0 && claims.every((c) => /^[^a-z0-9]*released\b/i.test(c)),
  };
}

/**
 * The Release record a comment carries (#643), or null when it has none: the stamps on its `Ends
 * claim` lines, as written. `release.mjs` ends every release it posts with one, naming the claim it
 * checked by the time GitHub gave that claim. A record with no stamp names no claim.
 */
export function parseReleaseRecord(body) {
  const lines = sectionLines(body, RELEASE_RECORD_HEADER, { strict: false, spaces: 3 });
  if (!lines) return null;
  return { ends: lines.flatMap((l) => field([l], "Ends claim") ?? []).map((v) => plain(v)) };
}

// A posting time as GitHub writes one, and nothing looser: a date or a sentence names no comment.
// Exported so a thread reader can refuse a comment that carries none (release.mjs): a claim read
// without its time could have been posted at any (`claimsAt`), so with one on the thread no release
// could ever name the live claim. The fields must be on the calendar as written: `Date.parse` reads
// 2026-02-30 as March 2, and on c5a085bd a claim stamped so was read as posted then, its default
// clock run out from there, and a takeover admitted on a thread that should have read as unreadable
// (review of PR 644, round 4). So the fields are put through the calendar and read back; a stamp
// that does not come back as it was written names no time (`calendarMs`). The shape is exported so
// that reader can say which it refused: a stamp shaped right but off the calendar, or no stamp.
export const STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/;
export const instant = (v) => {
  const m = typeof v === "string" ? STAMP.exec(v.trim()) : null;
  return m ? calendarMs(m[1], m[2], m[3], m[4], m[5], m[6], m[7]) : Number.NaN;
};

/**
 * The instant the UTC fields name, or NaN when they name none: a month, day, hour, minute or second
 * out of its range, February 29 off a leap year, a 24th hour, a field that is not a whole number.
 * `Date.UTC` rolls those over into the next unit, or truncates them; reading the result back shows
 * it. The fraction, when there is one, is read to the millisecond, as `Date.parse` reads it.
 */
export function calendarMs(y, mo, d, h, mi, s, fraction = "") {
  const [year, month, day, hour, minute, second] = [y, mo, d, h, mi, s].map(Number);
  const millis = fraction ? Number(String(fraction).slice(0, 3).padEnd(3, "0")) : 0;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  const back = new Date(ms);
  const same =
    back.getUTCFullYear() === year &&
    back.getUTCMonth() === month - 1 &&
    back.getUTCDate() === day &&
    back.getUTCHours() === hour &&
    back.getUTCMinutes() === minute &&
    back.getUTCSeconds() === second;
  return same ? ms : Number.NaN;
}

/**
 * The claims that were, or could have been, posted at `at`. GitHub's posting times are whole seconds,
 * so two claims can share one; and a claim read without its time could have been posted at any.
 */
const claimsAt = (claims, at) =>
  claims.filter((c) => {
    const t = instant(c.postedAt);
    return !Number.isFinite(t) || t === at;
  });

/**
 * Does this record name this claim and no other? Every stamp it holds is the claim's own posting
 * time, and no other claim on the thread so far (`seen`) was, or could have been, posted at that time.
 * On e0362db5 the time alone decided, so where a second claim landed in the same second as the one a
 * release was checked against, the release ended the second (review of PR 644, round 2). A time that
 * two claims share names neither.
 */
const endsClaim = (record, claim, seen) => {
  const at = instant(claim?.postedAt);
  return Number.isFinite(at) && record.ends.length > 0 && record.ends.every((s) => instant(s) === at) && claimsAt(seen, at).length === 1;
};

/**
 * Is a lease still live on this thread? The thread is folded once, in posting order, one transition
 * per comment: a Handoff whose Claim line releases ends the lease, and a claim starts one. A Handoff
 * that does not release changes nothing — a transfer or a HELD keeps the lease it names, and a later
 * Handoff that says nothing of the claim cannot bring a released one back (HQ review 5165670535). A
 * comment carrying both is read release first, so its claim stands. One fold, shared by
 * `gather.readIssueThread` and the work-control gate's close check (#411), so the board reader and the
 * gate cannot disagree about when a lease ended. `comments` is the thread in posting order, as
 * `gh issue view --json comments` returns it; `handoff` is the newest one, released or not, because
 * guard 7 reads its next action.
 *
 * A release that carries a Release record (#643) ends the claim it names and no other. Where that
 * claim is not the live one when the comment lands (a successor claimed in the seconds between the
 * check and the post, or the lease had already ended), its Handoff is not a lease event at all: it
 * ends nothing and is not the newest Handoff. The claim is named by its posting time, which every
 * reader carries (the batch reader in gather.mjs fetches no comment link), so no two readers can
 * disagree about what a record ends. A time names a claim only while one claim on the thread so far
 * was posted at it: two claims posted in the same second are named by neither's record, and that
 * lease stays live until a refreshed claim, with a second of its own, is released. A claim read
 * without its posting time matches no record and leaves every other claim's time unsure. A release
 * with no record, which is every one written by hand, still ends whichever claim is live.
 *
 * `run` is every claim since the last release, oldest first; its last entry is `claim` (#517). A
 * refreshed claim restates the lease, it does not start a new one, so the push-time overlap gate
 * measures how long a path has been held from the run, not from the newest comment. A comment's
 * `url`, when the reader supplied one, rides along so a refusal can link the claim, or the release,
 * it names.
 */
export function threadLease(comments) {
  let claim = null;
  let handoff = null;
  let run = [];
  const seen = []; // every claim so far, released or not: what a record's time is told apart from
  for (const c of comments ?? []) {
    const read = parseHandoff(c.body);
    const record = read?.released ? parseReleaseRecord(c.body) : null;
    const asHandoff = record === null || endsClaim(record, claim, seen) ? read : null;
    if (asHandoff) {
      handoff = { ...asHandoff, postedAt: c.createdAt, ...(c.url ? { url: c.url } : {}) };
      if (asHandoff.released) {
        claim = null;
        run = [];
      }
    }
    const asClaim = claimOf(c);
    if (asClaim) {
      claim = asClaim;
      run.push(claim);
      seen.push(claim);
    }
  }
  return { claim, handoff, run };
}

/** The claim a comment posts, with when it was posted and its link, or null when it posts none. */
function claimOf(c) {
  const read = parseClaim(c.body);
  return read ? { ...read, postedAt: c.createdAt, ...(c.url ? { url: c.url } : {}) } : null;
}

const REPO = ["--repo", "Pootytxng/sentinel"];
// Every plan this file built, whole and as built: `execPlan` runs these and nothing else (#643). A plan
// and its steps are frozen, so one built here cannot be edited into another afterwards, and a slice of
// one, or two joined, is an array this file did not build.
const BUILT = new WeakSet();
const step = (argv, describe) => Object.freeze({ argv: Object.freeze(argv), describe });
const built = (steps) => {
  const plan = Object.freeze(steps);
  BUILT.add(plan);
  return plan;
};
const comment = (issue, body) => step(["issue", "comment", String(issue), ...REPO, "--body", body], `comment on #${issue}`);
const setText = (ids, fieldId, text) => step(["project", "item-edit", "--project-id", ids.projectId, "--id", ids.itemId, "--field-id", fieldId, "--text", text], `set ${fieldId}`);
const setDate = (ids, fieldId, date) => step(["project", "item-edit", "--project-id", ids.projectId, "--id", ids.itemId, "--field-id", fieldId, "--date", date], `set ${fieldId}`);
const setOption = (ids, f, name) => step(["project", "item-edit", "--project-id", ids.projectId, "--id", ids.itemId, "--field-id", f.id, "--single-select-option-id", f.options[name]], `set ${f.id}=${name}`);

/** The comment comes FIRST: a half-completed run still leaves durable evidence on the issue. */
export function planPostClaim({ issue, ids, facts, verdict }) {
  return built([
    comment(issue, renderClaim({ ...facts, verdict })),
    setOption(ids, ids.fields.status, "Active"),
    setOption(ids, ids.fields.lane, facts.lane),
    setText(ids, ids.fields.worktree.id, `${facts.folder} @ ${facts.branch}`),
    setText(ids, ids.fields.nextAction.id, facts.nextAction),
    setDate(ids, ids.fields.claimExpires.id, facts.expires),
    setDate(ids, ids.fields.lastVerified.id, facts.started),
  ]);
}

export function planRenew({ issue, ids, until, note = null }) {
  return built([
    comment(issue, `Claim renewed until ${until}.${note ? ` ${note}` : ""}`),
    setDate(ids, ids.fields.claimExpires.id, until),
  ]);
}

const runPlan = (plan, { dryRun = false } = {}) => {
  const done = [];
  for (const s of plan) {
    if (dryRun) {
      done.push({ ...s, ran: false });
      continue;
    }
    execFileSync("gh", s.argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    done.push({ ...s, ran: true });
  }
  return done;
};

const planRefusal = (code, message) => Object.assign(new Error(message), { code });

// The launcher, by the command line node was started with: the program beside this file, and nothing
// before it. Four witnesses, and all must agree:
// - `process.report.getReport().header.commandLine[1]`, the first word after the executable in the
//   argv the OS handed node. Assigning `process.argv` does not change it, and a flag given before the
//   program (`--import`, `-r`, `-e`, `--inspect`) stands there in place of the program;
// - `process.argv[1]`, the program node resolved and ran;
// - `process.execArgv`, which must be empty: every node flag, and so every preload, is one;
// - `NODE_OPTIONS`, which must be unset or blank: a preload named there shows in neither of the above.
// So a session's own script, a test runner, `node -e`, a forged `process.argv` and a preload that runs
// before the launcher are each named by one of them. On 71bd4e38 `process.argv[1]` alone was the
// witness, and `node --import <a script> launch.mjs` ran that script with the launcher as its program
// (review of PR 644, round 3).
//
// THE LIMIT: all four are process state, and a program that rewrites all four before it imports this
// file is admitted; `process.argv[1]`, `process.report.getReport`, `process.execArgv` and NODE_OPTIONS
// are each writable from any program (review of PR 644, round 4; the test "the stated limit" shows
// such a program reaching the writers). No measurement made inside a process can tell what ran in it
// earlier, so this gate refuses the programs that do not forge node's process state, and no more: a
// hand-rolled script, a test runner, a preload, a flag. What holds against a forger is structural,
// the writers leaving this file for one that only the launcher reaches, and that is filed as a
// follow-up on #643, outside this change's write scope.
//
// Both paths are read through any link: node names this file by where it really is, and the program
// by how it was typed. The refusal says what was measured; a witness that cannot be read refuses,
// since unknown means locked.
const LAUNCHER = join(dirname(fileURLToPath(import.meta.url)), "launch.mjs");
const throughLinks = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};
const isLauncherPath = (path) => typeof path === "string" && path !== "" && samePath(throughLinks(resolve(path)), throughLinks(LAUNCHER));
const launcherWitness = () => {
  try {
    const measured = [];
    const quoted = (v) => (typeof v === "string" && v !== "" ? `"${v}"` : "no program");
    let commandLine = null;
    try {
      const read = process.report.getReport().header.commandLine;
      if (Array.isArray(read)) commandLine = read;
    } catch {}
    const program = process.argv[1];
    const programOk = isLauncherPath(program);
    if (!commandLine) {
      measured.push("the command line node was started with could not be read");
      if (!programOk) measured.push(`process.argv names ${quoted(program)} as the program`);
    } else {
      const started = commandLine[1];
      const startedOk = isLauncherPath(started);
      const onePlace = typeof started === "string" && typeof program === "string" && started !== "" && program !== "" && samePath(throughLinks(resolve(started)), throughLinks(resolve(program)));
      if (!startedOk && !programOk && (onePlace || started === program)) {
        measured.push(typeof program === "string" && program !== "" ? `node was started with the program "${program}"` : "node was started with no program");
      } else {
        if (!startedOk) measured.push(`node was started with ${quoted(started)} after the executable`);
        if (!programOk) measured.push(`process.argv names ${quoted(program)} as the program`);
      }
    }
    const flags = process.execArgv;
    if (!Array.isArray(flags)) measured.push("the flags node was started with could not be read");
    else if (flags.length > 0) measured.push(`node was started with the flag${flags.length === 1 ? "" : "s"} ${flags.join(" ")}`);
    const options = process.env.NODE_OPTIONS;
    if (typeof options === "string" && options.trim() !== "") measured.push(`NODE_OPTIONS is set (${options.trim()})`);
    return measured.length === 0 ? { ok: true } : { ok: false, measured: measured.join("; ") };
  } catch {
    return { ok: false, measured: "the process could not be measured" };
  }
};

/**
 * Run a plan that neither starts nor ends a lease: the launcher's renewal (#643).
 *
 * It used to run whatever `gh` arguments it was handed, so hiding the release plan hid nothing: one
 * hand-written step, `issue comment … "### Handoff … - Claim: released"`, ended whichever lease was
 * live, with no check of who asked. Now the whole plan is checked before its first step runs, dry run
 * or not, and it is refused when:
 * - it is not a plan this file built, whole and as built. A hand-written one is not, and neither is a
 *   copy, a slice or a join of built ones: a claim's plan less its comment is six edits to a board row
 *   of the caller's choosing;
 * - a comment reads as a release, whichever builder carried it (`planRenew`'s note, a claim's facts);
 * - a comment reads as a claim. A claim posted without its verdict makes its poster the holder, and
 *   the holder may release: two calls round the same check;
 * - the program running is not the launcher. A renewal sets a board row's expiry and nothing here
 *   reads who holds that row, so on e0362db5 a predecessor's `execPlan(planRenew(…))` wrote over its
 *   successor's row (review of PR 644, round 2). The launcher is the one caller there is, and it
 *   renews only after its own preflight. It is told by the command line node was started with
 *   (`launcherWitness`): that stops a script that calls this, a preload that runs before the launcher
 *   and a forged `process.argv`. Code loaded into the launcher's own process is the launcher's own.
 * A claim goes through `postClaim`, and a release through `postRelease` in release.mjs. A session
 * extends its own lease by posting a refreshed Ownership claim.
 */
export function execPlan(plan, { dryRun = false } = {}) {
  if (!BUILT.has(plan)) {
    throw planRefusal(
      "PLAN_NOT_BUILT_HERE",
      "Refusing to run a plan that tools/entry/claim.mjs did not build, whole and as built. A claim is posted by postClaim, and a lease is ended by `node tools/entry/release.mjs`.",
    );
  }
  for (const s of plan) {
    if (s.argv[0] !== "issue" || s.argv[1] !== "comment") continue;
    const body = s.argv[s.argv.length - 1];
    if (parseHandoff(body)?.released) {
      throw planRefusal(
        "PLAN_WOULD_RELEASE",
        `Refusing to run a plan whose comment would release a lease ("${s.describe}"). A lease is ended by \`node tools/entry/release.mjs\`, which checks who holds it first.`,
      );
    }
    if (parseClaim(body)) {
      throw planRefusal("PLAN_WOULD_CLAIM", `Refusing to run a plan whose comment is an Ownership claim ("${s.describe}"). A claim is posted by postClaim, on a PASS verdict.`);
    }
  }
  const launcher = launcherWitness();
  if (!launcher.ok) {
    throw planRefusal(
      "PLAN_NOT_THE_LAUNCHER",
      `Refusing to run a plan outside the launcher (tools/entry/launch.mjs): ${launcher.measured}. A renewal moves a board row's expiry without reading who holds that row, so only the launcher runs one, after its own preflight. A session extends its own lease by posting a refreshed Ownership claim, and ends it with \`node tools/entry/release.mjs\`.`,
    );
  }
  return runPlan(plan, { dryRun });
}

/**
 * The refusal that makes a claim mean something.
 *
 * A claim is also refused, dry run or not, when the comment it would post does not read back as the
 * folder and the branch it was asked to name. A lease is released by the seat its claim READS as
 * (`releaseDecision`), and the claim block is plain Markdown: on e0362db5 a claim for the branch
 * `` `claude/x` `` (git allows the backticks) read as one for `claude/x`, so the folder, moved to that
 * other branch, was taken for the holder (review of PR 644, round 2). The whole comment is read, with
 * the readers a release uses, so a line break or an open code fence in any other field is caught by
 * the same check.
 *
 * And it runs for the launcher alone, dry run or not (`launcherWitness`). The verdict is its caller's to
 * hand over, and a claim takes the lease and files the board row over whatever is there: the same
 * unchecked seat `execPlan` is closed to. The launcher is the one caller there is, and it claims on
 * the verdict of its own preflight.
 */
export function postClaim({ issue, verdict, facts, ids, dryRun = false, cacheDir = undefined }) {
  if (verdict?.verdict !== "PASS") {
    throw new Error(
      `Refusing to post a claim on #${issue}: preflight verdict is ${verdict?.verdict ?? "(none)"}. ` +
        "A claim asserts the invariant holds; posting one without a PASS would assert something nobody verified.",
    );
  }
  const plan = planPostClaim({ issue, ids, facts, verdict });
  const body = plan[0].argv[plan[0].argv.length - 1];
  if (parseHandoff(body)?.released) {
    throw planRefusal("PLAN_WOULD_RELEASE", `Refusing to post a claim on #${issue} whose text also reads as a released Handoff. A lease is ended by \`node tools/entry/release.mjs\`.`);
  }
  const read = parseClaim(body);
  const reads = { folder: read ? namedFolder(read.folder) : "", branch: read ? namedBranch(read.branch) : null };
  const named = (v) => typeof v === "string" && v !== "";
  if (!named(facts.folder) || !named(facts.branch) || reads.folder !== facts.folder || reads.branch !== facts.branch) {
    throw planRefusal(
      "CLAIM_WOULD_NOT_READ_BACK",
      `Refusing to post a claim on #${issue} that would not read back as the folder and branch it names. It was asked to name "${named(facts.folder) ? facts.folder : "(no folder)"} @ ${named(facts.branch) ? facts.branch : "(no branch)"}", and as written it reads "${reads.folder || "(no folder)"} @ ${reads.branch ?? "(no branch)"}". ` +
        "A lease is released by the folder and branch its claim reads as, so this claim would lock out its own holder or admit another seat. On a claim line a name wrapped in backticks reads as the name inside them, a branch ends at its first space, and a line break ends the line.",
    );
  }
  const launcher = launcherWitness();
  if (!launcher.ok) {
    throw planRefusal(
      "CLAIM_NOT_THE_LAUNCHER",
      `Refusing to post a claim on #${issue} outside the launcher (tools/entry/launch.mjs): ${launcher.measured}. A claim takes the lease and files the board row on a verdict its caller hands over, so only the launcher posts one this way, on the verdict of its own preflight. A lease is ended with \`node tools/entry/release.mjs\`.`,
    );
  }
  const ran = runPlan(plan, { dryRun });
  if (!dryRun) {
    // The scope this claim just declared, remembered locally for the drift readers (#356). A cache
    // failure is not a claim failure: the thread is the record, the cache only saves a round trip.
    try {
      writeClaimCache(
        { issue, scopeText: facts.scope, folder: facts.folder ?? null, branch: facts.branch ?? null, postedAt: new Date().toISOString(), source: "postClaim" },
        cacheDir ? { dir: cacheDir } : {},
      );
    } catch {}
  }
  return { plan, ran };
}

/**
 * The folder and the branch a claim names. Real lines carry prose after the value ("`C:\x` (created
 * fresh)", "claude/x (cut from origin/main)"): of the 558 claims on this repository on 2026-10-03, 13
 * folder lines and 219 branch lines do. A code span the line opens with is the whole value. Without
 * one, a folder is the line as written, because a path can hold whitespace and the push gate compares
 * it whole (`scripts/scope-drift-gate.mjs`).
 *
 * A branch is read EXACTLY, because a name read short admits the branch it was shortened to. Without
 * a span it is the line's first word, since a ref name cannot hold whitespace, less only a trailing
 * dot or colon, which no ref name can end with. A comma, a semicolon or a bracket after it is part of
 * the name: git allows all of them, and on d5890abb stripping "," read a claim for `claude/x,` as one
 * for `claude/x` (review of PR 644). A span counts only when a space or the line's end follows it, for
 * the same reason. So a line read wrongly refuses its own holder and admits nobody else, with one
 * rule the format keeps: a value that is one whole code span names what is inside it, so a branch
 * whose own name is wrapped in backticks cannot be told from a quoted one. `postClaim` posts no claim
 * whose folder or branch does not read back as itself, so only a hand-written line is ever read so.
 */
const leadingSpan = (v) => /^`([^`]+)`/.exec(v)?.[1].trim() || null;
const wholeSpan = (v) => /^`([^`]+)`(?=\s|$)/.exec(v)?.[1].trim() || null;
const namedFolder = (value) => {
  const v = String(value ?? "").trim();
  return leadingSpan(v) ?? v;
};
const namedBranch = (value) => {
  const v = String(value ?? "").trim();
  return wholeSpan(v) ?? ((/^\S+/.exec(v)?.[0] ?? "").replace(/[.:]+$/, "") || null);
};

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** The live claim as a refusal names it: who, since when, and the link when the reader gave one. */
const heldBy = (claim) =>
  `${claim.folder || "(no folder named)"} @ ${claim.branch || "(no branch named)"}, claimed ${claim.postedAt ?? "(time unknown)"}` +
  (claim.url ? ` (${claim.url})` : "");

/**
 * When a claim's own clock runs out. Its `Claim expires` line when it has one; a line that cannot be
 * read leaves the clock unknown, never assumed past (`claimExpiry`). With no line at all, the
 * documented default: DEFAULT_CLAIM_HOURS after the claim was posted.
 */
const claimClock = (claim) => {
  if (String(claim.expires ?? "").trim()) {
    const at = claimExpiry(claim.expires, { anchor: claim.postedAt });
    return { at, by: at ? "its Claim expires line" : null };
  }
  const posted = instant(claim.postedAt);
  if (!Number.isFinite(posted)) return { at: null, by: null };
  return { at: new Date(posted + DEFAULT_CLAIM_HOURS * 3_600_000), by: `the ${DEFAULT_CLAIM_HOURS}-hour default` };
};

const HOLDER_STATES = new Set(["live", "dead", "none", "unknown"]);
const HOLDER_WORDS = {
  dead: "the holding session is dead (no live process, transcript cold)",
  none: "no session record for the holding folder exists on this machine",
  unknown: "whether the holding session is running could not be measured",
  unmeasured: "the holding session was not measured (the claim names no folder to measure)",
};

/**
 * May this caller release the lease on this thread? A pure decision over facts its caller MEASURED:
 * the thread as it was read (`comments`; anything but an array is a thread nobody could read), the
 * caller's own seat (`self`), and a probe for the holding session (`liveness`). It writes nothing and
 * posts nothing, so calling it with other facts decides nothing: `postRelease` in release.mjs
 * measures all three itself and takes none of them from its caller.
 *
 * The holder is the worktree folder AND the branch the live claim names, because that is all a claim
 * says about who posted it (`renderClaim`). So:
 * - the same folder on the same branch releases;
 * - another folder is refused. That is the incident;
 * - the same folder on another branch is refused too: a folder that moved on is not measurably the
 *   lane the claim describes, and the cure is one checkout or a refreshed claim;
 * - no live claim is refused, not skipped, so a second release exits non-zero and the board row,
 *   which a successor may already have set, is never touched;
 * - a thread, a caller or a holder that could not be measured is refused: unknown means locked.
 *
 * THE TAKEOVER EXCEPTION, the dormant-lease route (docs/WORK_CONTROL.md, "Lightweight handoff"): a
 * dead lease is ended from another folder, and nothing else here allows that. It is never implied.
 * The caller asks for it (`takeover`) and says what was inspected, and the words are recorded in the
 * comment. A reason alone does not open it, and neither does expiry alone (collision rule 6: expiry
 * is an alarm, not a takeover):
 * - a holding session measured LIVE is never taken over, whatever its clock says;
 * - one measured DEAD is, with the reason;
 * - one that cannot be measured (no record on this machine, a claim that names no folder) is, with
 *   the reason, only once the claim's own clock has run out (`claimClock`).
 * The holder asking for it is refused, so the flag cannot become the habitual way to release. So is
 * the folder the claim names, on any other branch: a takeover ends ANOTHER folder's lease, and from
 * the claimed folder it was a way round the branch check that asked no probe (review of PR 644).
 *
 * @returns {{ok: true, via: "holder"|"takeover", claim: object, takeover?: object}
 *          | {ok: false, code: string, reason: string, cure: string, claim: object|null}}
 */
export function releaseDecision({ issue, comments, unread = null, self, takeover = null, liveness = null, now = new Date() }) {
  const refuse = (code, reason, cure, claim = null) => ({ ok: false, code, reason, cure: `Nothing was written. ${cure}`, claim });

  // `unread` is the reader's own account of why there is no thread, when it gave one.
  if (!Array.isArray(comments)) {
    const why = typeof unread === "string" && unread.trim() !== "" ? ` (${oneLine(unread)})` : "";
    return refuse(
      "RELEASE_THREAD_UNREADABLE",
      `The thread of #${issue} could not be read${why}, so who holds its lease is unknown. An unknown lease is not the caller's lease.`,
      "Run it again when GitHub answers.",
    );
  }
  const lease = threadLease(comments);
  const claim = lease.claim;
  if (!claim) {
    const last = lease.handoff;
    return refuse(
      "RELEASE_NO_LIVE_CLAIM",
      `#${issue} has no live claim: ` +
        (last?.released
          ? `its lease was already released at ${last.postedAt ?? "(time unknown)"}${last.url ? ` (${last.url})` : ""}.`
          : "no Ownership claim is in force on its thread.") +
        " A release here would rewrite a board row this caller does not hold.",
      "There is no lease here to release. A follow-up is a plain comment, not a Handoff that releases; changing the board row takes a claim of your own.",
    );
  }

  const mine = String(self?.folder ?? "").trim();
  const myBranch = String(self?.branch ?? "").trim();
  if (!mine) {
    const why = typeof self?.why === "string" ? oneLine(self.why) : "";
    return refuse(
      "RELEASE_SELF_UNKNOWN",
      `This caller's own worktree folder could not be measured${why ? ` (${why})` : ""}, so it cannot be shown to hold #${issue}'s lease (${heldBy(claim)}).`,
      "Run it from inside the holding worktree.",
      claim,
    );
  }
  const holderFolder = namedFolder(claim.folder);
  const holderBranch = namedBranch(claim.branch);
  const sameFolder = holderFolder !== "" && samePath(holderFolder, mine);
  const isHolder = sameFolder && holderBranch !== null && myBranch !== "" && holderBranch === myBranch;
  const here = `${mine} @ ${myBranch || "(detached HEAD)"}`;

  if (takeover === null || takeover === undefined || takeover === false) {
    if (isHolder) return { ok: true, via: "holder", claim };
    if (!holderFolder || !holderBranch) {
      const missing = !holderFolder && !holderBranch ? "its worktree folder or its branch" : !holderFolder ? "its worktree folder" : "its branch";
      return refuse(
        "RELEASE_HOLDER_UNKNOWN",
        `The live claim on #${issue} does not name ${missing}, so nobody can be shown to hold it: ${heldBy(claim)}.`,
        'Post a refreshed Ownership claim from the holding folder that names both, then release. A lease nobody holds any more is taken over with --takeover "<the evidence you checked>".',
        claim,
      );
    }
    if (!sameFolder) {
      return refuse(
        "RELEASE_NOT_HOLDER",
        `#${issue}'s lease is held by another folder: ${heldBy(claim)}. This caller is ${here}. A Handoff posted from here would end that lease and overwrite its board row.`,
        'Only the holding folder releases. If that session is gone, take the lease over with --takeover "<the worktree and process evidence you checked>".',
        claim,
      );
    }
    if (!myBranch) {
      return refuse(
        "RELEASE_SELF_UNKNOWN",
        `This folder is the one #${issue}'s claim names (${heldBy(claim)}), but it is on no branch right now (a detached HEAD or a rebase in progress), so it cannot be shown to be on the claimed branch.`,
        `Check out ${holderBranch}, then release.`,
        claim,
      );
    }
    // Punctuation after a branch name, or straight after its code span, is part of the name
    // (`namedBranch`), so say when that is all it is.
    const bare = holderBranch.replace(/[,;)\]]+$/, "");
    const punctuated = bare !== holderBranch && (bare === myBranch || bare === `\`${myBranch}\``);
    return refuse(
      "RELEASE_BRANCH_MISMATCH",
      `#${issue}'s claim names this folder on another branch: ${heldBy(claim)}. This folder is on ${myBranch}. A folder that moved to another branch is not measurably the lane that claim describes.` +
        (punctuated ? ` Its Branch line reads as "${holderBranch}": punctuation written straight after a branch name is read as part of it.` : ""),
      punctuated
        ? "Post a refreshed Ownership claim whose Branch line is the name alone, or the name in a code span with a space after it, then release."
        : `Check out ${holderBranch} and release, or post a refreshed Ownership claim that names ${myBranch} first.`,
      claim,
    );
  }

  if (isHolder) {
    return refuse(
      "RELEASE_TAKEOVER_NOT_NEEDED",
      `This folder and branch hold #${issue}'s lease themselves (${heldBy(claim)}), so there is nothing to take over.`,
      "Release without --takeover.",
      claim,
    );
  }
  if (sameFolder) {
    return refuse(
      "RELEASE_TAKEOVER_SAME_FOLDER",
      `#${issue}'s claim names this folder (${heldBy(claim)}), and this folder is ${here}. A takeover ends another folder's lease; from the claimed folder it would only skip the branch check.`,
      holderBranch
        ? `Check out ${holderBranch} and release without --takeover, or post a refreshed Ownership claim from here first.`
        : "Post a refreshed Ownership claim from here that names this folder's branch, then release without --takeover.",
      claim,
    );
  }
  const why = oneLine(typeof takeover === "string" ? takeover : takeover?.reason);
  if (!why) {
    return refuse(
      "RELEASE_TAKEOVER_NO_REASON",
      `Taking over #${issue}'s lease (${heldBy(claim)}) needs the evidence that was checked, in words: it is recorded in the comment.`,
      'Pass --takeover "<what you inspected: the worktree, its processes, the session>".',
      claim,
    );
  }
  // Every named holder is measured. An answer that is not one of the four states, a probe that throws
  // and no probe at all are a holder nobody measured, which is never read as a dead one.
  let holder = holderFolder ? "unknown" : "unmeasured";
  if (holderFolder && typeof liveness === "function") {
    try {
      const measured = liveness(holderFolder);
      if (HOLDER_STATES.has(measured)) holder = measured;
    } catch {
      holder = "unknown";
    }
  }
  if (holder === "live") {
    return refuse(
      "RELEASE_HOLDER_LIVE",
      `The session in the holding folder is live, so #${issue}'s lease is not dormant: ${heldBy(claim)}. A live holder is never taken over, whatever its expiry says.`,
      "That session releases its own lease: ask it, or run the release from its folder.",
      claim,
    );
  }
  const clock = claimClock(claim);
  const lapsed = clock.at !== null && clock.at.getTime() <= now.getTime();
  if (holder !== "dead" && !lapsed) {
    const ticking = clock.at
      ? `its clock runs until ${clock.at.toISOString()} (${clock.by})`
      : "its clock cannot be read, so it cannot be shown to have run out";
    return refuse(
      "RELEASE_LEASE_NOT_LAPSED",
      `#${issue}'s lease is not shown to be dormant: ${heldBy(claim)}. Measured: ${HOLDER_WORDS[holder]}, and ${ticking}. A reason alone does not end another session's lease.`,
      "Wait for the clock to run out, or have the holding session release it.",
      claim,
    );
  }
  return { ok: true, via: "takeover", claim, takeover: { reason: why, holder, lapsedAt: lapsed ? clock.at.toISOString() : null, clockBy: clock.by } };
}

/**
 * What a takeover leaves on the thread, after the Handoff and in a section of its own (so none of it
 * is read as a Handoff field): whose lease it was, where it was ended from, what was measured, and
 * the caller's own words. The fold does not read this section; a person does.
 */
const renderTakeover = ({ claim, self, takeover }) =>
  [
    TAKEOVER_HEADER,
    "",
    line("Previous lease", `${claim.lane || "(no lane named)"} on ${heldBy(claim)}, expires ${claim.expires || `(none stated: the ${DEFAULT_CLAIM_HOURS}-hour default)`}`),
    line("Released from", `${self.folder} @ ${self.branch || "(detached HEAD)"}`),
    line("Measured", `${HOLDER_WORDS[takeover.holder]}; ${takeover.lapsedAt ? `the claim's clock ran out at ${takeover.lapsedAt} (${takeover.clockBy})` : takeover.clockBy ? "the claim's clock had not run out" : "the claim's clock could not be read"}`),
    line("Worktree/process evidence checked", takeover.reason),
  ].join("\n");

/**
 * What every release the tool posts ends with, in a section of its own: the claim it ends, named by
 * the time GitHub gave it. The fold reads `Ends claim` (`parseReleaseRecord`); the other lines are for
 * a person. No label here opens with "Claim", so none is ever read as a Handoff's Claim line.
 */
const renderRecord = (claim) =>
  [
    RELEASE_RECORD_HEADER,
    "",
    line("Ends claim", claim.postedAt),
    line("Held by", `${claim.folder || "(no folder named)"} @ ${claim.branch || "(no branch named)"}`),
    ...(claim.url ? [line("Link", claim.url)] : []),
  ].join("\n");

/**
 * The comment a release posts, built and checked before anything is written: the Handoff as its
 * author wrote it (`text`), a takeover's record when it is one, and the Release record. `decision` is
 * `releaseDecision`'s answer over the same `comments`. Pure, like the decision: it posts nothing.
 *
 * It is refused unless the fold will read it as exactly what was decided, a release of the one claim
 * that was checked and nothing else:
 * - the text carries a Release record of its own. The tool writes that, from the claim it checked;
 * - the live claim, or any other claim on the thread, was read without its posting time. A record
 *   names a claim by that time, and a claim with no time could have been posted at any (`claimsAt`),
 *   so nothing could name the live one. On 71bd4e38 this was read as a shared time, whose cure is a
 *   refreshed claim, which cures nothing here (review of PR 644, round 3);
 * - another claim on the thread was posted in the same second. A time two claims share names neither
 *   (`endsClaim`), so the release would be posted and end nothing;
 * - it does not release: no Handoff section, or a Claim line that holds or transfers;
 * - its record does not read back as written. A Handoff text that leaves a code fence or an HTML
 *   block open swallows the record after it, and the comment would be a release with no record, which
 *   ends whichever claim is live when it lands;
 * - it carries an Ownership claim as well, so it would start a lease as it ended one.
 *
 * The board's Next action is read back out of the comment, so guard 7 passes by construction.
 *
 * @returns {{ok: true, body: string, nextAction: string|null}
 *          | {ok: false, code: string, reason: string, cure: string, claim: object}}
 */
export function releaseComment({ issue, comments, decision, self, text, now = new Date() }) {
  const claim = decision.claim;
  const refuse = (code, reason, cure) => ({ ok: false, code, reason, cure: `Nothing was written. ${cure}`, claim });
  const handoff = String(text ?? "");
  if (parseReleaseRecord(handoff)) {
    return refuse(
      "RELEASE_BODY_HAS_RECORD",
      `The Handoff text carries a "${RELEASE_RECORD_HEADER}" section of its own. The release writes that itself, from the claim it checked.`,
      "Take that section out of the Handoff and run it again.",
    );
  }
  const at = instant(claim.postedAt);
  if (!Number.isFinite(at)) {
    return refuse(
      "RELEASE_CLAIM_UNDATED",
      `The live claim on #${issue} was read without the time it was posted (${heldBy(claim)}), so a release could not name it and would end whichever claim is live when it lands.`,
      "Run it again when GitHub answers with the thread's posting times.",
    );
  }
  const claims = comments.map(claimOf).filter(Boolean);
  const undated = claims.find((c) => !Number.isFinite(instant(c.postedAt)));
  if (undated) {
    return refuse(
      "RELEASE_CLAIM_UNDATED",
      `An Ownership claim on #${issue} was read without the time it was posted (${heldBy(undated)}). A release names the claim it ends by its posting time, and a claim with no time could have been posted at any, so this release would be posted and end nothing.`,
      "Run it again when GitHub answers with the thread's posting times.",
    );
  }
  if (claimsAt(claims, at).length !== 1) {
    return refuse(
      "RELEASE_CLAIM_TIME_SHARED",
      `Another Ownership claim on #${issue} was posted in the same second as the live one (${heldBy(claim)}). A release names the claim it ends by that time, and a time two claims share names neither, so this release would be posted and end nothing.`,
      "Post a refreshed Ownership claim from the holding folder, which gets a time of its own, and release that. Where no session is left there to post one, this tool cannot end the lease: mark the row Needs Kuya.",
    );
  }
  const body = `${[handoff.trimEnd(), ...(decision.via === "takeover" ? [renderTakeover({ claim, self, takeover: decision.takeover })] : []), renderRecord(claim)].join("\n\n")}\n`;
  const parsed = parseHandoff(body);
  if (!parsed?.released) {
    return refuse(
      "RELEASE_WOULD_NOT_RELEASE",
      `The Handoff text does not end a lease: it needs a "${HANDOFF_HEADER}" section whose every Claim line opens with "released".`,
      "A Handoff that holds or transfers the lease is a plain comment, not a release.",
    );
  }
  const record = parseReleaseRecord(body);
  if (record?.ends.length !== 1 || instant(record.ends[0]) !== instant(claim.postedAt)) {
    return refuse(
      "RELEASE_RECORD_UNREADABLE",
      `The Release record written after the Handoff does not read back as the one claim it names. The Handoff text leaves a code fence or an HTML block open, which hides what follows it, or it carries "Ends claim" lines the record would be read with. Posted like that, the release would end whichever claim is live when it lands.`,
      "Close the fence or the HTML block in the Handoff and run it again.",
    );
  }
  if (threadLease([...comments, { body, createdAt: now.toISOString() }]).claim) {
    return refuse(
      "RELEASE_WOULD_NOT_RELEASE",
      "The comment carries an Ownership claim as well, so it would start a new lease as it ended this one.",
      "Post the release alone; a new claim is a comment of its own.",
    );
  }
  return { ok: true, body, nextAction: parsed.nextAction };
}

/**
 * What a release did, read back off the thread once it is posted (#643). GitHub has no conditional
 * write, so the check before the post cannot see a claim that lands in the seconds after it. The fold
 * settles what such a release ended (`threadLease`), and this says which way it went before any board
 * field is touched. `index` is where the release sits in `comments`.
 * - "ended": a claim was live when the release landed, the fold reads the release as ending it, and
 *   nobody has claimed since.
 * - "nothing": the fold does not read it as ending a lease. Another claim was live when it landed (a
 *   later one, or one posted in the same second as the claim it names), or none was.
 * - "taken": it ended its claim, and a claim was posted after it. The board row is that claim's,
 *   whether or not it is still live: its own release files the row, and this one must not file over it.
 *
 * The answer is the fold's own, never a second rule beside it: on e0362db5 this compared posting
 * times itself, and called a release that landed on a same-second claim "ended" (review of PR 644,
 * round 2). `before` is the claim that was live when it landed, and `next` the newest claim posted
 * after it.
 *
 * @returns {{landed: "ended"|"nothing"|"taken", before: object|null, next: object|null}}
 */
export function releaseOutcome({ comments, index }) {
  const before = threadLease(comments.slice(0, index)).claim;
  const ended = before !== null && threadLease(comments.slice(0, index + 1)).claim === null;
  const next = comments.slice(index + 1).map(claimOf).filter(Boolean).at(-1) ?? null;
  if (!ended) return { landed: "nothing", before, next };
  return { landed: next ? "taken" : "ended", before, next };
}

/** A claim as a message names it: who, since when, and the link when the reader gave one. */
export const describeClaim = (claim) => heldBy(claim);
