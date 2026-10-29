import type { TFunction } from "i18next";

// P9-hz: the rig's display mode travels as the backend's compact "WxH@R" (hardware.rs
// `current_fingerprint`, R = the panel's refresh rate in Hz). Session, Trial, Care and timeline lines
// printed that raw ("1920x1080@250"), so the rate read as a bare number with no unit. This words it
// for the reader ("1920×1080 @ 250 Hz"). A rate the read could not get (0) says "unknown", never a
// guessed number. A mode in any other spelling prints exactly as recorded: never reformatted into a
// guess. Comparisons (same rig? same context?) keep using the raw value; this is display only.
const MODE = /^(\d+)x(\d+)@(\d+)$/;

export function displayModeLabel(mode: string | null | undefined, t: TFunction): string | null {
  if (mode == null) return null;
  const raw = mode.trim();
  if (raw === "") return null;
  const m = MODE.exec(raw);
  if (!m) return raw;
  const [, width, height, rate] = m;
  return Number(rate) > 0
    ? t("common.displayMode.withRate", { width, height, rate })
    : t("common.displayMode.rateUnknown", { width, height });
}
