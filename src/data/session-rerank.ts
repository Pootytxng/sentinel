// Review of `claude/modest-hawking-ztqibr`: App's refresh ranks priorities from four reads
// (readiness, recommendations, startup, sessions) and skips the ranking when any one failed. When
// only the session read failed and its re-read (useListReadRetry) later lands, nothing re-ranked,
// so Home kept the older ranking (or none) until the next refresh. The refresh now keeps the
// other three answers here, tagged with its sequence number, and the re-read ranks with them.

/** The three answers a refresh read while its session read failed, and which refresh read them. */
export type PendingRank<R, C, S> = {
  seq: number;
  readiness: R;
  recommendations: C;
  startup: S;
};

/**
 * Rank with the refresh's three kept answers and the re-read session list. Nothing happens when no
 * answers are kept or a newer refresh started since (`seqNow` differs): that refresh ranks itself.
 * The ranking is applied only if no newer refresh started while it ran. Resolves when done.
 */
export function rerankAfterSessionRead<R, C, S, Sess, P>(
  pending: PendingRank<R, C, S> | null,
  seqNow: () => number,
  sessions: Sess,
  rank: (args: { readiness: R; recommendations: C; startup: S; sessions: Sess }) => Promise<P>,
  apply: (p: P) => void,
): Promise<void> {
  if (!pending || pending.seq !== seqNow()) return Promise.resolve();
  const { seq, readiness, recommendations, startup } = pending;
  return rank({ readiness, recommendations, startup, sessions }).then(
    (p) => {
      if (seq === seqNow()) apply(p);
    },
    (e: unknown) => {
      console.error("[compy] ranking after the session re-read failed", e);
    },
  );
}
