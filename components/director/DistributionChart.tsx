"use client";

import { useState, useId, useRef } from "react";
import {
  AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, Rectangle,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LINE_COLORS } from "@/components/director/PerformanceChart";
import { ExportBtn } from "@/components/director/ExportBtn";
import { exportChartAsPNG } from "@/lib/director/export-client";
import { useLanguage } from "@/lib/i18n/language-context";
import type { ScoreBucket } from "@/lib/director/types";
import { lightenColor } from "@/lib/director/chart-colors";

export interface DistSeries {
  label: string;
  buckets: ScoreBucket[];
}

export function gaussianCurvePoints(buckets: ScoreBucket[]): number[] {
  // Returns 51 Y values for x = 0, 2, 4, ..., 100
  const total = buckets.reduce((s, b) => s + b.count, 0);
  if (total === 0) return Array(51).fill(0);
  const mean = buckets.reduce((s, b, i) => s + (i * 10 + 5) * b.count, 0) / total;
  const variance = buckets.reduce((s, b, i) => s + b.count * ((i * 10 + 5 - mean) ** 2), 0) / total;
  const sigma = Math.sqrt(Math.max(variance, 25)); // min sigma=5 to avoid degenerate curves
  const K = total * 10; // scale PDF → count space
  return Array.from({ length: 51 }, (_, idx) => {
    const x = idx * 2; // 0, 2, 4, ..., 100
    return (Math.exp(-0.5 * ((x - mean) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI))) * K;
  });
}

function PlainTick({ x, y, payload, textAnchor = "middle", fontSize = 11, dy = 0 }: any) {
  const text = String(payload.value);
  return (
    <g transform={`translate(${x},${y + dy})`}>
      <text x={0} y={4} textAnchor={textAnchor} fontSize={fontSize} fill="hsl(var(--foreground))">{text}</text>
    </g>
  );
}

export function DistributionChart({ series: seriesList, barSeries, loading, highlightValue, onHighlightChange, showBarChart = true }: {
  series: DistSeries[];
  barSeries?: DistSeries[];
  loading: boolean;
  highlightValue?: string | null;
  onHighlightChange?: (v: string | null) => void;
  showBarChart?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const { t } = useLanguage();
  const [internalKey, setInternalKey] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  // Support both controlled (external) and uncontrolled (internal) modes
  const isControlled = highlightValue !== undefined;
  const rawKey = isControlled ? (highlightValue ?? null) : internalKey;
  const setKey = (v: string | null) => {
    if (isControlled) onHighlightChange?.(v);
    else setInternalKey(v);
  };

  // Reset if key is not in current series
  const effectiveKey = rawKey && seriesList.find(s => s.label === rawKey) ? rawKey : null;

  // Check if all series have zero data (no graded submissions)
  const hasData = !loading && seriesList.length > 0 &&
    seriesList.some(s => s.buckets.some(b => b.count > 0));

  if (loading || seriesList.length === 0) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-2 flex-shrink-0"><CardTitle className="text-base">{t("dirChartScoreDistribution")}</CardTitle></CardHeader>
        <CardContent className="flex-1"><Skeleton className="h-full w-full" /></CardContent>
      </Card>
    );
  }

  if (!hasData) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-2 flex-shrink-0"><CardTitle className="text-base">{t("dirChartScoreDistribution")}</CardTitle></CardHeader>
        <CardContent className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">{t("dirInsufficientData")}</p>
        </CardContent>
      </Card>
    );
  }

  // Build gaussian curve data: 51 x-points (0, 2, 4, ..., 100)
  const curves = seriesList.map(s => gaussianCurvePoints(s.buckets));
  const chartData = Array.from({ length: 51 }, (_, idx) => {
    const row: Record<string, any> = { x: `${idx * 2}%` };
    seriesList.forEach((s, i) => { row[s.label] = curves[i][idx]; });
    return row;
  });

  // Bar chart: use barSeries if provided, otherwise same as curves
  const barList = barSeries ?? seriesList;
  const avgBarData = barList.map((s, idx) => {
    const total = s.buckets.reduce((sum, b) => sum + b.count, 0);
    const avg = total === 0 ? 0 : Math.round(
      s.buckets.reduce((sum, b, i) => sum + (i * 10 + 5) * b.count, 0) / total
    );
    return { label: s.label, avg, color: LINE_COLORS[idx % LINE_COLORS.length] };
  });

  const multiSeries = seriesList.length > 1;
  const baseFillOpacity = multiSeries ? 0.09 : 0.3;

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{t("dirChartScoreDistribution")}</CardTitle>
          <div className="flex items-center gap-1">
          {multiSeries && (
            <select
              value={effectiveKey || ""}
              onChange={(e) => setKey(e.target.value || null)}
              className="text-xs border border-input rounded px-1.5 py-0.5 bg-background text-foreground"
            >
              <option value="">{t("dirFilterAll")}</option>
              {seriesList.map(s => (
                <option key={s.label} value={s.label}>{s.label}</option>
              ))}
            </select>
          )}
          <ExportBtn
            onClick={() => chartRef.current && exportChartAsPNG(chartRef.current, "taqsimot")}
            title={t("dirExportPng")}
          />
          </div>
        </div>
      </CardHeader>
      <CardContent ref={chartRef} className="flex-1 flex flex-col min-h-0">
        <div style={{ height: 200 }} className="w-full flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 5, left: -20, bottom: 5 }}>
              <defs>
                {seriesList.map((s, idx) => {
                  const color = LINE_COLORS[idx % LINE_COLORS.length];
                  return (
                    <linearGradient key={s.label} id={`distGrad-${uid}-${idx}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={color} stopOpacity={baseFillOpacity * 1.5} />
                      <stop offset="95%" stopColor={color} stopOpacity={0.01} />
                    </linearGradient>
                  );
                })}
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" vertical={false} />
              <XAxis
                dataKey="x"
                tick={<PlainTick fontSize={9} dy={4} />}
                tickLine={false}
                axisLine={false}
                ticks={["0%", "20%", "40%", "60%", "80%", "100%"]}
              />
              <YAxis allowDecimals={false} tick={<PlainTick fontSize={10} textAnchor="end" />} tickLine={false} axisLine={false} />
              <Tooltip
                content={({ active, label }) => {
                  if (!active || label == null) return null;
                  const xVal = parseInt(String(label));
                  const bucketIdx = Math.min(Math.floor(xVal / 10), 9);
                  const visibleSeries = effectiveKey
                    ? seriesList.filter(s => s.label === effectiveKey)
                    : seriesList;
                  return (
                    <div style={{
                      borderRadius: "8px",
                      border: "1px solid hsl(var(--border))",
                      background: "hsl(var(--popover))",
                      color: "hsl(var(--popover-foreground))",
                      fontSize: "11px",
                      boxShadow: "0 8px 24px rgba(15, 23, 42, 0.18)",
                      padding: "8px 12px",
                    }}>
                      <p style={{ fontWeight: 600, marginBottom: 4 }}>{bucketIdx * 10}–{(bucketIdx + 1) * 10}%</p>
                      {visibleSeries.map((s) => {
                        const i = seriesList.indexOf(s);
                        return (
                          <p key={s.label} style={{ color: LINE_COLORS[i % LINE_COLORS.length] }}>
                            {s.label}: {s.buckets[bucketIdx]?.count ?? 0} ta
                          </p>
                        );
                      })}
                    </div>
                  );
                }}
              />
              {seriesList.map((s, idx) => {
                const color = LINE_COLORS[idx % LINE_COLORS.length];
                const dimmed = effectiveKey !== null && effectiveKey !== s.label;
                return (
                  <Area
                    key={s.label}
                    type="monotone"
                    dataKey={s.label}
                    name={s.label}
                    stroke={color}
                    strokeWidth={effectiveKey === s.label ? 3 : 2}
                    strokeOpacity={dimmed ? 0.15 : 1}
                    fill={`url(#distGrad-${uid}-${idx})`}
                    fillOpacity={dimmed ? 0.05 : 1}
                    dot={false}
                    activeDot={dimmed ? false : { r: 4, fill: color }}
                  />
                );
              })}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {/* Bar chart */}
        {showBarChart && (
        <div className="mt-3 flex-1 min-h-0 flex flex-col">
          <p className="text-[9px] text-muted-foreground mb-1 flex-shrink-0">{t("dirChartAverageScore")}</p>
          <div className="flex-1 min-h-[120px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={avgBarData}
                margin={{ top: 4, right: 4, left: 0, bottom: avgBarData.length > 8 ? 28 : 14 }}
                barCategoryGap="20%"
                barSize={20}
              >
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  angle={avgBarData.length > 8 ? -40 : 0}
                  textAnchor={avgBarData.length > 8 ? "end" : "middle"}
                  height={avgBarData.length > 8 ? 34 : 16}
                  tickFormatter={(v: string) => String(v).replace(/-sinf.*$/, "").trim()}
                />
                <YAxis domain={[0, 100]} hide width={0} />
                <Tooltip
                  cursor={false}
                  wrapperStyle={{ background: "transparent", border: "none", padding: 0 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as typeof avgBarData[0];
                    return (
                      <div style={{
                        borderRadius: "6px",
                        border: "1px solid hsl(var(--border))",
                        background: "hsl(var(--popover))",
                        color: "hsl(var(--popover-foreground))",
                        fontSize: "10px",
                        padding: "4px 8px",
                      }}>
                        <p style={{ color: d.color, fontWeight: 600 }}>{d.label}: {d.avg}%</p>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="avg"
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                  maxBarSize={22}
                  activeBar={(props: any) => (
                    <Rectangle
                      {...props}
                      fill={lightenColor(String(props.fill || props.payload?.color || "#2563eb"))}
                      fillOpacity={props.fillOpacity ?? 1}
                      stroke="none"
                    />
                  )}
                  label={{ position: "top", fontSize: 8, fill: "hsl(var(--muted-foreground))", formatter: (v: unknown) => `${v}%` }}
                >
                  {avgBarData.map((d, i) => (
                    <Cell
                      key={d.label}
                      fill={d.color}
                      fillOpacity={!barSeries && effectiveKey !== null && effectiveKey !== d.label ? 0.15 : 0.85}
                      onClick={!barSeries ? () => setKey(effectiveKey === d.label ? null : d.label) : undefined}
                      style={!barSeries ? { cursor: "pointer" } : undefined}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        )}
        {/* Legend — clickable to toggle highlight */}
        {multiSeries && (
          <div className="flex gap-3 mt-2 justify-center flex-wrap text-[10px] flex-shrink-0">
            {seriesList.map((s, idx) => (
              <div
                key={s.label}
                className="flex items-center gap-1 cursor-pointer select-none"
                style={{ opacity: effectiveKey !== null && effectiveKey !== s.label ? 0.35 : 1 }}
                onClick={() => setKey(effectiveKey === s.label ? null : s.label)}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: LINE_COLORS[idx % LINE_COLORS.length] }} />
                <span className="text-muted-foreground">{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
