"use client";

import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, BookOpen, ExternalLink, Plus, Loader2,
  TrendingUp, TrendingDown, Minus, Printer, Trophy, AlertCircle, ChevronDown,
} from "lucide-react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Rectangle,
  ResponsiveContainer, LineChart, Line,
} from "recharts";
import { LINE_COLORS } from "@/components/director/PerformanceChart";
import { lightenColor } from "@/lib/director/chart-colors";
import { chartTooltipEntryStyle, chartTooltipLabelStyle, chartTooltipStyle } from "@/lib/director/chart-theme";
import { useLanguage } from "@/lib/i18n/language-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TeacherDetail {
  id: string;
  name: string;
  email: string | null;
  avatar: string | null;
  subscription: string;
  credits: number;
  creditsUsed: number;
  subjects: string[];
  createdAt: string;
}

interface TeacherAssessment {
  id: string;
  title: string;
  createdAt: string;
  avgScore: number | null;
  gradedCount: number;
  weakCount: number;
  excellentCount: number;
}

interface TeacherClass {
  id: string;
  name: string;
  subject: string | null;
  studentCount: number;
  assessmentCount: number;
  avgScore: number | null;
  assessments?: TeacherAssessment[];
}

interface StudentStat {
  studentId: string;
  name: string;
  grade: string | null;
  subclass: string | null;
  avgPct: number;
  total: number;
}

function SubBadge({ sub }: { sub: string }) {
  if (sub === "MAX") return (
    <span style={{ background: "#f59e0b", color: "#fff", border: "1px solid #d97706" }}
      className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 tracking-wide">MAX</span>
  );
  if (sub === "PRO") return (
    <span style={{ background: "#2563eb", color: "#fff", border: "1px solid #1d4ed8" }}
      className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 tracking-wide">PRO</span>
  );
  return (
    <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 tracking-wide bg-muted text-muted-foreground border-border">{sub}</span>
  );
}

const MONTH_KEYS: Record<string, string> = {
  "01": "dirMonJan", "02": "dirMonFeb", "03": "dirMonMar", "04": "dirMonApr",
  "05": "dirMonMay", "06": "dirMonJun", "07": "dirMonJul", "08": "dirMonAug",
  "09": "dirMonSep", "10": "dirMonOct", "11": "dirMonNov", "12": "dirMonDec",
};

export default function TeacherDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useLanguage();
  const teacherId = params.id as string;

  const fmtMonth = useCallback((m: string) => {
    const [y, mo] = m.split("-");
    return `${t((MONTH_KEYS[mo] || mo) as any)} ${y.slice(2)}`;
  }, [t]);

  const [teacher, setTeacher] = useState<TeacherDetail | null>(null);
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [allStudents, setAllStudents] = useState<StudentStat[]>([]);
  const [totalGraded, setTotalGraded] = useState(0);
  const [avgScore, setAvgScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters for student tables
  const [gradeFilter, setGradeFilter] = useState("");
  const [variantFilter, setVariantFilter] = useState("");

  // Grade filter for trend line chart
  const [gradeTrendFilter, setGradeTrendFilter] = useState<string[]>([]);
  const [gradeTrendOpen, setGradeTrendOpen] = useState(false);
  const gradeTrendRef = useRef<HTMLDivElement>(null);

  // Create class dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newClassName, setNewClassName] = useState("");
  const [newClassGrade, setNewClassGrade] = useState("");
  const [newClassSubject, setNewClassSubject] = useState("");
  const [newClassSubclasses, setNewClassSubclasses] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (gradeTrendRef.current && !gradeTrendRef.current.contains(e.target as Node))
        setGradeTrendOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    fetch(`/api/director/teachers/${teacherId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load teacher");
        return r.json();
      })
      .then((data) => {
        setTeacher(data.teacher);
        setClasses(data.classes || []);
        setAllStudents(data.allStudents || []);
        setTotalGraded(data.totalGraded || 0);
        setAvgScore(data.avgScore);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [teacherId]);

  const handleCreateClass = async () => {
    if (!newClassName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/director/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherId,
          name: newClassName.trim(),
          grade: newClassGrade || undefined,
          subject: newClassSubject.trim() || undefined,
          subclasses: newClassSubclasses.length > 0 ? newClassSubclasses : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create class");
      }
      const data = await res.json();
      setClasses((prev) => [
        ...prev,
        { id: data.class.id, name: data.class.name, subject: data.class.subject, studentCount: 0, assessmentCount: 0, avgScore: null },
      ]);
      setCreateDialogOpen(false);
      setNewClassName(""); setNewClassGrade(""); setNewClassSubject(""); setNewClassSubclasses([]);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error");
    } finally {
      setCreating(false);
    }
  };

  // Teacher impact computation
  const teacherImpact = useMemo(() => {
    if (classes.length === 0) return null;
    const allAssessments: TeacherAssessment[] = [];
    for (const cls of classes) {
      if (cls.assessments) allAssessments.push(...cls.assessments);
    }
    if (allAssessments.length < 2) return null;
    allAssessments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const half = Math.floor(allAssessments.length / 2);
    const firstHalf = allAssessments.slice(0, half);
    const secondHalf = allAssessments.slice(half);
    const firstAvgs = firstHalf.filter((a) => a.avgScore !== null);
    const secondAvgs = secondHalf.filter((a) => a.avgScore !== null);
    const firstAvg = firstAvgs.length > 0 ? firstAvgs.reduce((s, a) => s + (a.avgScore || 0), 0) / firstAvgs.length : null;
    const secondAvg = secondAvgs.length > 0 ? secondAvgs.reduce((s, a) => s + (a.avgScore || 0), 0) / secondAvgs.length : null;
    const scoreImprovement = firstAvg !== null && secondAvg !== null ? Math.round(secondAvg - firstAvg) : null;
    const firstWeak = firstHalf.reduce((s, a) => s + a.weakCount, 0) / (firstHalf.length || 1);
    const secondWeak = secondHalf.reduce((s, a) => s + a.weakCount, 0) / (secondHalf.length || 1);
    const weakDelta = Math.round(secondWeak - firstWeak);
    const firstExcellent = firstHalf.reduce((s, a) => s + a.excellentCount, 0) / (firstHalf.length || 1);
    const secondExcellent = secondHalf.reduce((s, a) => s + a.excellentCount, 0) / (secondHalf.length || 1);
    const excellentDelta = Math.round(secondExcellent - firstExcellent);
    return { scoreImprovement, weakDelta, excellentDelta, totalAssessments: allAssessments.length };
  }, [classes]);

  // Class performance bar chart data
  const classBarData = useMemo(() =>
    classes
      .filter((c) => c.avgScore !== null)
      .map((c, i) => ({
        name: c.name.replace(/-sinf\s*/i, "").trim() || c.name,
        fullName: c.name,
        avg: c.avgScore as number,
        color: LINE_COLORS[i % LINE_COLORS.length],
      })),
    [classes]
  );

  // Classes that have at least one graded assessment (for the trend chart)
  const availableClassesForChart = useMemo(() =>
    classes.filter(c => (c.assessments || []).some(a => a.avgScore !== null)),
    [classes]
  );

  // Assessment timeline — one line per class
  const assessmentTimeline = useMemo(() => {
    const selectedClasses = gradeTrendFilter.length > 0
      ? availableClassesForChart.filter(c => gradeTrendFilter.includes(c.id))
      : availableClassesForChart;
    if (selectedClasses.length === 0) return null;
    const classData: Record<string, Record<string, number[]>> = {};
    for (const cls of selectedClasses) classData[cls.id] = {};
    for (const cls of selectedClasses) {
      for (const a of cls.assessments || []) {
        if (a.avgScore !== null) {
          const month = String(a.createdAt).slice(0, 7);
          if (!classData[cls.id][month]) classData[cls.id][month] = [];
          classData[cls.id][month].push(a.avgScore);
        }
      }
    }
    const allMonths = [...new Set(
      Object.values(classData).flatMap(mm => Object.keys(mm))
    )].sort();
    if (allMonths.length < 1) return null;
    return {
      classes: selectedClasses,
      rows: allMonths.map(month => {
        const row: Record<string, any> = { month: fmtMonth(month) };
        for (const cls of selectedClasses) {
          const scores = classData[cls.id][month];
          row[cls.id] = scores ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null;
        }
        return row;
      }),
    };
  }, [availableClassesForChart, fmtMonth, gradeTrendFilter]);

  const trendYDomain = useMemo((): [number, number] => {
    if (!assessmentTimeline) return [0, 100];
    const all = assessmentTimeline.rows
      .flatMap(r => assessmentTimeline.classes.map(c => r[c.id] as number | null).filter((v): v is number => v != null));
    if (all.length === 0) return [0, 100];
    return [
      Math.max(0, Math.floor((Math.min(...all) - 5) / 5) * 5),
      Math.min(100, Math.ceil((Math.max(...all) + 5) / 5) * 5),
    ];
  }, [assessmentTimeline]);

  const trendYTicks = useMemo(() => {
    const [min, max] = trendYDomain;
    const ticks: number[] = [];
    for (let v = min; v <= max; v += 10) ticks.push(v);
    return ticks;
  }, [trendYDomain]);

  // Available grades and variants for filters
  const availableGrades = useMemo(() =>
    [...new Set(allStudents.map(s => s.grade).filter((g): g is string => !!g))].sort(),
    [allStudents]
  );
  const availableVariants = useMemo(() =>
    [...new Set(allStudents.map(s => s.subclass).filter((v): v is string => !!v))].sort(),
    [allStudents]
  );

  // Filtered + top/bottom students
  const filteredStudents = useMemo(() => {
    return allStudents.filter(s =>
      (!gradeFilter || s.grade === gradeFilter) &&
      (!variantFilter || s.subclass === variantFilter)
    );
  }, [allStudents, gradeFilter, variantFilter]);

  const topStudents = filteredStudents.slice(0, 5); // already sorted DESC
  const bottomStudents = useMemo(() =>
    [...filteredStudents].sort((a, b) => a.avgPct - b.avgPct).slice(0, 5),
    [filteredStudents]
  );

  if (loading) {
    return (
      <div className="px-6 py-6 space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded" />
          <div className="space-y-1.5 flex-1"><Skeleton className="h-5 w-40" /><Skeleton className="h-3 w-48" /></div>
        </div>
        <div className="grid grid-cols-3 gap-4">{[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>
        <div className="grid grid-cols-2 gap-4"><Skeleton className="h-52 w-full" /><Skeleton className="h-52 w-full" /></div>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !teacher) {
    return (
      <div className="px-6 py-8 text-center">
        <p className="text-muted-foreground">{error || t("dirTeachersNotFound")}</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/director")}>{t("dirBack")}</Button>
      </div>
    );
  }

  const scoreColor = (v: number) => v >= 70 ? "text-emerald-600" : v >= 50 ? "text-orange-500" : "text-red-600";

  return (
    <div className="px-6 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold">{teacher.name}</h1>
              <SubBadge sub={teacher.subscription} />
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {teacher.email}
              {classes.length > 0 && <span> · <strong className="text-foreground">{classes.length}</strong> sinf</span>}
              {avgScore !== null && <span> · <strong className={scoreColor(avgScore)}>{avgScore}%</strong> {t("dirLabelAverage")}</span>}
              {teacher.subjects.length > 0 && <span> · {teacher.subjects.join(", ")}</span>}
            </p>
          </div>
        </div>
        <button
          data-no-print
          onClick={() => window.print()}
          title={t("dirPrintPdf")}
          className="shrink-0 inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-input bg-background text-xs hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          <Printer className="h-3.5 w-3.5" />
          PDF
        </button>
      </div>

      {/* Teacher Impact — only show if we have real data */}
      {teacherImpact && (teacherImpact.scoreImprovement !== null || teacherImpact.weakDelta !== 0 || teacherImpact.excellentDelta !== 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("dirTeacherImpact")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`grid gap-3 ${teacherImpact.scoreImprovement !== null ? "grid-cols-3" : "grid-cols-2"}`}>
              {teacherImpact.scoreImprovement !== null && (
                <div className="rounded-lg border p-3 text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    {teacherImpact.scoreImprovement >= 0
                      ? <TrendingUp className="h-4 w-4 text-emerald-500" />
                      : <TrendingDown className="h-4 w-4 text-red-500" />}
                  </div>
                  <p className={`text-lg font-bold ${teacherImpact.scoreImprovement >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {teacherImpact.scoreImprovement > 0 ? "+" : ""}{teacherImpact.scoreImprovement}%
                  </p>
                  <p className="text-[11px] text-muted-foreground">{t("dirTeacherScoreGrowth")}</p>
                </div>
              )}
              <div className="rounded-lg border p-3 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  {teacherImpact.weakDelta <= 0 ? <TrendingDown className="h-4 w-4 text-emerald-500" /> : <TrendingUp className="h-4 w-4 text-red-500" />}
                </div>
                <p className={`text-lg font-bold ${teacherImpact.weakDelta <= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {teacherImpact.weakDelta > 0 ? "+" : ""}{teacherImpact.weakDelta}
                </p>
                <p className="text-[11px] text-muted-foreground">{t("dirTeacherWeakDelta")}</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  {teacherImpact.excellentDelta >= 0 ? <TrendingUp className="h-4 w-4 text-emerald-500" /> : <TrendingDown className="h-4 w-4 text-red-500" />}
                </div>
                <p className={`text-lg font-bold ${teacherImpact.excellentDelta >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {teacherImpact.excellentDelta > 0 ? "+" : ""}{teacherImpact.excellentDelta}
                </p>
                <p className="text-[11px] text-muted-foreground">{t("dirTeacherExcellentDelta")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Performance charts */}
      {(classBarData.length > 0 || (assessmentTimeline && assessmentTimeline.rows.length >= 2)) && (
        <div className="grid grid-cols-2 gap-4 items-stretch">
          {/* Class averages — horizontal bar chart so names are readable */}
          {classBarData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{t("dirTeacherClassAverages")}</CardTitle>
              </CardHeader>
              <CardContent className="pb-3">
                <div style={{ height: Math.max(160, classBarData.length * 26 + 16) }} className="w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={classBarData} margin={{ top: 2, right: 40, left: 4, bottom: 2 }} barCategoryGap="20%">
                      <CartesianGrid strokeDasharray="3 3" className="opacity-20" horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={72} />
                      <Tooltip
                        cursor={false}
                        wrapperStyle={{ background: "transparent", border: "none", padding: 0 }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0].payload as typeof classBarData[0];
                          return (
                            <div style={{ ...chartTooltipStyle, fontSize: "10px", padding: "4px 8px" }}>
                              <p style={chartTooltipEntryStyle(undefined, "10px")}>{d.fullName}: {d.avg}%</p>
                            </div>
                          );
                        }}
                      />
                      <Bar
                        dataKey="avg"
                        radius={[0, 3, 3, 0]}
                        isAnimationActive={false}
                        activeBar={(props: any) => (
                          <Rectangle
                            {...props}
                            fill={lightenColor(String(props.fill || props.payload?.color || "#2563eb"))}
                            fillOpacity={props.fillOpacity ?? 1}
                            stroke="none"
                          />
                        )}
                        label={{ position: "right", fontSize: 9, fill: "hsl(var(--muted-foreground))", formatter: (v: unknown) => `${v}%` }}
                      >
                        {classBarData.map((d) => (
                          <Cell key={d.name} fill={d.color} fillOpacity={0.85} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Assessment score trend — per class, multi-line */}
          {assessmentTimeline && assessmentTimeline.rows.length >= 2 && (
            <Card className="flex flex-col">
              <CardHeader className="pb-2 flex-shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm">{t("dirTeacherAssessmentTrend")}</CardTitle>
                  {availableClassesForChart.length > 1 && (
                    <div className="relative" ref={gradeTrendRef}>
                      <button
                        type="button"
                        onClick={() => setGradeTrendOpen(!gradeTrendOpen)}
                        className="flex items-center gap-1 text-xs border border-input rounded px-2 py-0.5 bg-background hover:bg-muted transition-colors"
                      >
                        <span>
                          {gradeTrendFilter.length === 0
                            ? t("dirFilterAllClasses")
                            : `${gradeTrendFilter.length} ta sinf`}
                        </span>
                        <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${gradeTrendOpen ? "rotate-180" : ""}`} />
                      </button>
                      {gradeTrendOpen && (
                        <div className="absolute top-full mt-1 right-0 z-50 bg-background border border-input rounded-md shadow-md py-1 min-w-[150px] max-h-48 overflow-y-auto">
                          <label className="flex items-center gap-2 px-3 py-1 hover:bg-muted cursor-pointer text-xs">
                            <input type="checkbox" className="rounded" checked={gradeTrendFilter.length === 0} onChange={() => setGradeTrendFilter([])} />
                            {t("dirFilterAllClasses")}
                          </label>
                          <div className="border-t my-0.5" />
                          {availableClassesForChart.map(cls => (
                            <label key={cls.id} className="flex items-center gap-2 px-3 py-1 hover:bg-muted cursor-pointer text-xs">
                              <input
                                type="checkbox"
                                className="rounded"
                                checked={gradeTrendFilter.includes(cls.id)}
                                onChange={() => setGradeTrendFilter(prev =>
                                  prev.includes(cls.id) ? prev.filter(x => x !== cls.id) : [...prev, cls.id]
                                )}
                              />
                              {cls.name.replace(/-sinf\s*/i, "").trim()}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col min-h-0 pb-3">
                <div className="flex-1 min-h-0 w-full" style={{ minHeight: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={assessmentTimeline.rows} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                      <XAxis dataKey="month" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                      <YAxis domain={trendYDomain} ticks={trendYTicks} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
                      <Tooltip
                        wrapperStyle={{ background: "transparent", border: "none", padding: 0 }}
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          return (
                            <div style={{ ...chartTooltipStyle, fontSize: "10px", padding: "4px 8px" }}>
                              <p style={{ ...chartTooltipLabelStyle, marginBottom: 2, fontSize: "9px" }}>{label}</p>
                              {payload.filter(p => p.value != null).map(p => {
                                const cls = assessmentTimeline.classes.find(c => c.id === p.dataKey);
                                return (
                                  <p key={String(p.dataKey)} style={chartTooltipEntryStyle(p.color as string, "10px")}>
                                    {cls ? cls.name.replace(/-sinf\s*/i, "").trim() : String(p.dataKey)}: {p.value}%
                                  </p>
                                );
                              })}
                            </div>
                          );
                        }}
                      />
                      {assessmentTimeline.classes.map((cls, i) => (
                        <Line
                          key={cls.id}
                          type="monotone"
                          dataKey={cls.id}
                          stroke={LINE_COLORS[i % LINE_COLORS.length]}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Classes */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {t("dirTeachersClassesCount")} ({classes.length})
          </h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              {t("dirClassCreateClass")}
            </Button>
          </div>
        </div>
        {classes.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3 text-center">{t("dirTeacherNoClasses")}</p>
        ) : (
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
            {classes.map((cls) => (
              <button
                key={cls.id}
                onClick={() => router.push(`/director/class/${cls.id}`)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border hover:bg-muted/50 hover:border-primary/30 transition-colors text-left group"
              >
                <BookOpen className="h-4 w-4 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{cls.name}</p>
                  <p className="text-xs text-muted-foreground">{cls.studentCount} o&apos;quvchi</p>
                </div>
                {cls.avgScore !== null && (
                  <span className={`text-sm font-bold shrink-0 ${scoreColor(cls.avgScore)}`}>{cls.avgScore}%</span>
                )}
                <ExternalLink className="h-3 w-3 text-muted-foreground/50 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Top / Bottom students */}
      {allStudents.length > 0 && (
        <div className="space-y-3">
          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("dirTeacherStudentRanking")}</span>
            {availableGrades.length > 1 && (
              <select
                value={gradeFilter}
                onChange={e => setGradeFilter(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="">{t("dirFilterAllClasses")}</option>
                {availableGrades.map(g => <option key={g} value={g}>{g}-sinf</option>)}
              </select>
            )}
            {availableVariants.length > 1 && (
              <select
                value={variantFilter}
                onChange={e => setVariantFilter(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="">{t("dirFilterAllGroups")}</option>
                {availableVariants.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            )}
            {filteredStudents.length > 0 && (
              <span className="text-xs text-muted-foreground ml-1">{filteredStudents.length} ta o&apos;quvchi</span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Top 5 */}
            <Card>
              <CardHeader className="pb-2 pt-3">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Trophy className="h-4 w-4 text-amber-500" />
                  {t("dirTeacherTop5")}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 pb-3">
                {topStudents.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">{t("dirNoData")}</p>
                ) : (
                  <div className="space-y-1">
                    {topStudents.map((s, i) => (
                      <button
                        key={s.studentId}
                        onClick={() => router.push(`/director/student/${s.studentId}`)}
                        className="w-full flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted transition-colors text-left"
                      >
                        <span className="text-xs text-muted-foreground w-4 shrink-0 font-mono">{i + 1}</span>
                        <span className="flex-1 text-sm truncate">{s.name}</span>
                        {(s.grade || s.subclass) && (
                          <span className="text-[10px] text-muted-foreground shrink-0">{s.grade}{s.subclass}</span>
                        )}
                        <span className={`text-sm font-bold shrink-0 ${scoreColor(s.avgPct)}`}>{s.avgPct}%</span>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Bottom 5 */}
            <Card>
              <CardHeader className="pb-2 pt-3">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4 text-red-500" />
                  {t("dirTeacherBottom5")}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 pb-3">
                {bottomStudents.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">{t("dirNoData")}</p>
                ) : (
                  <div className="space-y-1">
                    {bottomStudents.map((s, i) => (
                      <button
                        key={s.studentId}
                        onClick={() => router.push(`/director/student/${s.studentId}`)}
                        className="w-full flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted transition-colors text-left"
                      >
                        <span className="text-xs text-muted-foreground w-4 shrink-0 font-mono">{i + 1}</span>
                        <span className="flex-1 text-sm truncate">{s.name}</span>
                        {(s.grade || s.subclass) && (
                          <span className="text-[10px] text-muted-foreground shrink-0">{s.grade}{s.subclass}</span>
                        )}
                        <span className={`text-sm font-bold shrink-0 ${scoreColor(s.avgPct)}`}>{s.avgPct}%</span>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Create Class Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dirTeacherCreateClassFor")} {teacher.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t("dirLabelClassName")}</Label>
              <Input placeholder={t("dirPlaceholderClassNameExample")} value={newClassName} onChange={e => setNewClassName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("dirLabelGradeOptional")}</Label>
              <select value={newClassGrade} onChange={e => setNewClassGrade(e.target.value)} className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                <option value="">{t("dirPlaceholderNone")}</option>
                {["1","2","3","4","5","6","7","8","9","10","11"].map(g => <option key={g} value={g}>{g}-sinf</option>)}
              </select>
            </div>
            {newClassGrade && (
              <div className="space-y-2">
                <Label>{t("dirLabelSectionsOptional")}</Label>
                <div className="flex gap-3">
                  {["A","B","C","D","E"].map(sc => (
                    <label key={sc} className="flex items-center gap-1.5 cursor-pointer text-sm">
                      <input type="checkbox" checked={newClassSubclasses.includes(sc)}
                        onChange={() => setNewClassSubclasses(prev => prev.includes(sc) ? prev.filter(s => s !== sc) : [...prev, sc])}
                        className="rounded border-input" />
                      {sc}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>{t("dirLabelSubjectOptional")}</Label>
              <Input placeholder={t("dirPlaceholderSubjectExample")} value={newClassSubject} onChange={e => setNewClassSubject(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>{t("dirCancel")}</Button>
            <Button onClick={handleCreateClass} disabled={creating || !newClassName.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {t("dirCreate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
