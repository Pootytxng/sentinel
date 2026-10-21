// GitHub REST lists, one numbered page at a time (#445 option 1, the read-only second transport).
//
// `gh api --paginate` follows the `Link` header GitHub answers with, and GitHub writes that header
// in the repository's NUMERIC form (`repositories/{id}/...`). The hosted lane (claude.ai/code)
// reaches GitHub through a proxy that refuses that form outright ("Numeric-ID repository paths
// (repositories/{id}/...) are not supported through this proxy", HTTP 403), so on 2026-10-21 the
// open-issue list (112 open issues and pull requests: two pages) could not be read from there at
// all, and every gate behind it ended in BOARD_UNREACHABLE for a reason that was not the board.
// Explicit `page=N` under `repos/{owner}/{repo}/...` is accepted on both sides of that proxy, so
// every REST list read names its pages here and never uses `--paginate`.
//
// A page is read as the raw JSON array, not through `--jq`: the array's length is what says whether
// another page exists (a jq filter with a `select` can print nothing for a page that was full). A
// page that is not a JSON array is a failed read, never an empty one, and a list longer than
// REST_MAX_PAGES pages fails rather than truncates: a read that silently stops early is the "could
// not tell" that collision rule 5 refuses to print as "disjoint".

export const REST_PAGE_SIZE = 100;
export const REST_MAX_PAGES = 50;

/** `path` with this page's `per_page` and `page` appended. The pager owns both; a path that names either is refused. */
export function pagedPath(path, page, { pageSize = REST_PAGE_SIZE } = {}) {
  const p = String(path ?? "");
  if (!p || /\s/.test(p)) throw new Error(`pagedPath: ${JSON.stringify(path)} is not a request path`);
  if (/[?&](per_page|page)=/.test(p)) throw new Error(`pagedPath: ${p} names its own page; the pager owns per_page and page`);
  const n = Number(page);
  if (!Number.isInteger(n) || n < 1) throw new Error(`pagedPath: page ${JSON.stringify(page)} is not a positive integer`);
  return `${p}${p.includes("?") ? "&" : "?"}per_page=${pageSize}&page=${n}`;
}

/** The argv of one page: a GET of the numbered page, nothing else (no --paginate, no --jq). */
export function pageArgv(path, page, opts) {
  return ["api", "--method", "GET", pagedPath(path, page, opts)];
}

function parsePage(raw, path, page) {
  let batch;
  try {
    batch = JSON.parse(String(raw ?? ""));
  } catch (e) {
    throw new Error(`${path} page ${page}: not JSON (${e.message})`);
  }
  if (!Array.isArray(batch)) throw new Error(`${path} page ${page}: expected a JSON array, got ${batch === null ? "null" : typeof batch}`);
  return batch;
}

const tooLong = (path, maxPages, pageSize) => new Error(`${path}: more than ${maxPages} pages of ${pageSize}; a read that long is refused, not truncated`);

/** Every item of a list endpoint through a synchronous `gh(argv) -> string`. Throws on any failed page. */
export function readAllPagesSync(gh, path, { pageSize = REST_PAGE_SIZE, maxPages = REST_MAX_PAGES } = {}) {
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = parsePage(gh(pageArgv(path, page, { pageSize })), path, page);
    items.push(...batch);
    if (batch.length < pageSize) return items;
  }
  throw tooLong(path, maxPages, pageSize);
}

/** The same through a `gh(argv)` that may answer with a promise. */
export async function readAllPages(gh, path, { pageSize = REST_PAGE_SIZE, maxPages = REST_MAX_PAGES } = {}) {
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = parsePage(await gh(pageArgv(path, page, { pageSize })), path, page);
    items.push(...batch);
    if (batch.length < pageSize) return items;
  }
  throw tooLong(path, maxPages, pageSize);
}
