// CR-care-silent: the crash-notice record (`care/incident-observer.json`) used to fail in silence.
// "Not now" and "Find out why" cleared the card optimistically and swallowed a failed save, and a
// read that failed looked exactly like "no crash". The backend now records a support event and
// answers with an error; this turns that error into one visible line, never a dialog.
//
// CR-care-line-truth: the line tells the truth about what is still unsaved. Each choice (command +
// incident) is tracked on its own, so a later good save of a different choice no longer clears it,
// and once the retries are spent the line stops promising another try.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Which half of the record let the user down, if any. `save`: a choice is unsaved and Compy will
 * try it again. `saveStopped`: a choice is unsaved and its retries are spent. `read`: the crash
 * notices couldn't be checked. A retrying save outranks a stopped one, and any save outranks a read.
 */
export type CareStoreTrouble = "save" | "saveStopped" | "read" | "readStopped" | null;

/**
 * The automatic retries after a failed save, so "it'll try again" is a promise kept. After the
 * last one the line says the notice may show again (each failed save writes a support event, so
 * Compy does not retry forever); the record still holds the notice, the card comes back on the
 * next read, and the user's own click is the next try.
 */
export const CARE_SAVE_RETRY_MS = [5_000, 30_000, 120_000] as const;

/**
 * CR-care-read-promise: the re-reads after a failed read of the crash notices, so the read line's
 * "it'll try again" is kept too. After the last one the line says the next check comes when the
 * user opens another page (App reads on every room change).
 */
export const CARE_READ_RETRY_MS = [5_000, 30_000, 120_000] as const;

/**
 * A good save of one choice settles a spent save of another about the same incident: once
 * "Not now" (`dismissed:X`) is saved the notice is gone, so an `opened:X` that stopped retrying no
 * longer leaves anything to show again.
 */
const SETTLES: Record<string, string[]> = { dismissed: ["opened"] };

type Chain = { timer: ReturnType<typeof setTimeout> | null };

export function useCareStore() {
  // Unsaved choices, by key: `true` once that choice's retries are spent.
  const [unsaved, setUnsaved] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  // null = the last read was fine; false = it failed and a re-read is coming; true = re-reads spent.
  const [readTrouble, setReadTrouble] = useState<boolean | null>(null);
  const chains = useRef(new Map<string, Chain>());
  const read = useRef<{ timer: ReturnType<typeof setTimeout> | null; step: number }>({ timer: null, step: 0 });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const live = chains.current;
    const reading = read.current;
    return () => {
      // Unmounted: nothing more is scheduled, and an answer still in flight is dropped.
      mounted.current = false;
      live.forEach((c) => c.timer && clearTimeout(c.timer));
      live.clear();
      if (reading.timer) clearTimeout(reading.timer);
      reading.timer = null;
    };
  }, []);
  /**
   * Save a choice about a crash notice. `key` names the choice (command and incident), so one
   * choice's later success never clears another's failure. `save` is the caller's own
   * `invoke("command", …)`, written out at the call site so the command stays a plain literal
   * there. A failure shows the line and retries with backoff; the same choice made again replaces
   * its earlier retries.
   */
  const persist = useCallback((key: string, save: () => Promise<unknown>) => {
    const earlier = chains.current.get(key);
    if (earlier?.timer) clearTimeout(earlier.timer);
    const chain: Chain = { timer: null };
    chains.current.set(key, chain);
    const current = () => mounted.current && chains.current.get(key) === chain;
    const colon = key.indexOf(":");
    const settled =
      colon < 0 ? [] : (SETTLES[key.slice(0, colon)] ?? []).map((kind) => `${kind}${key.slice(colon)}`);
    const attempt = (retry: number) => {
      save().then(
        () => {
          if (!current()) return;
          chains.current.delete(key);
          setUnsaved((m) => {
            const gone = [key, ...settled.filter((k) => m.get(k) === true)].filter((k) => m.has(k));
            if (gone.length === 0) return m;
            const next = new Map(m);
            gone.forEach((k) => next.delete(k));
            return next;
          });
        },
        () => {
          if (!current()) return;
          const wait = CARE_SAVE_RETRY_MS[retry];
          const stopped = wait === undefined;
          setUnsaved((m) => (m.get(key) === stopped ? m : new Map(m).set(key, stopped)));
          if (stopped) return; // the line says so; the card comes back on the next read
          chain.timer = setTimeout(() => {
            chain.timer = null;
            attempt(retry + 1);
          }, wait);
        },
      );
    };
    attempt(0);
  }, []);
  /**
   * The crash notices couldn't be read. `again` is the caller's own read: it runs once after each
   * backoff step while the reads keep failing, then stops and the line says so. A failure while a
   * re-read is already waiting schedules nothing more; a good read (`readOk`) resets the steps.
   */
  const readFailed = useCallback((again: () => void) => {
    if (!mounted.current) return;
    const r = read.current;
    if (r.timer) {
      setReadTrouble((s) => (s === false ? s : false));
      return;
    }
    const wait = CARE_READ_RETRY_MS[r.step];
    const stopped = wait === undefined;
    setReadTrouble(stopped);
    if (stopped) return;
    r.timer = setTimeout(() => {
      r.timer = null;
      r.step += 1;
      if (mounted.current) again();
    }, wait);
  }, []);
  const readOk = useCallback(() => {
    const r = read.current;
    if (r.timer) clearTimeout(r.timer);
    r.timer = null;
    r.step = 0;
    if (mounted.current) setReadTrouble(null);
  }, []);
  const states = [...unsaved.values()];
  const trouble: CareStoreTrouble = states.some((stopped) => !stopped)
    ? "save"
    : states.length > 0
      ? "saveStopped"
      : readTrouble === false
        ? "read"
        : readTrouble === true
          ? "readStopped"
          : null;
  return { trouble, persist, readFailed, readOk };
}

/** The one visible line. Renders nothing while the record is healthy. */
export function CareStoreLine({ trouble }: { trouble: CareStoreTrouble }) {
  const { t } = useTranslation();
  if (!trouble) return null;
  return (
    <div className="gaming-toast care-store-line" role="status">
      <p className="gaming-toast-msg">
        {trouble === "save"
          ? t("app.careStore.saveFailed")
          : trouble === "saveStopped"
            ? t("app.careStore.saveStopped")
            : trouble === "read"
              ? t("app.careStore.readFailed")
              : t("app.careStore.readStopped")}
      </p>
    </div>
  );
}
