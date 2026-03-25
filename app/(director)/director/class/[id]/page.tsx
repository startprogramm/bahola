"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, ExternalLink, ChevronDown, X, Printer,
} from "lucide-react";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, AreaChart, Area,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { normalizeImageUrl } from "@/lib/utils";
import { useCachedFetch } from "@/lib/director/use-cached-fetch";
import { LINE_COLORS } from "@/components/director/PerformanceChart";
import { chartLegendStyle, chartTooltipEntryStyle, chartTooltipLabelStyle, chartTooltipStyle } from "@/lib/director/chart-theme";
import type { DirectorClass, TrendPoint, ScoreBucket } from "@/lib/director/types";
import { formatScore, scoreColorForGrade, isCambridgeGrade } from "@/lib/director/cambridge";
import { useLanguage } from "@/lib/i18n/language-context";

/* ── Tick helpers ──────────────────────────────────────────────── */
function PlainTick({ x, y, payload, textAnchor = "middle", fontSize = 11, dy = 0, format }: any) {
  const text = format ? format(payload.value) : String(payload.value);
  return (
    <g transform={`translate(${x},${y + dy})`}>
      <text x={0} y={4} textAnchor={textAnchor} fontSize={fontSize} fill="hsl(var(--foreground))">{text}</text>
    </g>
  );
}

function PolarBgTick({ x, y, cx, cy, payload, fontSize = 12 }: any) {
  const text = String(payload.value);
  const dx = x - (cx ?? 0);
  const dy = y - (cy ?? 0);
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = (cx ?? 0) + (dx / len) * (len + 14);
  const ny = (cy ?? 0) + (dy / len) * (len + 14);
  return (
    <text x={nx} y={ny} textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fontWeight={500} fill="hsl(var(--foreground))" style={{ textShadow: "0 0 4px hsl(var(--background)), 0 0 4px hsl(var(--background))" }}>
      {text}
    </text>
  );
}

function RadiusBgTick({ x, y, payload }: any) {
  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={9} fill="hsl(var(--muted-foreground))">
      {payload.value}
    </text>
  );
}

/* ── Gaussian helper (for distribution chart) ────────────────── */
function gaussianCurvePoints(buckets: ScoreBucket[]): number[] {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  if (total === 0) return Array(51).fill(0);
  const mean = buckets.reduce((s, b, i) => s + (i * 10 + 5) * b.count, 0) / total;
  const variance = buckets.reduce((s, b, i) => s + b.count * ((i * 10 + 5 - mean) ** 2), 0) / total;
  const sigma = Math.sqrt(Math.max(variance, 25));
  const K = total * 10;
  return Array.from({ length: 51 }, (_, idx) => {
    const x = idx * 2;
    return (Math.exp(-0.5 * ((x - mean) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI))) * K;
  });
}

/* ── Types ─────────────────────────────────────────────────────── */
interface ClassStudent {
  id: string;
  name: string;
  email: string | null;
  avatar: string | null;
  subclass: string | null;
  avgScore: number | null;
  gradedCount: number;
  totalAssessments: number;
  variantClassId?: string;
}

interface DistGroup {
  subclass: string;
  buckets: ScoreBucket[];
}

interface TrendPointWithLines extends TrendPoint {
  lines?: Record<string, number | null>;
}

function getDateRange(preset: string): { from: string; to: string } {
  const now = new Date();
  const m = now.getMonth(); // 0-based
  const y = now.getFullYear();
  const fmt = (yr: number, mo: number, day: number) => `${yr}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const today = fmt(y, m + 1, now.getDate());
  const ayear = m >= 8 ? y : y - 1;
  if (preset === "month") return { from: fmt(m === 0 ? y - 1 : y, m === 0 ? 12 : m, 1), to: today };
  if (preset === "quarter") {
    if (m >= 8 && m <= 9) return { from: fmt(y, 9, 1), to: today };
    if (m >= 10 && m <= 11) return { from: fmt(y, 11, 1), to: today };
    if (m >= 0 && m <= 2) return { from: fmt(y, 1, 1), to: today };
    if (m >= 3 && m <= 5) return { from: fmt(y, 4, 1), to: today };
    return { from: fmt(y, 4, 1), to: fmt(y, 6, 30) };
  }
  if (preset === "semester") {
    if (m >= 8) return { from: fmt(y, 9, 1), to: today };
    if (m <= 5) return { from: fmt(y, 1, 1), to: today };
    return { from: fmt(y, 1, 1), to: fmt(y, 6, 30) };
  }
  if (preset === "year") return { from: fmt(ayear, 9, 1), to: today };
  return { from: "", to: "" };
}

/* ── Month label helpers ────────────────────────────────────────── */
const MONTH_KEYS: Record<string, string> = {
  "01": "dirMonJan", "02": "dirMonFeb", "03": "dirMonMar", "04": "dirMonApr",
  "05": "dirMonMay", "06": "dirMonJun", "07": "dirMonJul", "08": "dirMonAug",
  "09": "dirMonSep", "10": "dirMonOct", "11": "dirMonNov", "12": "dirMonDec",
};

/* ── Page ───────────────────────────────────────────────────────── */
export default function DirectorClassPage() {
  const { id: classId } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();

  const fmtMonth = (m: string) => {
    const [y, mo] = m.split("-");
    return `${t(MONTH_KEYS[mo] as any) || mo} ${y}`;
  };
  const allIdsParam = searchParams?.get("allIds") || "";
  const allClassIds = allIdsParam ? allIdsParam.split(",").filter(Boolean) : [classId];

  // ── Global filters (apply to all charts + students) ──────────
  const [variantFilter, setVariantFilter] = useState<string[]>([]);
  const [variantDropdownOpen, setVariantDropdownOpen] = useState(false);
  const variantDropdownRef = useRef<HTMLDivElement>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [datePreset, setDatePreset] = useState("all");
  const [spiderView, setSpiderView] = useState<string>("overall");
  const [studentFilter, setStudentFilter] = useState<"all" | "weak" | "good" | "excellent">("all");
  const [classChartHighlight, setClassChartHighlight] = useState<string | null>(null);

  /* ── Data fetching ─────────────────────────────────────────── */
  const { data: classesData, loading: classesLoading } = useCachedFetch<{ classes: DirectorClass[] }>(
    classId ? `/api/director/classes?id=${classId}` : null
  );

  const studentsUrl = classId
    ? (allClassIds.length > 1
        ? `/api/director/class-students?classIds=${allClassIds.join(",")}`
        : `/api/director/class-students?classId=${classId}`)
    : null;
  const { data: studentsData } = useCachedFetch<{ students: ClassStudent[] }>(studentsUrl);

  const { data: trendData, loading: trendLoading } = useCachedFetch<{ trend: TrendPointWithLines[] }>(
    classId ? `/api/director/trends?classId=${classId}` : null
  );

  const cls = useMemo(() => {
    if (!classesData?.classes || !classId) return null;
    return classesData.classes.find((c) => c.id === classId) || null;
  }, [classesData, classId]);

  const classInfo = useMemo(() => {
    if (!cls) return null;
    const m = cls.name.match(/^(\d+)([A-Z])?-sinf\s*(.*)$/);
    if (!m) return null;
    return { grade: m[1], subclass: m[2] || null, subject: m[3] || cls.subject || "" };
  }, [cls]);

  const students = studentsData?.students || [];

  const availableSubclasses = useMemo(() => {
    const subs = new Set<string>();
    for (const s of students) { if (s.subclass) subs.add(s.subclass); }
    return Array.from(subs).sort();
  }, [students]);

  const hasSubclassFilter = availableSubclasses.length > 1;

  // Performance data — used for comparison chart and allThreads
  const { data: perfData } = useCachedFetch<{
    series: { key: string; label: string; grade: number; thread: string; subject: string; data: { month: string; avgScore: number | null; count: number }[] }[];
    months: string[];
  }>(
    classInfo?.grade && classInfo?.subject
      ? `/api/director/performance`
      : null
  );

  const allThreads = useMemo(() => {
    if (!perfData?.series || !classInfo?.grade || !classInfo?.subject) return [];
    return Array.from(new Set(
      perfData.series
        .filter((s) => String(s.grade) === classInfo.grade && s.subject === classInfo.subject)
        .map((s) => s.thread)
    )).sort();
  }, [perfData, classInfo]);

  // Auto-fill variant filter when comparison data loads
  useEffect(() => {
    if (allThreads.length > 0 && variantFilter.length === 0) {
      setVariantFilter(allThreads);
    }
  }, [allThreads]); // eslint-disable-line react-hooks/exhaustive-deps

  // Active subclasses for student/distribution filtering
  const activeSubclassFilters = useMemo(
    () => variantFilter.filter((v) => availableSubclasses.includes(v)),
    [variantFilter, availableSubclasses]
  );

  // Distribution — use grade+subject+variants so each ticked variant gets its own curve
  const distUrl = useMemo(() => {
    if (!classId) return null;
    if (classInfo?.grade && classInfo?.subject && variantFilter.length > 0) {
      return `/api/director/score-distribution?grade=${classInfo.grade}&subject=${encodeURIComponent(classInfo.subject)}&subclass=${variantFilter.join(",")}`;
    }
    return `/api/director/score-distribution?classId=${classId}`;
  }, [classId, classInfo, variantFilter]);
  const { data: distData, loading: distLoading } = useCachedFetch<{ buckets?: ScoreBucket[]; groups?: DistGroup[] }>(distUrl);

  // Group stats for spider charts (all selected variants)
  const { data: groupStatsData } = useCachedFetch<{
    groups: Record<string, { name: string; avg: number }[]>;
    gradeAvg: { name: string; avg: number }[];
  }>(
    classInfo?.grade && variantFilter.length > 0
      ? `/api/director/group-stats?grade=${classInfo.grade}&subclasses=${variantFilter.join(",")}`
      : null
  );

  /* ── Color helper (consistent with ExploreTab) ─────────────── */
  const variantColor = useCallback(
    (sc: string): string => {
      const idx = allThreads.indexOf(sc);
      return LINE_COLORS[Math.max(idx, 0) % LINE_COLORS.length];
    },
    [allThreads]
  );

  /* ── Close dropdown on outside click ───────────────────────── */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (variantDropdownRef.current && !variantDropdownRef.current.contains(e.target as Node)) {
        setVariantDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  /* ── Derived state ──────────────────────────────────────────── */
  const trend = trendData?.trend || [];

  const trendDelta = useMemo(() => {
    if (trend.length < 2) return null;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const recent = trend.filter((t) => t.date >= thirtyDaysAgo && t.avg !== null);
    const older = trend.filter((t) => t.date < thirtyDaysAgo && t.avg !== null);
    if (!recent.length || !older.length) return null;
    const recentAvg = recent.reduce((s, t) => s + (t.avg || 0), 0) / recent.length;
    const olderAvg = older.reduce((s, t) => s + (t.avg || 0), 0) / older.length;
    return Math.round(recentAvg - olderAvg);
  }, [trend]);

  const filteredStudents = useMemo(() => {
    if (!hasSubclassFilter || activeSubclassFilters.length === 0) return students;
    return students.filter((s) => s.subclass && activeSubclassFilters.includes(s.subclass));
  }, [students, activeSubclassFilters, hasSubclassFilter]);

  const studentSummary = useMemo(() => {
    let weak = 0, good = 0, excellent = 0;
    for (const s of filteredStudents) {
      if (s.avgScore === null) continue;
      if (s.avgScore < 70) weak++;
      else if (s.avgScore < 85) good++;
      else excellent++;
    }
    return { weak, good, excellent };
  }, [filteredStudents]);

  const displayStudents = useMemo(() => {
    if (studentFilter === "all") return filteredStudents;
    return filteredStudents.filter((s) => {
      if (s.avgScore === null) return false;
      if (studentFilter === "weak") return s.avgScore < 70;
      if (studentFilter === "good") return s.avgScore >= 70 && s.avgScore < 85;
      return s.avgScore >= 85;
    });
  }, [filteredStudents, studentFilter]);

  // Title: strip variant letter when showing all classes combined
  const displayTitle = useMemo(() => {
    if (allClassIds.length > 1 && classInfo) {
      return `${classInfo.grade}-sinf ${classInfo.subject}`.trim();
    }
    return cls?.name || "";
  }, [allClassIds.length, classInfo, cls]);

  // Performance series filtered by current class's grade+subject+variantFilter
  const variantPerfSeries = useMemo(() => {
    if (!perfData?.series || !classInfo?.grade || !classInfo?.subject) return [];
    return perfData.series
      .filter(
        (s) =>
          String(s.grade) === classInfo.grade &&
          s.subject === classInfo.subject &&
          variantFilter.includes(s.thread)
      )
      .map((s) => ({ ...s, label: s.thread }));
  }, [perfData, classInfo, variantFilter]);

  const variantPerfMonths = useMemo(() => {
    if (!perfData?.months || variantPerfSeries.length === 0) return [];
    return perfData.months.filter((m) =>
      variantPerfSeries.some((s) => {
        const pt = s.data.find((d) => d.month === m);
        return pt?.avgScore != null && pt.count > 0;
      })
    );
  }, [perfData?.months, variantPerfSeries]);

  // Y-axis domain for comparison chart — capped to actual data range
  const variantYDomain = useMemo((): [number, number] => {
    const allScores = variantPerfSeries
      .flatMap((s) => s.data.map((d) => d.avgScore))
      .filter((v): v is number => v != null);
    if (allScores.length === 0) return [0, 100];
    const minScore = Math.min(...allScores);
    const maxScore = Math.max(...allScores);
    const yMin = Math.max(0, Math.floor((minScore - 5) / 5) * 5);
    const yMax = Math.min(100, Math.ceil((maxScore + 5) / 5) * 5);
    return [yMin, yMax];
  }, [variantPerfSeries]);

  // Spider data
  const spiderCombinedData = useMemo(() => {
    if (!groupStatsData?.gradeAvg?.length) return [];
    return groupStatsData.gradeAvg.map((ga) => {
      const row: Record<string, any> = { name: ga.name, gradeAvg: Math.min(ga.avg, 100) };
      for (const sc of variantFilter) {
        row[sc] = Math.min(groupStatsData.groups[sc]?.find((s) => s.name === ga.name)?.avg ?? 0, 100);
      }
      return row;
    });
  }, [groupStatsData, variantFilter]);

  // Overall aggregate spider data: average across all selected variants
  const spiderOverallData = useMemo(() => {
    if (!groupStatsData?.gradeAvg?.length || variantFilter.length === 0) return [];
    return groupStatsData.gradeAvg.map((ga) => {
      let totalAvg = 0;
      let count = 0;
      for (const sc of variantFilter) {
        const val = groupStatsData.groups[sc]?.find((s) => s.name === ga.name)?.avg;
        if (val != null) { totalAvg += val; count++; }
      }
      return {
        name: ga.name,
        overall: count > 0 ? Math.min(Math.round(totalAvg / count), 100) : 0,
        gradeAvg: Math.min(ga.avg, 100),
      };
    });
  }, [groupStatsData, variantFilter]);

  const spiderSeparateData = useMemo(() => {
    if (!groupStatsData?.gradeAvg?.length) return {} as Record<string, { name: string; groupAvg: number; gradeAvg: number }[]>;
    return Object.fromEntries(
      variantFilter.map((sc) => [
        sc,
        groupStatsData.gradeAvg.map((ga) => ({
          name: ga.name,
          groupAvg: Math.min(groupStatsData.groups[sc]?.find((s) => s.name === ga.name)?.avg ?? 0, 100),
          gradeAvg: Math.min(ga.avg, 100),
        })),
      ])
    ) as Record<string, { name: string; groupAvg: number; gradeAvg: number }[]>;
  }, [groupStatsData, variantFilter]);

  // Distribution chart series (Gaussian) — per selected variant
  const distChartSeries = useMemo(() => {
    if (distData?.groups && variantFilter.length > 0) {
      return distData.groups
        .filter((g) => variantFilter.includes(g.subclass))
        .map((g) => ({ label: g.subclass, buckets: g.buckets }));
    }
    if (distData?.buckets) {
      return [{ label: cls?.name || "Hammasi", buckets: distData.buckets }];
    }
    return [];
  }, [distData, variantFilter, cls]);

  const distGaussianData = useMemo(() => {
    if (distChartSeries.length === 0) return [];
    const curves = distChartSeries.map((s) => gaussianCurvePoints(s.buckets));
    return Array.from({ length: 51 }, (_, idx) => {
      const row: Record<string, any> = { x: `${idx * 2}%` };
      distChartSeries.forEach((s, i) => { row[s.label] = curves[i][idx]; });
      return row;
    });
  }, [distChartSeries]);

  const hasDistData = distChartSeries.some((s) => s.buckets.some((b) => b.count > 0));

  /* ── Loading / not found ────────────────────────────────────── */
  const loading = classesLoading || trendLoading;
  if (loading) {
    return (
      <div className="px-6 py-6 space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded" />
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {[1,2,3,4].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (!cls) {
    return (
      <div className="px-6 py-6 text-center">
        <p className="text-muted-foreground">{t("dirClassNotFound")}</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/director")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> {t("dirBack")}
        </Button>
      </div>
    );
  }

  /* ── Helpers ────────────────────────────────────────────────── */
  const classGrade = classInfo?.grade ? parseInt(classInfo.grade, 10) : undefined;
  const scoreColor = (score: number | null) => scoreColorForGrade(score, classGrade);

  const toggleVariant = (v: string) =>
    setVariantFilter((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]);

  const multiSeries = distChartSeries.length > 1;
  const baseFillOpacity = multiSeries ? 0.09 : 0.3;
  const distSeriesColor = (label: string) =>
    multiSeries ? variantColor(label) : "#2563eb";

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <div className="px-6 py-6 space-y-6">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push("/director")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">{displayTitle}</h1>
            <p className="text-sm text-muted-foreground">{t("dirLabelTeacher")} {cls.teacher.name}</p>
            {cls && (
              <div className="flex items-center gap-4 mt-1">
                <span className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{cls.studentCount}</span> o&apos;quvchi
                </span>
                {trendDelta !== null && (
                  <span className={`text-sm font-medium ${trendDelta >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                    {trendDelta > 0 ? "+" : ""}{trendDelta}% trend
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Date preset filter */}
          <div className="flex gap-1">
            {([
              { key: "all", label: t("dirDateAll") },
              { key: "year", label: t("dirDateYear") },
              { key: "semester", label: t("dirDateSemester") },
              { key: "quarter", label: t("dirDateQuarter") },
              { key: "month", label: t("dirDateMonth") },
            ] as { key: string; label: string }[]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => {
                  setDatePreset(key);
                  const { from, to } = getDateRange(key);
                  setDateFrom(from);
                  setDateTo(to);
                }}
                className={`px-2 py-1 rounded-md text-xs font-medium transition-colors h-8 ${
                  datePreset === key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Variant filter (only if multiple threads exist) */}
          {allThreads.length > 1 && (
            <div className="relative" ref={variantDropdownRef}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVariantDropdownOpen(!variantDropdownOpen)}
                className="h-8 text-xs gap-1"
              >
                {t("dirClassSections")} ({variantFilter.length}/{allThreads.length})
                <ChevronDown className={`h-3 w-3 transition-transform ${variantDropdownOpen ? "rotate-180" : ""}`} />
              </Button>
              {variantDropdownOpen && (
                <div className="absolute right-0 z-50 mt-1 w-40 bg-popover border rounded-lg shadow-lg p-2 space-y-1">
                  {allThreads.map((v) => (
                    <label key={v} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={variantFilter.includes(v)}
                        onChange={() => toggleVariant(v)}
                        className="rounded border-input"
                      />
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: variantColor(v) }} />
                      {v}
                    </label>
                  ))}
                  <button
                    className="w-full text-xs text-muted-foreground hover:text-foreground py-1 mt-1 border-t"
                    onClick={() => setVariantFilter(allThreads)}
                  >
                    {t("dirFilterSelectAll")}
                  </button>
                </div>
              )}
            </div>
          )}

          <Button variant="outline" size="sm" onClick={() => router.push(`/classes/${classId}`)}>
            <ExternalLink className="h-4 w-4 mr-1" />
            {t("dirClassPage")}
          </Button>
          <button
            data-no-print
            onClick={() => window.print()}
            title={t("dirPrintPdf")}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-input bg-background text-xs hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            <Printer className="h-3.5 w-3.5" />
            PDF
          </button>
        </div>
      </div>

      {/* ── Spider + Distribution + Comparison — 3-column grid ─── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">

        {/* ── Spider chart ──────────────────────────────────────── */}
        {spiderCombinedData.length >= 3 && variantFilter.length > 0 && (() => {
          const isOverall = spiderView === "overall";
          const selectedVariant = !isOverall ? spiderView : null;
          const spiderData = isOverall
            ? spiderOverallData
            : spiderSeparateData[spiderView] || [];
          const color = isOverall ? "#2563eb" : variantColor(spiderView);
          const dataKey = isOverall ? "overall" : "groupAvg";
          const label = isOverall ? t("dirChartOverall") : spiderView;

          return (
            <Card className="h-full flex flex-col overflow-hidden">
              <CardHeader className="pb-2 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{t("dirChartSubjectComparison")}</CardTitle>
                  {variantFilter.length > 1 && (
                    <select
                      value={spiderView}
                      onChange={(e) => setSpiderView(e.target.value)}
                      className="text-xs border border-input rounded px-1.5 py-0.5 bg-background text-foreground"
                    >
                      <option value="overall">{t("dirChartOverall")}</option>
                      {variantFilter.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 p-0 pb-2 px-2">
                <div className="h-full w-full min-h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={spiderData} cx="50%" cy="48%" outerRadius="65%">
                      <defs>
                        <linearGradient id="spiderActiveGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                          <stop offset="100%" stopColor={color} stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <PolarGrid stroke="hsl(var(--border))" strokeOpacity={0.6} />
                      <PolarAngleAxis dataKey="name" tick={<PolarBgTick fontSize={10} />} />
                      <PolarRadiusAxis angle={90} domain={[0, 100]} tick={<RadiusBgTick />} axisLine={false} allowDataOverflow={false} />
                      <Tooltip
                        contentStyle={{
                          ...chartTooltipStyle,
                          fontSize: "11px",
                          padding: "6px 10px",
                        }}
                      />
                      <Radar
                        name={`${classInfo?.grade}${t("dirStudentsGradeAverage")}`}
                        dataKey="gradeAvg"
                        stroke="#9333ea"
                        fill="#9333ea"
                        fillOpacity={0.04}
                        strokeWidth={1.5}
                        strokeDasharray="5 3"
                      />
                      <Radar
                        name={label}
                        dataKey={dataKey}
                        stroke={color}
                        fill="url(#spiderActiveGrad)"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: color, strokeWidth: 0 }}
                      />
                      <Legend
                        wrapperStyle={chartLegendStyle("9px", "2px")}
                        iconType="circle" iconSize={7}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* ── Ball taqsimoti (distribution) with highlight dropdown ── */}
        <Card className="h-full flex flex-col">
          <CardHeader className="pb-2 flex-shrink-0">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">{t("dirChartScoreDistribution")}</CardTitle>
              {multiSeries && distChartSeries.length > 1 && (
                <select
                  value={classChartHighlight || ""}
                  onChange={(e) => setClassChartHighlight(e.target.value || null)}
                  className="text-xs border border-input rounded px-1.5 py-0.5 bg-background text-foreground"
                >
                  <option value="">{t("dirFilterAll")}</option>
                  {distChartSeries.map(s => (
                    <option key={s.label} value={s.label}>{s.label}</option>
                  ))}
                </select>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex-1 min-h-0">
            {distLoading ? (
              <Skeleton className="h-44 w-full" />
            ) : !hasDistData ? (
              <p className="text-sm text-muted-foreground text-center py-12">{t("dirNoData")}</p>
            ) : (
              <>
                <div className="h-full w-full min-h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={distGaussianData} margin={{ top: 10, right: 5, left: -20, bottom: 5 }}>
                      <defs>
                        {distChartSeries.map((s, idx) => {
                          const color = distSeriesColor(s.label);
                          return (
                            <linearGradient key={s.label} id={`distGrad-${idx}`} x1="0" y1="0" x2="0" y2="1">
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
                          const visibleSeries = classChartHighlight
                            ? distChartSeries.filter(s => s.label === classChartHighlight)
                            : distChartSeries;
                          return (
                            <div style={{ ...chartTooltipStyle, fontSize: "11px", padding: "8px 12px" }}>
                              <p style={{ fontWeight: 600, marginBottom: 4 }}>{bucketIdx * 10}–{(bucketIdx + 1) * 10}%</p>
                              {visibleSeries.map((s) => {
                                const color = distSeriesColor(s.label);
                                return (
                                  <p key={s.label} style={chartTooltipEntryStyle(color)}>
                                    {multiSeries ? `${s.label}: ` : ""}{s.buckets[bucketIdx]?.count ?? 0} ta
                                  </p>
                                );
                              })}
                            </div>
                          );
                        }}
                      />
                      {distChartSeries.map((s, idx) => {
                        const color = distSeriesColor(s.label);
                        const dimmed = classChartHighlight !== null && classChartHighlight !== s.label;
                        return (
                          <Area
                            key={s.label}
                            type="monotone"
                            dataKey={s.label}
                            stroke={color}
                            strokeWidth={classChartHighlight === s.label ? 3 : 2}
                            strokeOpacity={dimmed ? 0.15 : 1}
                            fill={`url(#distGrad-${idx})`}
                            fillOpacity={dimmed ? 0.05 : 1}
                            dot={false}
                            activeDot={dimmed ? false : { r: 4, fill: color }}
                          />
                        );
                      })}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                {multiSeries && (
                  <div className="flex gap-3 mt-2 justify-center flex-wrap text-[10px]">
                    {distChartSeries.map((s) => (
                      <div
                        key={s.label}
                        className="flex items-center gap-1 cursor-pointer select-none"
                        style={{ opacity: classChartHighlight !== null && classChartHighlight !== s.label ? 0.35 : 1 }}
                        onClick={() => setClassChartHighlight(classChartHighlight === s.label ? null : s.label)}
                      >
                        <span className="w-2 h-2 rounded-full" style={{ background: distSeriesColor(s.label) }} />
                        <span className="text-muted-foreground">{s.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* ── Sinf bo'limlari taqqoslash (line chart) with highlight dropdown ── */}
        {variantPerfSeries.length > 0 && variantPerfMonths.length > 0 ? (
          <Card className="h-full flex flex-col">
            <CardHeader className="pb-2 flex-shrink-0">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm">{t("dirChartComparison")}</CardTitle>
                {variantPerfSeries.length > 1 && (
                  <select
                    value={classChartHighlight || ""}
                    onChange={(e) => setClassChartHighlight(e.target.value || null)}
                    className="text-xs border border-input rounded px-1.5 py-0.5 bg-background text-foreground"
                  >
                    <option value="">{t("dirFilterAll")}</option>
                    {variantPerfSeries.map(s => (
                      <option key={s.key} value={s.label}>{s.label}</option>
                    ))}
                  </select>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex-1 min-h-0">
              <div className="h-full w-full min-h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={variantPerfMonths.map((m) => {
                      const row: Record<string, any> = { month: fmtMonth(m) };
                      for (const s of variantPerfSeries) {
                        const pt = s.data.find((d) => d.month === m);
                        row[s.key] = pt?.avgScore ?? null;
                      }
                      return row;
                    })}
                    margin={{ top: 5, right: 10, left: -15, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis
                      domain={variantYDomain}
                      tick={<PlainTick fontSize={10} textAnchor="end" format={(v: number) => `${v}%`} />}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      wrapperStyle={{ background: "transparent", border: "none", padding: 0 }}
                      content={({ active, payload, label: lbl }) => {
                        if (!active || !payload?.length) return null;
                        const entries = classChartHighlight
                          ? payload.filter((p) => {
                              const s = variantPerfSeries.find((x) => x.key === p.dataKey);
                              return s?.label === classChartHighlight && p.value != null;
                            })
                          : payload.filter((p) => p.value != null);
                        if (entries.length === 0) return null;
                        return (
                          <div style={{ ...chartTooltipStyle, fontSize: "11px", padding: "6px 10px" }}>
                            <p style={chartTooltipLabelStyle}>{lbl}</p>
                            {entries.map((p) => {
                              const s = variantPerfSeries.find((x) => x.key === p.dataKey);
                              return <p key={String(p.dataKey)} style={chartTooltipEntryStyle(p.color as string)}>{s?.label || p.dataKey}: {p.value}%</p>;
                            })}
                          </div>
                        );
                      }}
                    />
                    {variantPerfSeries.map((s, i) => {
                      const color = LINE_COLORS[i % LINE_COLORS.length];
                      const dimmed = classChartHighlight !== null && classChartHighlight !== s.label;
                      return (
                        <Line
                          key={s.key}
                          type="monotone"
                          dataKey={s.key}
                          stroke={color}
                          strokeWidth={classChartHighlight === s.label ? 3 : 2}
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
              <div className="flex flex-wrap gap-3 mt-2 justify-center">
                {variantPerfSeries.map((s, i) => (
                  <div
                    key={s.key}
                    className="flex items-center gap-1.5 text-xs cursor-pointer select-none"
                    style={{ opacity: classChartHighlight !== null && classChartHighlight !== s.label ? 0.35 : 1 }}
                    onClick={() => setClassChartHighlight(classChartHighlight === s.label ? null : s.label)}
                  >
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: LINE_COLORS[i % LINE_COLORS.length] }} />
                    <span>{s.label}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div /> /* placeholder to maintain grid layout */
        )}
      </div>

      {/* ── Student summary tiles ───────────────────────────────── */}
      {filteredStudents.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">{t("dirClassSummary")}</h3>
          <div className="grid grid-cols-3 gap-3">
            {(["weak", "good", "excellent"] as const).map((level) => {
              const count = studentSummary[level];
              const isCamb = isCambridgeGrade(classGrade);
              const colors = {
                weak: { ring: "ring-red-500 border-red-300 bg-red-50/50 dark:bg-red-900/10", text: "text-red-600", label: isCamb ? `${t("dirPerfPoor")} (U-E)` : `${t("dirPerfPoor")} (<70%)` },
                good: { ring: "ring-yellow-500 border-yellow-300 bg-yellow-50/50 dark:bg-yellow-900/10", text: "text-yellow-600", label: isCamb ? `${t("dirPerfGood")} (D-B)` : `${t("dirPerfGood")} (70-84%)` },
                excellent: { ring: "ring-emerald-500 border-emerald-300 bg-emerald-50/50 dark:bg-emerald-900/10", text: "text-emerald-600", label: isCamb ? `${t("dirPerfExcellent")} (A-A*)` : `${t("dirPerfExcellent")} (≥85%)` },
              }[level];
              return (
                <button
                  key={level}
                  className={`rounded-lg border p-3 text-center transition-colors ${studentFilter === level ? `ring-2 ${colors.ring}` : "hover:bg-muted/50"}`}
                  onClick={() => setStudentFilter(studentFilter === level ? "all" : level)}
                >
                  <p className={`text-xl font-bold ${colors.text}`}>{count}</p>
                  <p className="text-[11px] text-muted-foreground">{colors.label}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Student list ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{t("dirStudents")} ({displayStudents.length})</CardTitle>
            {studentFilter !== "all" && (
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setStudentFilter("all")}
              >
                <X className="h-3 w-3" /> {t("dirFilterClearFilter")}
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {displayStudents.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">{t("dirStudentsNotFound")}</p>
          ) : (allClassIds.length > 1 || (hasSubclassFilter && activeSubclassFilters.length > 1)) ? (
            /* Separate columns by variant/subclass */
            (() => {
              const displaySubclasses = allClassIds.length > 1
                ? Array.from(new Set(displayStudents.map((s) => s.subclass).filter(Boolean) as string[])).sort()
                : activeSubclassFilters;
              return (
            <div className={`grid gap-4 ${displaySubclasses.length >= 4 ? "grid-cols-4" : displaySubclasses.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
              {displaySubclasses.map((sc) => {
                const scStudents = displayStudents.filter((s) => s.subclass === sc);
                const color = variantColor(sc);
                return (
                  <div key={sc}>
                    <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                      <span className="text-xs font-semibold" style={{ color }}>{sc} bo&apos;lim</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">{scStudents.length} ta</span>
                    </div>
                    {scStudents.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-2">—</p>
                    ) : (
                      scStudents.map((s, i) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between py-1.5 px-1 rounded hover:bg-muted/50 cursor-pointer"
                          onClick={() => router.push(`/director/student/${s.id}`)}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[10px] text-muted-foreground w-4 shrink-0">{i + 1}</span>
                            <Avatar className="h-6 w-6 shrink-0">
                              {s.avatar && <AvatarImage src={normalizeImageUrl(s.avatar)} alt={s.name} />}
                              <AvatarFallback className="text-[9px]">{s.name.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="text-xs font-medium truncate">{s.name}</p>
                              <p className="text-[10px] text-muted-foreground">{s.gradedCount} ta ish</p>
                            </div>
                          </div>
                          <p className={`text-xs font-bold shrink-0 ml-2 ${scoreColor(s.avgScore)}`}>
                            {formatScore(s.avgScore, classGrade)}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                );
              })}
            </div>
              );
            })()
          ) : (
            /* Single column */
            <div className="space-y-1">
              {displayStudents.map((s, i) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between py-2 px-2 rounded-md hover:bg-muted/50 cursor-pointer"
                  onClick={() => router.push(`/director/student/${s.id}`)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{i + 1}</span>
                    <Avatar className="h-7 w-7 shrink-0">
                      {s.avatar && <AvatarImage src={normalizeImageUrl(s.avatar)} alt={s.name} />}
                      <AvatarFallback className="text-[10px]">{s.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {s.name}
                        {s.subclass && hasSubclassFilter && (
                          <span
                            className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white"
                            style={{ backgroundColor: variantColor(s.subclass) }}
                          >
                            {s.subclass}
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{s.gradedCount} ta ish</p>
                    </div>
                  </div>
                  <p className={`text-sm font-bold shrink-0 ml-3 ${scoreColor(s.avgScore)}`}>
                    {formatScore(s.avgScore, classGrade)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
