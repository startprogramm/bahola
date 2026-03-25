"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, Award, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Rectangle } from "recharts";
import { CAMBRIDGE_GRADES, CAMBRIDGE_LABELS, CAMBRIDGE_FILL } from "@/lib/director/cambridge";
import { cambridgeGradeColor } from "@/lib/director/cambridge";
import { useLanguage } from "@/lib/i18n/language-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCachedFetch } from "@/lib/director/use-cached-fetch";
import { lightenColor } from "@/lib/director/chart-colors";
import { chartTooltipStyle } from "@/lib/director/chart-theme";

interface CambridgeData {
  kpis: {
    totalStudents: number;
    totalGraded: number;
    avgPct: number;
    avgGrade: string;
    aStarBRate: number;
    aStarCRate: number;
    uRate: number;
    gradeBreakdown: {
      grade: number;
      studentCount: number;
      gradedCount: number;
      avgPct: number;
      cambridgeGrade: string;
    }[];
  };
  distribution: Record<string, number>;
  subjects: {
    subject: string;
    grade: number;
    gradedCount: number;
    avgPct: number;
    cambridgeGrade: string;
  }[];
  students: {
    id: string;
    name: string;
    grade: number;
    avgPct: number;
    cambridgeGrade: string;
    gradedCount: number;
  }[];
}

export function CambridgeTab() {
  const router = useRouter();
  const { t } = useLanguage();
  const { data, loading, error } = useCachedFetch<CambridgeData>("/api/director/cambridge");

  const [gradeFilter, setGradeFilter] = useState<Set<number>>(new Set(CAMBRIDGE_GRADES));
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [showAllStudents, setShowAllStudents] = useState(false);

  const toggleGrade = (g: number) => {
    setGradeFilter(prev => {
      const next = new Set(prev);
      if (next.has(g)) { if (next.size > 1) next.delete(g); }
      else next.add(g);
      return next;
    });
  };

  // Unique subjects for dropdown
  const allSubjects = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.subjects.map(s => s.subject))].sort();
  }, [data]);

  // Filtered data
  const filteredSubjects = useMemo(() => {
    if (!data) return [];
    return data.subjects.filter(s =>
      gradeFilter.has(s.grade) &&
      (subjectFilter === "all" || s.subject === subjectFilter)
    );
  }, [data, gradeFilter, subjectFilter]);

  const filteredStudents = useMemo(() => {
    if (!data) return [];
    return data.students.filter(s => gradeFilter.has(s.grade));
  }, [data, gradeFilter]);

  // Chart data
  const chartData = useMemo(() => {
    if (!data) return [];
    return CAMBRIDGE_LABELS.map(label => ({
      grade: label,
      count: data.distribution[label] || 0,
      fill: CAMBRIDGE_FILL[label],
    }));
  }, [data]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-8 space-y-2">
        <p className="text-muted-foreground text-center">{t("dirNoData")}</p>
        {error && <p className="text-xs text-red-600 text-center break-all">{error}</p>}
      </div>
    );
  }

  const { kpis } = data;
  const visibleStudents = showAllStudents ? filteredStudents : filteredStudents.slice(0, 20);

  return (
    <div className="space-y-6">
      {/* Grade Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {CAMBRIDGE_GRADES.map(g => (
          <button
            key={g}
            onClick={() => toggleGrade(g)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              gradeFilter.has(g)
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {t("dirCambridgeGrade")} {g}
          </button>
        ))}
        {allSubjects.length > 1 && (
          <select
            value={subjectFilter}
            onChange={e => setSubjectFilter(e.target.value)}
            className="text-sm rounded-lg border bg-background px-3 py-1.5"
          >
            <option value="all">{t("dirFilterAllSubjects")}</option>
            {allSubjects.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card className="border shadow-sm">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <GraduationCap className="h-5 w-5 text-blue-500 shrink-0" />
            <div>
              <p className="text-lg font-bold leading-tight">{kpis.totalStudents}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("dirCambridgeStudents")}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <Award className="h-5 w-5 text-emerald-500 shrink-0" />
            <div>
              <p className={`text-lg font-bold leading-tight ${cambridgeGradeColor(kpis.avgGrade)}`}>{kpis.avgGrade}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("dirCambridgeAvgGrade")} ({kpis.avgPct}%)</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <TrendingUp className="h-5 w-5 text-emerald-500 shrink-0" />
            <div>
              <p className="text-lg font-bold leading-tight text-emerald-600">{kpis.aStarBRate}%</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("dirCambridgeAStarBRate")}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <TrendingUp className="h-5 w-5 text-amber-500 shrink-0" />
            <div>
              <p className="text-lg font-bold leading-tight text-amber-600">{kpis.aStarCRate}%</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("dirCambridgeAStarCRate")}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <AlertTriangle className={`h-5 w-5 shrink-0 ${kpis.uRate > 0 ? "text-red-500" : "text-muted-foreground"}`} />
            <div>
              <p className={`text-lg font-bold leading-tight ${kpis.uRate > 0 ? "text-red-600" : ""}`}>{kpis.uRate}%</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("dirCambridgeURate")}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Grade Distribution Chart + Per-Grade Breakdown side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("dirCambridgeDistribution")}</CardTitle>
          </CardHeader>
          <CardContent>
            {kpis.totalGraded === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">{t("dirNoData")}</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <XAxis dataKey="grade" tick={{ fontSize: 13 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip
                    cursor={false}
                    contentStyle={{ ...chartTooltipStyle, fontSize: "13px" }}
                    formatter={(value) => [value, "Students"]}
                  />
                  <Bar
                    dataKey="count"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={48}
                    activeBar={(props: any) => (
                      <Rectangle
                        {...props}
                        fill={lightenColor(String(props.fill || props.payload?.fill || "#2563eb"))}
                        stroke="none"
                      />
                    )}
                  >
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Per-Grade Breakdown */}
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">{t("dirCambridgeByGrade")}</h3>
          {kpis.gradeBreakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("dirNoData")}</p>
          ) : (
            kpis.gradeBreakdown.map(gb => (
              <Card key={gb.grade} className="border shadow-sm">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{t("dirCambridgeGrade")} {gb.grade}</span>
                    <span className={`text-lg font-bold ${cambridgeGradeColor(gb.cambridgeGrade)}`}>{gb.cambridgeGrade}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1 text-xs text-gray-500 dark:text-gray-400">
                    <span>{gb.studentCount} students</span>
                    <span>{gb.avgPct}%</span>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      {/* Subject Table */}
      {filteredSubjects.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("dirCambridgeSubjects")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left py-2 px-3 text-sm text-muted-foreground font-medium">Subject</th>
                    <th className="text-center py-2 px-3 text-sm text-muted-foreground font-medium">{t("dirCambridgeGrade")}</th>
                    <th className="text-center py-2 px-3 text-sm text-muted-foreground font-medium">{t("dirCambridgeAvgPct")}</th>
                    <th className="text-center py-2 px-3 text-sm text-muted-foreground font-medium">{t("dirCambridgeLetterGrade")}</th>
                    <th className="text-center py-2 px-3 text-sm text-muted-foreground font-medium">{t("dirKpiStudents")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSubjects.map((s, i) => (
                    <tr key={`${s.subject}-${s.grade}-${i}`} className="border-t border-border/40">
                      <td className="py-2 px-3 text-sm font-medium">{s.subject}</td>
                      <td className="py-2 px-3 text-sm text-center">{s.grade}</td>
                      <td className="py-2 px-3 text-sm text-center font-semibold">{s.avgPct}%</td>
                      <td className={`py-2 px-3 text-sm text-center font-bold ${cambridgeGradeColor(s.cambridgeGrade)}`}>{s.cambridgeGrade}</td>
                      <td className="py-2 px-3 text-sm text-center text-muted-foreground">{s.gradedCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Student Rankings */}
      {filteredStudents.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("dirCambridgeRankings")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-center py-2 px-2 text-sm text-muted-foreground font-medium w-10">{t("dirCambridgeRank")}</th>
                    <th className="text-left py-2 px-3 text-sm text-muted-foreground font-medium">{t("dirCambridgeName")}</th>
                    <th className="text-center py-2 px-3 text-sm text-muted-foreground font-medium">{t("dirCambridgeGrade")}</th>
                    <th className="text-center py-2 px-3 text-sm text-muted-foreground font-medium">{t("dirCambridgeAvgPct")}</th>
                    <th className="text-center py-2 px-3 text-sm text-muted-foreground font-medium">{t("dirCambridgeLetterGrade")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleStudents.map((s, i) => (
                    <tr
                      key={`${s.id}-${s.grade}`}
                      className="border-t border-border/40 hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => router.push(`/director/student/${s.id}`)}
                    >
                      <td className="py-2 px-2 text-sm text-center text-muted-foreground font-bold">{i + 1}</td>
                      <td className="py-2 px-3 text-sm font-medium">{s.name}</td>
                      <td className="py-2 px-3 text-sm text-center">{s.grade}</td>
                      <td className="py-2 px-3 text-sm text-center font-semibold">{s.avgPct}%</td>
                      <td className={`py-2 px-3 text-sm text-center font-bold ${cambridgeGradeColor(s.cambridgeGrade)}`}>{s.cambridgeGrade}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredStudents.length > 20 && !showAllStudents && (
              <button
                onClick={() => setShowAllStudents(true)}
                className="w-full mt-3 text-sm text-primary hover:underline"
              >
                {t("dirCambridgeShowAll")} ({filteredStudents.length})
              </button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
