"use client";

import { useMemo, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n/language-context";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

function PlainTick({ x, y, payload, textAnchor = "middle", fontSize = 11, dy = 0, format }: any) {
  const text = format ? format(payload.value) : String(payload.value);
  return (
    <g transform={`translate(${x},${y + dy})`}>
      <text x={0} y={4} textAnchor={textAnchor} fontSize={fontSize} fill="hsl(var(--foreground))">{text}</text>
    </g>
  );
}
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp } from "lucide-react";
import { useCachedFetch } from "@/lib/director/use-cached-fetch";
import { ExportBtn } from "@/components/director/ExportBtn";
import { exportChartAsPNG } from "@/lib/director/export-client";
import { chartLegendStyle, chartTooltipEntryStyle, chartTooltipLabelStyle, chartTooltipStyle } from "@/lib/director/chart-theme";
import type { GradeSelection } from "@/components/director/ExploreTab";

interface SeriesItem {
  key: string;
  label: string;
  grade: number;
  thread: string;
  subject: string;
  data: { month: string; avgScore: number | null; count: number }[];
}

interface PerformanceData {
  series: SeriesItem[];
  months: string[];
  availableGrades: number[];
}

export const LINE_COLORS = [
  "#2563eb", "#16a34a", "#ea580c", "#9333ea",
  "#0891b2", "#e11d48", "#ca8a04", "#0d9488",
  "#6366f1", "#84cc16", "#f43f5e", "#06b6d4",
];

const MONTH_KEYS: Record<string, string> = {
  "01": "dirMonJan", "02": "dirMonFeb", "03": "dirMonMar", "04": "dirMonApr",
  "05": "dirMonMay", "06": "dirMonJun", "07": "dirMonJul", "08": "dirMonAug",
  "09": "dirMonSep", "10": "dirMonOct", "11": "dirMonNov", "12": "dirMonDec",
};

function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
}

function aggregateSeries(
  seriesList: SeriesItem[],
  months: string[],
  label: string,
  key: string,
): { label: string; key: string; data: { month: string; avgScore: number | null; count: number }[] } {
  return {
    label,
    key,
    data: months.map((month) => {
      let totalScore = 0;
      let totalCount = 0;
      for (const s of seriesList) {
        const point = s.data.find((d) => d.month === month);
        if (point?.avgScore !== null && point?.avgScore !== undefined && point.count > 0) {
          totalScore += point.avgScore * point.count;
          totalCount += point.count;
        }
      }
      return {
        month,
        avgScore: totalCount > 0 ? Math.round((totalScore / totalCount) * 10) / 10 : null,
        count: totalCount,
      };
    }),
  };
}

interface ClassInfo {
  id: string;
  name: string;
  subject: string | null;
}

interface PerformanceChartProps {
  selections: GradeSelection[];
  subjectFilters?: string[];
  monthFrom?: string;
  monthTo?: string;
  classes?: ClassInfo[];
  highlightValue?: string | null;
  onHighlightChange?: (v: string | null) => void;
}

export function PerformanceChart({
  selections, subjectFilters = [], monthFrom, monthTo, classes,
  highlightValue, onHighlightChange,
}: PerformanceChartProps) {
  const { t } = useLanguage();

  const formatMonth = (monthKey: string): string => {
    const [year, month] = monthKey.split("-");
    const key = MONTH_KEYS[month] as any;
    return `${key ? t(key) : month} ${year}`;
  };

  const perfUrl = (() => {
    const p = new URLSearchParams();
    if (monthFrom) p.set("from", monthFrom);
    if (monthTo) p.set("to", monthTo);
    const qs = p.toString();
    return qs ? `/api/director/performance?${qs}` : "/api/director/performance";
  })();
  const { data, loading } = useCachedFetch<PerformanceData>(perfUrl, { keepPreviousData: true });
  const [internalLabel, setInternalLabel] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  // Support controlled (external) and uncontrolled (internal) modes
  const isControlled = highlightValue !== undefined;
  const rawLabel = isControlled ? (highlightValue ?? null) : internalLabel;
  const setLabel = (v: string | null) => {
    if (isControlled) onHighlightChange?.(v);
    else setInternalLabel(v);
  };

  const { displaySeries, displayMonths } = useMemo(() => {
    if (!data || data.series.length === 0 || data.months.length < 1) {
      return { displaySeries: [], displayMonths: [] };
    }

    // Months come pre-filtered by the API (date range applied server-side)
    let months = data.months;

    // Apply subject filters globally
    const hasSubjectFilter = subjectFilters.length > 0;
    const workingSeries = hasSubjectFilter
      ? data.series.filter((s) => subjectFilters.includes(s.subject))
      : data.series;

    // No selections → one aggregate school line
    if (selections.length === 0) {
      const agg = aggregateSeries(workingSeries, months, t("dirChartOverall"), "school-avg");
      const trimmedMonths = months.filter(m => {
        const pt = agg.data.find(d => d.month === m);
        return pt?.avgScore != null && pt.count > 0;
      });
      return { displaySeries: [agg], displayMonths: trimmedMonths };
    }

    const result: ReturnType<typeof aggregateSeries>[] = [];
    const multiSubjects = hasSubjectFilter && subjectFilters.length > 1;

    // Multi-subjects + no variant → per-subject lines (aggregate across grades)
    if (multiSubjects && selections.every(s => s.subclasses.length === 0)) {
      for (const subj of subjectFilters) {
        const subjSeries = workingSeries.filter(s =>
          selections.some(sel => parseInt(sel.grade) === s.grade) && s.subject === subj
        );
        if (subjSeries.length === 0) continue;
        result.push(aggregateSeries(subjSeries, months, subj, `subj-${subj}`));
      }
    } else {
      for (const sel of selections) {
        const gradeNum = parseInt(sel.grade);
        const gradeSeries = workingSeries.filter((s) => s.grade === gradeNum);

        if (sel.subclasses.length === 0) {
          // Aggregate entire grade into 1 line
          result.push(
            aggregateSeries(gradeSeries, months, `${sel.grade}-sinf`, `grade-${sel.grade}`)
          );
        } else {
          // Specific variants selected
          for (const thread of sel.subclasses) {
            const threadSeries = gradeSeries.filter((s) => s.thread === thread);
            if (threadSeries.length === 0) continue;

            if (multiSubjects) {
              // Multi-subjects + variant → per-subject within variant
              for (const subj of subjectFilters) {
                const subjSeries = threadSeries.filter(s => s.subject === subj);
                if (subjSeries.length === 0) continue;
                result.push(
                  aggregateSeries(subjSeries, months, `${sel.grade}${thread} — ${subj}`, `${sel.grade}-${thread}-${subj}`)
                );
              }
            } else {
              // 0 or 1 subject → 1 aggregate line per variant
              result.push(
                aggregateSeries(threadSeries, months, `${sel.grade}${thread}`, `${sel.grade}-${thread}`)
              );
            }
          }
        }
      }
    }

    const trimmedMonths = months.filter(m =>
      result.some(s => {
        const pt = s.data.find(d => d.month === m);
        return pt?.avgScore != null && pt.count > 0;
      })
    );
    return { displaySeries: result, displayMonths: trimmedMonths };
  }, [data, selections, subjectFilters, t]);

  // Reset label if it's no longer in current series
  const effectiveLabel = rawLabel && displaySeries.find(s => s.label === rawLabel) ? rawLabel : null;

  // Auto Y domain: snap to nearest 10 (floor min, ceil max)
  const yDomain = useMemo((): [number, number] => {
    if (displaySeries.length === 0 || displayMonths.length === 0) return [0, 100];
    const allValues = displaySeries.flatMap((s) =>
      displayMonths.flatMap((m) => {
        const pt = s.data.find((d) => d.month === m);
        return pt?.avgScore != null && pt.count > 0 ? [pt.avgScore] : [];
      })
    );
    if (allValues.length === 0) return [0, 100];
    const rawMin = Math.min(...allValues);
    const rawMax = Math.max(...allValues);
    const min = Math.max(0, Math.floor(rawMin / 10) * 10);
    const max = Math.min(100, Math.ceil(rawMax / 10) * 10);
    return [min === max ? Math.max(0, min - 10) : min, max];
  }, [displaySeries, displayMonths]);

  // Explicit ticks at every 10% within domain
  const yTicks = useMemo(() => {
    const [min, max] = yDomain;
    const ticks: number[] = [];
    for (let v = min; v <= max; v += 10) ticks.push(v);
    return ticks;
  }, [yDomain]);

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-5 pb-4">
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || displaySeries.length === 0 || displayMonths.length < 1) {
    if (selections.length > 0) {
      return (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">{t("dirChartNoDataForSelection")}</p>
          </CardContent>
        </Card>
      );
    }
    return null;
  }


  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">
              {selections.length > 0 ? t("dirChartSelectedTrend") : t("dirChartPerformanceTrend")}
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {displaySeries.length > 1 && (
              <select
                value={effectiveLabel || ""}
                onChange={(e) => setLabel(e.target.value || null)}
                className="text-xs border border-input rounded px-1.5 py-0.5 bg-background text-foreground"
              >
                <option value="">{t("dirFilterAll")}</option>
                {displaySeries.map(s => (
                  <option key={s.key} value={s.label}>{s.label}</option>
                ))}
              </select>
            )}
            <ExportBtn
              onClick={() => chartRef.current && exportChartAsPNG(chartRef.current, "dinamika")}
              title={t("dirExportPng")}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent ref={chartRef}>
        {(() => {
            const chartData = displayMonths.map((month) => {
              const row: Record<string, any> = { month: formatMonth(month) };
              for (const s of displaySeries) {
                const point = s.data.find((d) => d.month === month);
                row[s.key] = point?.avgScore ?? null;
              }
              return row;
            });

            return (
              <div style={{ height: 560 }} className="w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartData}
                    margin={{ top: 5, right: 10, left: -15, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="month" tick={<PlainTick fontSize={11} dy={4} />} tickLine={false} axisLine={false} />
                    <YAxis
                      domain={yDomain}
                      ticks={yTicks}
                      tick={<PlainTick fontSize={11} textAnchor="end" format={(v: number) => `${v}%`} />}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      wrapperStyle={{ background: "transparent", border: "none", padding: 0 }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const entries = effectiveLabel
                          ? payload.filter((p) => displaySeries.find(ds => ds.key === String(p.dataKey))?.label === effectiveLabel && p.value != null)
                          : payload.filter(p => p.value != null);
                        if (entries.length === 0) return null;
                        return (
                          <div style={{ ...chartTooltipStyle, fontSize: "11px", maxWidth: "240px" }}>
                            <p style={chartTooltipLabelStyle}>{label}</p>
                            {entries.map((entry) => {
                              const s = displaySeries.find((x) => x.key === entry.dataKey);
                              return (
                                <p key={String(entry.dataKey)} style={chartTooltipEntryStyle((entry.color as string) || undefined)}>
                                  {s?.label || String(entry.dataKey)}: {entry.value}%
                                </p>
                              );
                            })}
                          </div>
                        );
                      }}
                    />
                    {displaySeries.length > 1 && (
                      <Legend
                        wrapperStyle={chartLegendStyle("11px", "8px")}
                        iconType="circle"
                        iconSize={8}
                        formatter={(value) => {
                          const s = displaySeries.find((x) => x.key === value);
                          return s?.label || value;
                        }}
                      />
                    )}
                    {displaySeries.map((s, i) => {
                      const color = LINE_COLORS[i % LINE_COLORS.length];
                      const dimmed = effectiveLabel !== null && effectiveLabel !== s.label;
                      return (
                        <Line
                          key={s.key}
                          type="monotone"
                          dataKey={s.key}
                          stroke={color}
                          strokeWidth={effectiveLabel === s.label ? 3 : 2}
                          strokeOpacity={dimmed ? 0.2 : 1}
                          dot={{ r: 3, fill: color, fillOpacity: dimmed ? 0.2 : 1 }}
                          activeDot={dimmed ? false : { r: 5 }}
                          connectNulls
                          name={s.key}
                        />
                      );
                    })}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            );
          })()}

      </CardContent>
    </Card>
  );
}
