// scripts/lib/rest-pages.mjs is the one REST pager every gate reader shares (#445 option 1): an explicit
// `page=N` under `repos/{owner}/{repo}/...`, never `--paginate` (the hosted proxy refuses the numeric
// `repositories/{id}/...` form GitHub's Link header carries). Everything here drives the pager through a
// fake `gh(argv) -> string`; nothing spawns a process.
import { describe, expect, it } from "vitest";
import {
  REST_MAX_PAGES,
  REST_PAGE_SIZE,
  pageArgv,
  pagedPath,
  readAllPages,
  readAllPagesSync,
} from "./rest-pages.mjs";

const PATH = "repos/Pootytxng/sentinel/issues/678/comments";

const rows = (n, from = 1) => Array.from({ length: n }, (_, i) => ({ id: from + i }));

/** The page number one argv asks for, or null when the argv is not a page read. */
function pageOf(argv) {
  const m = /[?&]page=(\d+)$/.exec(argv[argv.length - 1] ?? "");
  return m ? Number(m[1]) : null;
}

/** A fake gh. `pages` is an array (`pages[n - 1]` answers page n) or a function of the page number; a string answers raw, anything else JSON-stringified. */
function ghOf(pages) {
  const calls = [];
  const gh = (argv) => {
    calls.push(argv);
    const page = pageOf(argv);
    const body = typeof pages === "function" ? pages(page) : pages[page - 1];
    return typeof body === "string" ? body : JSON.stringify(body);
  };
  return { gh, calls };
}

describe("pagedPath / pageArgv: the pager owns per_page and page", () => {
  it("appends the page to a bare path, and with & to a path that already has a query", () => {
    expect(pagedPath(PATH, 1)).toBe(`${PATH}?per_page=100&page=1`);
    expect(pagedPath(`${PATH}?state=open`, 3)).toBe(`${PATH}?state=open&per_page=100&page=3`);
    expect(pagedPath(PATH, 2, { pageSize: 7 })).toBe(`${PATH}?per_page=7&page=2`);
    expect(REST_PAGE_SIZE).toBe(100);
    expect(REST_MAX_PAGES).toBe(50);
  });
  it("refuses a path that is not a request path or that names its own page", () => {
    expect(() => pagedPath("", 1)).toThrow(/"" is not a request path/);
    expect(() => pagedPath(undefined, 1)).toThrow(/is not a request path/);
    expect(() => pagedPath("repos/x y", 1)).toThrow(/is not a request path/);
    expect(() => pagedPath(`${PATH}?per_page=5`, 1)).toThrow(/names its own page; the pager owns per_page and page/);
    expect(() => pagedPath(`${PATH}?page=2`, 1)).toThrow(/names its own page/);
    expect(() => pagedPath(`${PATH}?state=open&page=2`, 1)).toThrow(/names its own page/);
  });
  it("refuses a page that is not a positive integer", () => {
    for (const bad of [0, -1, 1.5, "x", undefined, null]) {
      expect(() => pagedPath(PATH, bad)).toThrow(/is not a positive integer/);
    }
  });
  it("builds one GET of the numbered page: no --paginate, no --jq", () => {
    const argv = pageArgv(PATH, 4);
    expect(argv).toEqual(["api", "--method", "GET", `${PATH}?per_page=100&page=4`]);
    expect(argv).not.toContain("--paginate");
    expect(argv).not.toContain("--jq");
  });
});

describe("readAllPagesSync: every item, one numbered page at a time", () => {
  it("stops after a short first page", () => {
    const { gh, calls } = ghOf([rows(3)]);
    expect(readAllPagesSync(gh, PATH)).toEqual(rows(3));
    expect(calls).toHaveLength(1);
    expect(pageOf(calls[0])).toBe(1);
  });
  it("answers [] for an empty first page, after one read", () => {
    const { gh, calls } = ghOf([[]]);
    expect(readAllPagesSync(gh, PATH)).toEqual([]);
    expect(calls).toHaveLength(1);
  });
  it("reads a second page after a full first one, even when it is empty", () => {
    const { gh, calls } = ghOf([rows(100), []]);
    expect(readAllPagesSync(gh, PATH)).toHaveLength(100);
    expect(calls.map(pageOf)).toEqual([1, 2]);
  });
  it("joins the pages in order and never asks for --paginate", () => {
    const { gh, calls } = ghOf([rows(100), rows(1, 101)]);
    const items = readAllPagesSync(gh, PATH);
    expect(items).toHaveLength(101);
    expect(items[0]).toEqual({ id: 1 });
    expect(items[100]).toEqual({ id: 101 });
    expect(calls.map(pageOf)).toEqual([1, 2]);
    for (const argv of calls) expect(argv).not.toContain("--paginate");
  });
  it("honours pageSize: five items in pages of two take three reads", () => {
    const { gh, calls } = ghOf([rows(2), rows(2, 3), rows(1, 5)]);
    expect(readAllPagesSync(gh, PATH, { pageSize: 2 })).toEqual(rows(5));
    expect(calls.map(pageOf)).toEqual([1, 2, 3]);
    expect(calls[2][3]).toBe(`${PATH}?per_page=2&page=3`);
  });
  it("a page that is not JSON is a failed read that names its page, never an empty one", () => {
    expect(() => readAllPagesSync(ghOf(["<html>proxy</html>"]).gh, PATH)).toThrow(new RegExp(`${PATH} page 1: not JSON`));
    expect(() => readAllPagesSync(ghOf([rows(100), "gh: HTTP 502"]).gh, PATH)).toThrow(/page 2: not JSON/);
  });
  it("a page that is JSON but not an array is a failed read too", () => {
    expect(() => readAllPagesSync(ghOf([{ message: "Not Found" }]).gh, PATH)).toThrow(/page 1: expected a JSON array, got object/);
    expect(() => readAllPagesSync(ghOf([null]).gh, PATH)).toThrow(/page 1: expected a JSON array, got null/);
    expect(() => readAllPagesSync(ghOf([rows(100), 42]).gh, PATH)).toThrow(/page 2: expected a JSON array, got number/);
  });
  it("a gh that throws propagates its own error after one read", () => {
    const calls = [];
    const gh = (argv) => {
      calls.push(argv);
      throw new Error("gh: HTTP 403 (Numeric-ID repository paths are not supported through this proxy)");
    };
    expect(() => readAllPagesSync(gh, PATH)).toThrow(/gh: HTTP 403 \(Numeric-ID repository paths/);
    expect(calls).toHaveLength(1);
  });
  it("a list longer than REST_MAX_PAGES full pages is refused, not truncated, after exactly that many reads", () => {
    const { gh, calls } = ghOf(() => rows(100));
    expect(() => readAllPagesSync(gh, PATH)).toThrow(
      new RegExp(`${PATH}: more than 50 pages of 100; a read that long is refused, not truncated`),
    );
    expect(calls).toHaveLength(REST_MAX_PAGES);
  });
  it("maxPages and pageSize are both honoured by the refusal", () => {
    const { gh, calls } = ghOf(() => rows(2));
    expect(() => readAllPagesSync(gh, PATH, { pageSize: 2, maxPages: 2 })).toThrow(/more than 2 pages of 2/);
    expect(calls).toHaveLength(2);
  });
  it("a short page within maxPages ends the read; maxPages full pages with no short one cannot tell and refuse", () => {
    const short = ghOf([rows(2), rows(1, 3)]);
    expect(readAllPagesSync(short.gh, PATH, { pageSize: 2, maxPages: 2 })).toEqual(rows(3));
    expect(short.calls).toHaveLength(2);
    const full = ghOf([rows(2), rows(2, 3)]);
    expect(() => readAllPagesSync(full.gh, PATH, { pageSize: 2, maxPages: 2 })).toThrow(/more than 2 pages of 2/);
  });
});

describe("readAllPages: the same through a gh that answers with a promise", () => {
  it("resolves every item over two pages", async () => {
    const sync = ghOf([rows(100), rows(1, 101)]);
    const gh = async (argv) => sync.gh(argv);
    await expect(readAllPages(gh, PATH)).resolves.toHaveLength(101);
    expect(sync.calls.map(pageOf)).toEqual([1, 2]);
  });
  it("accepts a gh that answers synchronously", async () => {
    await expect(readAllPages(ghOf([rows(2)]).gh, PATH)).resolves.toEqual(rows(2));
  });
  it("rejects on a page that is not JSON", async () => {
    const gh = async () => "<html>proxy</html>";
    await expect(readAllPages(gh, PATH)).rejects.toThrow(/page 1: not JSON/);
  });
  it("rejects a list longer than maxPages instead of truncating it", async () => {
    const sync = ghOf([rows(1), rows(1, 2)]);
    const gh = async (argv) => sync.gh(argv);
    await expect(readAllPages(gh, PATH, { pageSize: 1, maxPages: 1 })).rejects.toThrow(/more than 1 pages of 1/);
    expect(sync.calls).toHaveLength(1);
  });
  it("rejects with the gh's own error when gh rejects", async () => {
    const gh = async () => {
      throw new Error("spawn gh ETIMEDOUT");
    };
    await expect(readAllPages(gh, PATH)).rejects.toThrow(/spawn gh ETIMEDOUT/);
  });
});
