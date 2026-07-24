import { useTranslation } from "react-i18next";
import { sparkPoints } from "./geometry";

export function Sparkline({ values, width = 320, height = 42, stroke = "var(--accent)" }:
  { values: number[]; width?: number; height?: number; stroke?: string }) {
  const { t } = useTranslation();
  const pts = sparkPoints(values, width, height);
  return (
    <svg className="ds-spark" width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={t("common.sparkline.trendAriaLabel", { defaultValue: "trend" })}>
      {pts ? <polyline fill="none" stroke={stroke} strokeWidth="2" points={pts} /> : null}
    </svg>
  );
}
