// d10: a crash record's headline in the app's language.
//
// Rust (blackbox.rs `headline_parts`) sends each headline as a closed code plus its values; the
// English sentence it also sends (`headline`, `summary`) is what this renders in English, and a Rust
// test pins every en key below to it byte for byte. Each code has ONE literal t() call per key here,
// never a computed key. Names (the app, the game) are passed through untranslated.
//
// Three cases, on every surface that shows a headline (Black Box rows and groups, "Since it last
// worked", Home's Care card):
//   - parts with a known code: the sentence for that code, in the app's language;
//   - parts with a code this build doesn't know: a fixed plain sentence, never the backend's text;
//   - no parts (a Care card stored before the code existed, or a fixture): the stored English
//     sentence as it is. The record holds nothing else that says what Windows recorded.
import type { TFunction } from "i18next";
import type { HeadlineParts } from "../types";

/** Mirrors `HEADLINE_CODES` in src-tauri/src/blackbox.rs (a test reads that file and compares). */
export const HEADLINE_CODES = [
  "gpu_timeout",
  "app_crash",
  "app_crash_no_app",
  "app_hang",
  "app_hang_no_app",
  "unexpected_shutdown",
  "blue_screen",
  "hardware_error",
] as const;

/** What a headline needs from its record: the parts, the stored sentence, and the time. */
export type HeadlineSource = {
  headline_parts?: HeadlineParts | null;
  /** The English sentence as sent or stored. */
  headline: string;
  /** RFC3339 at the record's own offset. */
  when: string;
  /** Rust's display of `when` ("Jun 12, 9:42 PM"), the English the en keys were written against. */
  when_display: string;
};

/** "Nov 11, 2:36 PM" in the app's language from a record's RFC3339 stamp, at the stamp's OWN offset
 *  (as Rust's display string is), never the machine's zone. English, or a stamp without a readable
 *  offset, gets Rust's display string as sent. */
export function recordWhen(when: string, whenDisplay: string, lang: string): string {
  if (lang.toLowerCase().startsWith("en")) return whenDisplay;
  const m = /(Z|([+-])(\d{2}):(\d{2}))$/.exec(when.trim());
  const ms = Date.parse(when);
  if (!m || isNaN(ms)) return whenDisplay;
  const offsetMin = m[1] === "Z" ? 0 : (m[2] === "-" ? -1 : 1) * (Number(m[3]) * 60 + Number(m[4]));
  // The wall-clock time at that offset, formatted as if it were UTC (so no zone is applied twice).
  return new Date(ms + offsetMin * 60000).toLocaleString(lang, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The sentence for one code, with its time. `null` for a code this build doesn't know, or an app
 *  code that arrived without its app (Rust never sends that; it is not guessed at). */
function sentence(p: HeadlineParts, when: string, t: TFunction): string | null {
  const app = p.app;
  switch (p.code) {
    case "gpu_timeout":
      return t("common.backendWords.headline.gpuTimeout", { when });
    case "app_crash":
      return app != null ? t("common.backendWords.headline.appCrash", { app, when }) : null;
    case "app_crash_no_app":
      return t("common.backendWords.headline.appCrashNoApp", { when });
    case "app_hang":
      return app != null ? t("common.backendWords.headline.appHang", { app, when }) : null;
    case "app_hang_no_app":
      return t("common.backendWords.headline.appHangNoApp", { when });
    case "unexpected_shutdown":
      return t("common.backendWords.headline.unexpectedShutdown", { when });
    case "blue_screen":
      return t("common.backendWords.headline.blueScreen", { when });
    case "hardware_error":
      return t("common.backendWords.headline.hardwareError", { when });
    default:
      return null;
  }
}

/** The same sentence without its time, for the Problems room's group line. */
function wording(p: HeadlineParts, t: TFunction): string | null {
  const app = p.app;
  switch (p.code) {
    case "gpu_timeout":
      return t("common.backendWords.headlineWhat.gpuTimeout");
    case "app_crash":
      return app != null ? t("common.backendWords.headlineWhat.appCrash", { app }) : null;
    case "app_crash_no_app":
      return t("common.backendWords.headlineWhat.appCrashNoApp");
    case "app_hang":
      return app != null ? t("common.backendWords.headlineWhat.appHang", { app }) : null;
    case "app_hang_no_app":
      return t("common.backendWords.headlineWhat.appHangNoApp");
    case "unexpected_shutdown":
      return t("common.backendWords.headlineWhat.unexpectedShutdown");
    case "blue_screen":
      return t("common.backendWords.headlineWhat.blueScreen");
    case "hardware_error":
      return t("common.backendWords.headlineWhat.hardwareError");
    default:
      return null;
  }
}

/** The ", during or just after a <game> session Compy recorded" tail, or "" when there is none. */
function tail(p: HeadlineParts, t: TFunction): string {
  const game = p.while_game;
  return game != null ? t("common.backendWords.headline.whileGame", { game }) : "";
}

/** A record's whole headline in the app's language (see the three cases at the top of this file). */
export function incidentHeadline(src: HeadlineSource, t: TFunction, lang: string): string {
  const p = src.headline_parts;
  if (!p) return src.headline;
  const when = recordWhen(src.when, src.when_display, lang);
  const base = sentence(p, when, t) ?? t("common.backendWords.headline.unknown", { when });
  return base + tail(p, t);
}

/** The headline without its time ("ROB RUN stopped working and closed, during or just after a X
 *  session Compy recorded"). A record
 *  without parts gets its stored sentence minus the " — <time>" Rust put in it. */
export function incidentWording(src: HeadlineSource, t: TFunction): string {
  const p = src.headline_parts;
  if (!p) {
    const cut = src.headline.indexOf(` — ${src.when_display}`);
    if (cut < 0) return src.headline;
    return src.headline.slice(0, cut) + src.headline.slice(cut + ` — ${src.when_display}`.length);
  }
  const base = wording(p, t) ?? t("common.backendWords.headlineWhat.unknown");
  return base + tail(p, t);
}
