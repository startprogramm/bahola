import type { CSSProperties } from "react";

export const chartTooltipStyle: CSSProperties = {
  borderRadius: "8px",
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--popover))",
  color: "hsl(var(--popover-foreground))",
  boxShadow: "0 8px 24px rgba(15, 23, 42, 0.18)",
  padding: "8px 12px",
};

export const chartTooltipLabelStyle: CSSProperties = {
  fontWeight: 600,
  marginBottom: 4,
  color: "hsl(var(--muted-foreground))",
  fontSize: "10px",
};

export function chartTooltipEntryStyle(color?: string, fontSize = "11px"): CSSProperties {
  return {
    color: color || "hsl(var(--popover-foreground))",
    fontSize,
    lineHeight: 1.5,
  };
}

export function chartLegendStyle(fontSize = "11px", paddingTop = "8px"): CSSProperties {
  return {
    fontSize,
    paddingTop,
    color: "hsl(var(--muted-foreground))",
  };
}
