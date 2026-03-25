"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, BookOpen, TrendingUp, TrendingDown, ShieldAlert, ShieldCheck, Shield, Printer, ChevronDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Legend, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { useLanguage } from "@/lib/i18n/language-context";
import { useCachedFetch } from "@/lib/director/use-cached-fetch";
import { LINE_COLORS } from "@/components/director/PerformanceChart";
import { DistributionChart } from "@/components/director/DistributionChart";
import { chartLegendStyle, chartTooltipEntryStyle, chartTooltipLabelStyle, chartTooltipStyle } from "@/lib/director/chart-theme";
import type { StudentProfile, ScoreBucket } from "@/lib/director/types";
import { formatScore, scoreColorForGrade } from "@/lib/director/cambridge";

interface StudentProfileExtended extends StudentProfile {
  gradeAvgBySubject?: { subject: string; avg: number }[];
}

const MONTH_KEYS: Record<string, string> = {
  "01": "dirMonJan", "02": "dirMonFeb", "03": "dirMonMar", "04": "dirMonApr",
  "05": "dirMonMay", "06": "dirMonJun", "07": "dirMonJul", "08": "dirMonAug",
  "09": "dirMonSep", "10": "dirMonOct", "11": "dirMonNov", "12": "dirMonDec",
};

function getMonthPresetRange(preset: string): { from: string; to: string } {
  const now = new Date();
  const m = now.getMonth(); // 0-based
  const y = now.getFullYear();
  const fmt = (yr: number, mo: number) => `${yr}-${String(mo).padStart(2, "0")}`;
  const to = fmt(y, m + 1);
  const ayear = m >= 8 ? y : y - 1;
  if (preset === "month") return { from: fmt(m === 0 ? y - 1 : y, m === 0 ? 12 : m), to };
  if (preset === "quarter") {
    if (m >= 8 && m <= 9) return { from: fmt(y, 9), to };
    if (m >= 10 && m <= 11) return { from: fmt(y, 11), to };
    if (m >= 0 && m <= 2) return { from: fmt(y, 1), to };
    if (m >= 3 && m <= 5) return { from: fmt(y, 4), to };
    return { from: fmt(y, 4), to: fmt(y, 6) };
  }
  if (preset === "semester") {
    if (m >= 8) return { from: fmt(y, 9), to };
    if (m <= 5) return { from: fmt(y, 1), to };
    return { from: fmt(y, 1), to: fmt(y, 6) };
  }
  if (preset === "year") return { from: fmt(ayear, 9), to };
  return { from: "", to: "" };
}

export default function DirectorStudentPage() {
  const { id: studentId } = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useLanguage();

  const fmtMonth = useCallback((m: string): string => {
    const [year, month] = m.split("-");
    const key = MONTH_KEYS[month];
    return `${key ? t(key as any) : month} ${year.slice(2)}`;
  }, [t]);

  const [showReasonsModal, setShowReasonsModal] = useState(false);
  const [chartHighlight, setChartHighlight] = useState<string | null>(null);
  // Multi-select subject filter
  const [subjectFilters, setSubjectFilters] = useState<string[]>([]);
  const [subjectsOpen, setSubjectsOpen] = useState(false);
  const subjectsRef = useRef<HTMLDivElement>(null);
  const [monthFrom, setMonthFrom] = useState("");
  const [monthTo, setMonthTo] = useState("");
  const [datePreset, setDatePreset] = useState("all");

  const fetchUrl = studentId ? `/api/director/student/${studentId}` : null;
  const { data, loading } = useCachedFetch<StudentProfileExtended>(fetchUrl);

  // Close subjects dropdown on outside click
  useEffect(() => {
    function h(e: MouseEvent) {
      if (subjectsRef.current && !subjectsRef.current.contains(e.target as Node))
        setSubjectsOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // Available subjects from timeline
  const availableSubjects = useMemo(() => {
    const s = new Set<string>();
    for (const t of data?.timeline ?? []) s.add(t.subject);
    return Array.from(s).sort();
  }, [data?.timeline]);

  // Filtered timeline (subject + date, for line and distribution charts only)
  const filteredTimeline = useMemo(() => {
    let tl = data?.timeline ?? [];
    if (subjectFilters.length > 0) tl = tl.filter(t => subjectFilters.includes(t.subject));
    if (monthFrom) tl = tl.filter(t => t.date.slice(0, 7) >= monthFrom);
    if (monthTo) tl = tl.filter(t => t.date.slice(0, 7) <= monthTo);
    return tl;
  }, [data?.timeline, subjectFilters, monthFrom, monthTo]);

  // All hooks must be called before any early returns
  const riskInfo = useMemo(() => {
    const avg = data?.overallAvg;
    if (avg === null || avg === undefined) return null;

    type ReasonItem = { text: string; links: { label: string; href: string }[] };
    const reasons: ReasonItem[] = [];

    const lowSubjects = data!.subjects.filter((s) => s.avgScore !== null && s.avgScore < 70);
    if (lowSubjects.length > 0) {
      reasons.push({
        text: `${lowSubjects.length} ta fanda 70% dan past natija`,
        links: lowSubjects.map((s) => ({
          label: `${s.subject || s.className} (${s.avgScore}%)`,
          href: `/director/class/${s.classId}`,
        })),
      });
    }

    const totalPossible = data!.subjects.reduce((s, sub) => s + sub.total, 0);
    const totalMissing = data!.subjects.reduce((s, sub) => s + sub.missing, 0);
    const missingRate = totalPossible > 0 ? Math.round((totalMissing / totalPossible) * 100) : 0;
    if (missingRate > 20) {
      const missingSubs = data!.subjects.filter((s) => s.missing > 0);
      reasons.push({
        text: `Topshirmagan ishlar: ${missingRate}% (${totalMissing}/${totalPossible})`,
        links: missingSubs.map((s) => ({
          label: `${s.subject || s.className} (${s.missing} ta yo'q)`,
          href: `/director/class/${s.classId}`,
        })),
      });
    }

    const decliningSubjects = data!.subjects.filter((s) => s.trend < -5);
    if (decliningSubjects.length > 0) {
      reasons.push({
        text: `${decliningSubjects.length} ta fanda pasayish tendensiyasi`,
        links: decliningSubjects.map((s) => ({
          label: `${s.subject || s.className} (${s.trend}%)`,
          href: `/director/class/${s.classId}`,
        })),
      });
    }

    if (avg < 40) return {
      level: "past" as const, label: t("dirRiskLow"),
      color: "text-red-600 dark:text-red-400",
      bg: "bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700",
      badgeBg: "bg-red-600 text-white dark:bg-red-700",
      icon: ShieldAlert, mainReason: reasons[0]?.text || t("dirRiskLowAvg"), reasons,
    };
    if (avg < 70) return {
      level: "orta" as const, label: t("dirRiskMedium"),
      color: "text-orange-600 dark:text-orange-400",
      bg: "bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700",
      badgeBg: "bg-orange-500 text-white dark:bg-orange-600",
      icon: Shield, mainReason: reasons[0]?.text || t("dirRiskMediumAvg"), reasons,
    };
    return {
      level: "yuqori" as const, label: t("dirRiskHigh"),
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700",
      badgeBg: "bg-emerald-600 text-white dark:bg-emerald-700",
      icon: ShieldCheck, mainReason: t("dirRiskHighAvg"), reasons,
    };
  }, [data, t]);

  // Spider graph uses FULL radarData (no subject/date filters applied)
  const radarData = useMemo(() => {
    if (!data?.subjects || data.subjects.length < 3) return null;
    const gradeAvgMap = new Map(
      (data.gradeAvgBySubject || []).map((g) => [g.subject, g.avg])
    );
    return data.subjects
      .filter((s) => s.avgScore !== null)
      .map((s) => ({
        subject: s.subject || s.className,
        student: Math.min(s.avgScore!, 100),
        gradeAvg: Math.min(gradeAvgMap.get(s.subject || s.className) ?? 0, 100),
      }));
  }, [data]);

  // Line chart data: monthly averages per subject from filteredTimeline
  const lineChartData = useMemo(() => {
    if (filteredTimeline.length < 2) return null;
    const byMonth: Record<string, Record<string, number[]>> = {};
    for (const t of filteredTimeline) {
      const month = t.date.slice(0, 7);
      if (!byMonth[month]) byMonth[month] = {};
      if (!byMonth[month][t.subject]) byMonth[month][t.subject] = [];
      byMonth[month][t.subject].push(t.pct);
    }
    const months = Object.keys(byMonth).sort();
    if (months.length < 2) return null;
    const subjects = [...new Set(filteredTimeline.map(t => t.subject))].sort();
    const rows = months.map(month => {
      const row: Record<string, any> = { month: fmtMonth(month) };
      for (const subj of subjects) {
        const scores = byMonth[month][subj];
        row[subj] = scores ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
      }
      return row;
    });
    return { subjects, rows };
  }, [filteredTimeline, fmtMonth]);

  // Distribution series from filteredTimeline
  const distSeries = useMemo(() => {
    if (filteredTimeline.length === 0) return [];
    const bySubject: Record<string, number[]> = {};
    for (const t of filteredTimeline) {
      if (!bySubject[t.subject]) bySubject[t.subject] = [];
      bySubject[t.subject].push(t.pct);
    }
    return Object.entries(bySubject)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, scores]) => ({
        label,
        buckets: Array.from({ length: 10 }, (_, i): ScoreBucket => ({
          label: `${i * 10}-${(i + 1) * 10}`,
          min: i * 10,
          max: (i + 1) * 10,
          count: scores.filter(p => p >= i * 10 && (i === 9 ? p <= 100 : p < (i + 1) * 10)).length,
        })),
      }));
  }, [filteredTimeline]);

  // Y-axis domain capped to actual data range
  const lineYDomain = useMemo((): [number, number] => {
    if (!lineChartData) return [0, 100];
    const all = lineChartData.rows.flatMap(r =>
      lineChartData.subjects.map(s => r[s] as number | null).filter((v): v is number => v != null)
    );
    if (all.length === 0) return [0, 100];
    const yMin = Math.max(0, Math.floor((Math.min(...all) - 5) / 5) * 5);
    const yMax = Math.min(100, Math.ceil((Math.max(...all) + 5) / 5) * 5);
    return [yMin, yMax];
  }, [lineChartData]);

  if (loading) {
    return (
      <div className="px-6 py-6 space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (!data || !data.student) {
    return (
      <div className="px-6 py-6 text-center">
        <p className="text-muted-foreground">{t("dirStudentsNotFound")}</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/director")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> {t("dirBack")}
        </Button>
      </div>
    );
  }

  const studentGrade = data?.grade;
  const scoreColor = (score: number | null) => scoreColorForGrade(score, studentGrade);

  const hasCharts = radarData !== null || lineChartData !== null || distSeries.length > 0;

  return (
    <div className="px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{data.student.name}</h1>
          <p className="text-sm text-muted-foreground">
            {data.student.email || t("dirStudentPlaceholder")}
          </p>
        </div>
        <button
          data-no-print
          onClick={() => window.print()}
          title={t("dirPrintPdf")}
          className="ml-auto inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-input bg-background text-xs hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          <Printer className="h-3.5 w-3.5" />
          PDF
        </button>
      </div>

      {/* Academic risk + overall avg in one row */}
      {riskInfo && (
        <Card className={`border ${riskInfo.bg}`}>
          <CardContent className="py-3 flex items-center gap-3">
            <riskInfo.icon className={`h-5 w-5 shrink-0 ${riskInfo.color}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${riskInfo.badgeBg}`}>
                  {riskInfo.label}
                </span>
                <span className="text-xs text-muted-foreground">{t("dirRiskAcademicLevel")}</span>
              </div>
              <p className="text-xs font-medium text-foreground/80 truncate">{riskInfo.mainReason}</p>
            </div>
            {/* Overall avg inline */}
            <div className="shrink-0 text-center px-3 border-l border-current/20">
              <p className={`text-xl font-bold leading-tight ${scoreColor(data.overallAvg)}`}>
                {formatScore(data.overallAvg, studentGrade)}
              </p>
              <p className="text-[10px] text-muted-foreground">{t("dirLabelAverage")}</p>
            </div>
            {riskInfo.reasons.length > 0 && (
              <Button variant="ghost" size="sm" className="text-xs shrink-0" onClick={() => setShowReasonsModal(true)}>
                {t("dirRiskReasons")}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Filters — apply to line + distribution charts only */}
      <div className="flex gap-2 flex-wrap items-center">
        {/* Multi-select subject dropdown */}
        {availableSubjects.length > 1 && (
          <div className="relative" ref={subjectsRef}>
            <button
              onClick={() => setSubjectsOpen(!subjectsOpen)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm flex items-center gap-1.5 hover:bg-muted/50 transition-colors"
            >
              <span>
                {subjectFilters.length === 0
                  ? t("dirFilterAllSubjects")
                  : subjectFilters.length === 1
                  ? subjectFilters[0]
                  : `${subjectFilters.length} ta fan`}
              </span>
              <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${subjectsOpen ? "rotate-180" : ""}`} />
            </button>
            {subjectsOpen && (
              <div className="absolute top-full mt-1 z-50 bg-background border border-input rounded-md shadow-md py-1 min-w-[180px]">
                <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={subjectFilters.length === 0}
                    onChange={() => { setSubjectFilters([]); }}
                  />
                  {t("dirFilterAllSubjects")}
                </label>
                <div className="border-t my-1" />
                {availableSubjects.map(s => (
                  <label key={s} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={subjectFilters.includes(s)}
                      onChange={() => {
                        setSubjectFilters(prev =>
                          prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
                        );
                      }}
                    />
                    {s}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Date presets */}
        <div className="flex gap-1">
          {([
            { key: "all", label: t("dirDateAll") },
            { key: "year", label: t("dirDateYear") },
            { key: "semester", label: t("dirDateSemester") },
            { key: "quarter", label: t("dirDateQuarter") },
            { key: "month", label: t("dirDateMonth") },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                setDatePreset(key);
                const { from, to } = getMonthPresetRange(key);
                setMonthFrom(from);
                setMonthTo(to);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                datePreset === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {(subjectFilters.length > 0 || monthFrom || monthTo) && (
          <Button variant="ghost" size="sm" className="text-xs h-9"
            onClick={() => { setSubjectFilters([]); setMonthFrom(""); setMonthTo(""); setDatePreset("all"); }}>
            {t("dirFilterClear")}
          </Button>
        )}
      </div>

      {/* Charts: spider + line + dist in a responsive grid */}
      {hasCharts && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* Spider chart — same height as siblings, fills its column */}
          {radarData && radarData.length >= 3 && (
            <Card className="h-full flex flex-col">
              <CardHeader className="pb-1 flex-shrink-0">
                <CardTitle className="text-sm">{t("dirChartSubjectComparison")}</CardTitle>
              </CardHeader>
              <CardContent className="px-2 pb-2 flex-1 min-h-0">
                <div className="h-full w-full min-h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData} cx="50%" cy="48%" outerRadius="70%">
                      <defs>
                        <linearGradient id="spiderStudentFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.6} />
                          <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.15} />
                        </linearGradient>
                        <filter id="spiderGlow">
                          <feGaussianBlur stdDeviation="2.5" result="blur" />
                          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                        </filter>
                      </defs>
                      <PolarGrid
                        gridType="polygon"
                        stroke="hsl(var(--border))"
                        strokeOpacity={0.45}
                      />
                      <PolarAngleAxis
                        dataKey="subject"
                        tick={(props: any) => {
                          const { x, y, cx, cy, payload } = props;
                          const dx = x - (cx ?? 0);
                          const dy = y - (cy ?? 0);
                          const len = Math.sqrt(dx * dx + dy * dy) || 1;
                          const nx = (cx ?? 0) + (dx / len) * (len + 16);
                          const ny = (cy ?? 0) + (dy / len) * (len + 16);
                          return (
                            <text x={nx} y={ny} textAnchor="middle" dominantBaseline="central"
                              fontSize={10} fontWeight={600} fill="hsl(var(--foreground))"
                              style={{ textShadow: "0 0 6px hsl(var(--background)), 0 0 6px hsl(var(--background))" }}>
                              {String(payload.value)}
                            </text>
                          );
                        }}
                      />
                      <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} tickCount={4} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const row = payload[0]?.payload as any;
                          return (
                            <div style={{ ...chartTooltipStyle, fontSize: "10px", padding: "5px 9px" }}>
                              <p style={{ fontWeight: 700, marginBottom: 3 }}>{row?.subject}</p>
                              <p style={chartTooltipEntryStyle("#60a5fa", "10px")}>{data.student.name}: <strong>{row?.student ?? 0}%</strong></p>
                              <p style={chartTooltipEntryStyle("#c084fc", "10px")}>{t("dirLabelAverage")}: <strong>{row?.gradeAvg ?? 0}%</strong></p>
                            </div>
                          );
                        }}
                      />
                      <Radar
                        name={data.student.name}
                        dataKey="student"
                        stroke="#3b82f6"
                        fill="url(#spiderStudentFill)"
                        fillOpacity={1}
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: "#3b82f6", strokeWidth: 0 }}
                        activeDot={{ r: 5, fill: "#3b82f6", stroke: "#fff", strokeWidth: 1.5 }}
                        filter="url(#spiderGlow)"
                      />
                      <Radar
                        name={t("dirChartClassAverage")}
                        dataKey="gradeAvg"
                        stroke="#9333ea"
                        fill="#9333ea"
                        fillOpacity={0.07}
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                        dot={false}
                      />
                      <Legend wrapperStyle={chartLegendStyle("9px", "4px")} iconType="circle" iconSize={7} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Performance line chart — with highlight dropdown synced to distribution */}
          {lineChartData && (
            <Card className="h-full flex flex-col">
              <CardHeader className="pb-2 flex-shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm">{t("dirChartPerformanceTrend")}</CardTitle>
                  {lineChartData.subjects.length > 1 && (
                    <select
                      value={chartHighlight || ""}
                      onChange={(e) => setChartHighlight(e.target.value || null)}
                      className="text-xs border border-input rounded px-1.5 py-0.5 bg-background text-foreground"
                    >
                      <option value="">{t("dirFilterAll")}</option>
                      {lineChartData.subjects.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 px-3 pb-3">
                <div className="h-full w-full min-h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={lineChartData.rows} margin={{ top: 5, right: 8, left: -12, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="month" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                      <YAxis
                        domain={lineYDomain}
                        tick={{ fontSize: 9 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => `${v}%`}
                      />
                      <Tooltip
                        wrapperStyle={{ background: "transparent", border: "none", padding: 0 }}
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const entries = chartHighlight
                            ? payload.filter(p => p.dataKey === chartHighlight && p.value != null)
                            : payload.filter(p => p.value != null);
                          if (entries.length === 0) return null;
                          return (
                            <div style={{ ...chartTooltipStyle, fontSize: "10px", padding: "5px 9px" }}>
                              <p style={{ ...chartTooltipLabelStyle, marginBottom: 3, fontSize: "9px" }}>{label}</p>
                              {entries.map(p => (
                                <p key={String(p.dataKey)} style={chartTooltipEntryStyle(p.color as string, "10px")}>{p.dataKey as string}: {p.value}%</p>
                              ))}
                            </div>
                          );
                        }}
                      />
                      {lineChartData.subjects.map((subj, i) => {
                        const color = LINE_COLORS[i % LINE_COLORS.length];
                        const dimmed = chartHighlight !== null && chartHighlight !== subj;
                        return (
                          <Line
                            key={subj}
                            type="monotone"
                            dataKey={subj}
                            stroke={color}
                            strokeWidth={chartHighlight === subj ? 3 : 2}
                            strokeOpacity={dimmed ? 0.2 : 1}
                            dot={{ r: 3, fill: color, fillOpacity: dimmed ? 0.2 : 1 }}
                            activeDot={dimmed ? false : { r: 5 }}
                            connectNulls
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Distribution chart — synced highlight with line chart */}
          {distSeries.length > 0 && (
            <DistributionChart
              series={distSeries}
              loading={false}
              showBarChart={false}
              highlightValue={chartHighlight}
              onHighlightChange={setChartHighlight}
            />
          )}
        </div>
      )}

      {/* Reasons modal */}
      {riskInfo && (
        <Dialog open={showReasonsModal} onOpenChange={setShowReasonsModal}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <riskInfo.icon className={`h-4 w-4 ${riskInfo.color}`} />
                {t("dirRiskReasonsTitle")}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {riskInfo.reasons.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("dirRiskNoReasons")}</p>
              ) : (
                riskInfo.reasons.map((r, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="flex items-start gap-2 text-sm">
                      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                        riskInfo.level === "past" ? "bg-red-500" : riskInfo.level === "orta" ? "bg-orange-500" : "bg-emerald-500"
                      }`} />
                      <span className="font-medium">{r.text}</span>
                    </div>
                    {r.links.length > 0 && (
                      <div className="ml-4 flex flex-wrap gap-1.5">
                        {r.links.map((link) => (
                          <button
                            key={link.href}
                            onClick={() => { setShowReasonsModal(false); router.push(link.href); }}
                            className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                          >
                            {link.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Subject breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("dirStudentSubjectAnalysis")}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.subjects.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-4">{t("dirNoData")}</p>
          ) : (
            <div className="space-y-3">
              {data.subjects.map((s) => (
                <div
                  key={`${s.classId}-${s.subject}`}
                  className="flex items-center gap-3 cursor-pointer hover:bg-muted/50 rounded p-2 -mx-2"
                  onClick={() => router.push(`/director/class/${s.classId}`)}
                >
                  <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.className}</p>
                    <p className="text-xs text-muted-foreground">{s.totalGraded}/{s.totalGraded + s.missing}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {s.trend !== 0 && (
                      <div className={`flex items-center gap-0.5 text-xs ${s.trend > 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {s.trend > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {Math.abs(s.trend)}%
                      </div>
                    )}
                    <div className="w-20 bg-muted rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${(s.avgScore || 0) >= 70 ? "bg-emerald-500" : (s.avgScore || 0) >= 50 ? "bg-orange-400" : "bg-red-400"}`}
                        style={{ width: `${s.avgScore || 0}%` }}
                      />
                    </div>
                    <span className={`text-sm font-bold w-16 text-right ${scoreColor(s.avgScore)}`}>
                      {formatScore(s.avgScore, studentGrade)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Timeline */}
      {data.timeline.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("dirStudentRecentResults")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.timeline.slice(0, 20).map((t, i) => (
                <div key={i} className="flex items-center justify-between py-1.5">
                  <div className="min-w-0">
                    <p className="text-sm truncate">{t.assessmentTitle}</p>
                    <p className="text-xs text-muted-foreground">{t.className} · {t.date}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-sm font-bold ${scoreColor(t.pct)}`}>{t.score}/{t.maxScore}</span>
                    <Badge variant={t.pct >= 70 ? "default" : t.pct >= 50 ? "secondary" : "destructive"} className="text-[10px]">
                      {t.pct}%
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
