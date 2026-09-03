// Guard: the board is read WHOLE or not at all. `gh project item-list` returns at most `--limit` rows
// and says nothing when the board has more, so a small limit turns every issue past the cut into
// "not on the board" -- a refusal with a false reason. That happened to #339 on a 135-item board under
// a limit of 100. Two pins: the limit is generous, and gh's own count is compared to what arrived.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BOARD_READ_LIMIT, parseBoardItems, readBoard } from "./gather.mjs";
import { readBoard as readBoardForMigration } from "./migrate-board.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(HERE, rel), "utf8");

const row = (n, status = "Inbox") => ({
  id: `PVTI_${n}`,
  title: `item ${n}`,
  status,
  content: { number: n },
});
const payload = (items, totalCount = items.length) => JSON.stringify({ items, totalCount });

function limitOf(argv) {
  const i = argv.indexOf("--limit");
  return i < 0 ? null : Number(argv[i + 1]);
}

describe("board read is whole or refused", () => {
  it("asks gh for far more rows than the board holds, and the limit is the one constant", () => {
    expect(BOARD_READ_LIMIT).toBeGreaterThanOrEqual(500);
    const seen = [];
    readBoard({
      run: (argv) => {
        seen.push(argv);
        return payload([row(1)]);
      },
    });
    readBoardForMigration({
      run: (argv) => {
        seen.push(argv);
        return payload([row(1)]);
      },
    });
    expect(seen).toHaveLength(2);
    for (const argv of seen) {
      expect(argv.slice(0, 2)).toEqual(["project", "item-list"]);
      expect(limitOf(argv)).toBe(BOARD_READ_LIMIT);
    }
  });

  it("a truncated payload is a refusal with the true reason, never a shorter board", () => {
    const hundred = Array.from({ length: 100 }, (_, i) => row(i + 1));
    expect(() => parseBoardItems(payload(hundred, 135))).toThrow(/truncated: 100 of 135/);
    const r = readBoard({ run: () => payload(hundred, 135) });
    expect(r.reachable).toBe(false);
    expect(r.items).toEqual([]);
    expect(r.error).toMatch(/truncated: 100 of 135/);
    expect(() => readBoardForMigration({ run: () => payload(hundred, 135) })).toThrow(/truncated/);
  });

  it("a whole payload reads every row, with or without gh's count", () => {
    const rows = [row(291, "Done"), row(339, "Inbox")];
    const r = readBoard({ run: () => payload(rows) });
    expect(r.reachable).toBe(true);
    expect(r.items.map((it) => [it.number, it.itemId, it.status])).toEqual([
      [291, "PVTI_291", "Done"],
      [339, "PVTI_339", "Inbox"],
    ]);
    expect(parseBoardItems(JSON.stringify({ items: rows }))).toHaveLength(2);
    expect(readBoardForMigration({ run: () => payload(rows) }).map((it) => it.number)).toEqual([291, 339]);
  });

  it("no item-list call in tools/entry carries a small literal limit", () => {
    for (const rel of ["gather.mjs", "migrate-board.mjs"]) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/"--limit",\s*"\d{1,3}"/);
      expect(src, rel).toContain("String(BOARD_READ_LIMIT)");
    }
  });
});
