// CR-care-silent: the crash-notice record (`care/incident-observer.json`) used to fail in silence.
// "Not now" and "Find out why" cleared the card optimistically and swallowed a failed save, and a
// read that failed looked exactly like "no crash". The backend now records a support event and
// answers with an error; this turns that error into one visible line, never a dialog.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/** Which half of the record let the user down, if any. `save` outranks `read`. */
export type CareStoreTrouble = "save" | "read" | null;

/** The one automatic retry after a failed save, so "it'll try again" is a promise kept. */
export const CARE_SAVE_RETRY_MS = 5000;

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

export function useCareStore(invokeFn: Invoke) {
  const [trouble, setTrouble] = useState<CareStoreTrouble>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);
  const saved = useCallback(() => setTrouble((t) => (t === "save" ? null : t)), []);
  /** Save a choice about a crash notice. A failure shows the line and retries once. */
  const persist = useCallback(
    (command: string, incidentId: string) => {
      const attempt = () => invokeFn(command, { incidentId });
      attempt()
        .then(saved)
        .catch(() => {
          setTrouble("save");
          timers.current.push(
            setTimeout(() => {
              // Still failing: the line stays, and the card comes back on the next read, so the
              // user's own next click is the retry after this one.
              attempt().then(saved).catch(() => {});
            }, CARE_SAVE_RETRY_MS),
          );
        });
    },
    [invokeFn, saved],
  );
  const readFailed = useCallback(() => setTrouble((t) => t ?? "read"), []);
  const readOk = useCallback(() => setTrouble((t) => (t === "read" ? null : t)), []);
  return { trouble, persist, readFailed, readOk };
}

/** The one visible line. Renders nothing while the record is healthy. */
export function CareStoreLine({ trouble }: { trouble: CareStoreTrouble }) {
  const { t } = useTranslation();
  if (!trouble) return null;
  return (
    <div className="gaming-toast care-store-line" role="status">
      <p className="gaming-toast-msg">
        {trouble === "save" ? t("app.careStore.saveFailed") : t("app.careStore.readFailed")}
      </p>
    </div>
  );
}
