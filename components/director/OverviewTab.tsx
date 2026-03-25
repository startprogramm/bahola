"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Trophy, TrendingDown, AlertTriangle, AlertCircle, ChevronRight, Grid3X3,
  TrendingUp,
} from "lucide-react";
import { ExportBtn } from "@/components/director/ExportBtn";
import { exportDataAsExcel } from "@/lib/director/export-client";
import { useLanguage } from "@/lib/i18n/language-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCachedFetch } from "@/lib/director/use-cached-fetch";
import type { DirectorTab, DirectorIssue, DirectorClass } from "@/lib/director/types";

interface ClassScore {
  id: string;
  name: string;
  subject: string | null;
  avg: number;
  change: number | null;
}

interface KPIData {
  passRate: number;
  missingRate: number;
  atRiskCount: number;
  topImproved: ClassScore[];
  topDeclined: ClassScore[];
  gradeAverages: { grade: number; avg: number; count: number; classCount: number }[];
  studentCount: number;
  teacherCount: number;
  classCount: number;
  totalGraded: number;
  totalSubmissions: number;
}

interface OverviewTabProps {
  onNavigate: (tab: DirectorTab) => void;
}

export function OverviewTab({ onNavigate }: OverviewTabProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const { data: kpis, loading, error } = useCachedFetch<KPIData>("/api/director/kpis");
  const { data: issuesData, loading: issuesLoading } = useCachedFetch<{ issues: DirectorIssue[] }>("/api/director/issues");
  const { data: classesData, loading: classesLoading } = useCachedFetch<{ classes: DirectorClass[] }>("/api/director/classes?search=");

  const [issueFilter, setIssueFilter] = useState<"critical" | "warning">("critical");

  const issues = issuesData?.issues || [];
  const filteredIssues = useMemo(() => {
    return issues
      .filter((i) => i.severity === issueFilter)
      .sort((a, b) => (a.severity === "critical" ? -1 : 1) - (b.severity === "critical" ? -1 : 1))
      .slice(0, 5);
  }, [issues, issueFilter]);

  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  // Subject heatmap: grade × subject matrix
  const heatmap = useMemo(() => {
    if (!classesData?.classes) return null;
    const classes = classesData.classes;

    const grades = new Set<number>();
    const subjects = new Set<string>();
    const cellAgg = new Map<string, { totalAvg: number; count: number; id: string }>();

    for (const cls of classes) {
      if (!cls.subject || cls.grade <= 0) continue;

      grades.add(cls.grade);
      subjects.add(cls.subject);

      if (cls.avgScore !== null) {
        const key = `${cls.grade}-${cls.subject}`;
        const existing = cellAgg.get(key);
        if (existing) {
          existing.totalAvg += cls.avgScore;
          existing.count++;
        } else {
          cellAgg.set(key, { totalAvg: cls.avgScore, count: 1, id: cls.id });
        }
      }
    }

    if (grades.size === 0 || subjects.size === 0) return null;

    const cellMap = new Map<string, { avg: number; id: string }>();
    for (const [key, data] of cellAgg) {
      cellMap.set(key, { avg: Math.round(data.totalAvg / data.count), id: data.id });
    }

    const sortedGrades = Array.from(grades).sort((a, b) => a - b);
    const sortedSubjects = Array.from(subjects).sort();

    return { grades: sortedGrades, subjects: sortedSubjects, cellMap };
  }, [classesData]);

  // Text-only color for heatmap (no background)
  const heatmapTextColor = (avg: number) => {
    if (avg >= 85) return "text-emerald-600 dark:text-emerald-400 font-semibold";
    if (avg >= 70) return "text-amber-600 dark:text-amber-400 font-semibold";
    return "text-red-600 dark:text-red-400 font-semibold";
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!kpis) {
    return (
      <div className="py-8 space-y-2">
        <p className="text-muted-foreground text-center">{t("dirNoData")}</p>
        {error && <p className="text-xs text-red-600 text-center break-all">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Problems + Top/Lowest — 3-column flat layout, items aligned to top */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">

        {/* Problems Summary — no card, no background */}
        {!issuesLoading && (
          <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                <span className="font-semibold text-sm">{t("dirIssuesSummary")}</span>
                {issues.length > 0 && (
                  <span className="text-xs font-semibold text-red-500 dark:text-red-400">{issues.length} ta</span>
                )}
              </div>
              <button
                className="text-xs text-primary hover:underline whitespace-nowrap shrink-0"
                onClick={() => onNavigate("issues")}
              >
                {t("dirSeeAll")}
              </button>
            </div>

            {/* Segmented filter */}
            {(criticalCount > 0 || warningCount > 0) && (
              <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-muted/30 rounded-full p-0.5 w-fit mb-3">
                {criticalCount > 0 && (
                  <button
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                      issueFilter === "critical"
                        ? "bg-white dark:bg-red-900/50 text-red-600 dark:text-red-300 shadow-sm"
                        : "text-red-400/70 dark:text-red-600 hover:text-red-500"
                    }`}
                    onClick={() => setIssueFilter("critical")}
                  >
                    <AlertTriangle className="h-3 w-3" />
                    {t("dirCritical")}
                    <span className="font-bold">{criticalCount}</span>
                  </button>
                )}
                {warningCount > 0 && (
                  <button
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                      issueFilter === "warning"
                        ? "bg-white dark:bg-orange-900/50 text-orange-600 dark:text-orange-300 shadow-sm"
                        : "text-orange-400/70 dark:text-orange-600 hover:text-orange-500"
                    }`}
                    onClick={() => setIssueFilter("warning")}
                  >
                    <AlertCircle className="h-3 w-3" />
                    {t("dirWarning")}
                    <span className="font-bold">{warningCount}</span>
                  </button>
                )}
              </div>
            )}

            {/* Issue list */}
            {issues.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">{t("dirNoIssues")}</p>
            ) : filteredIssues.length === 0 ? (
              <p className="text-sm text-muted-foreground py-3">
                {issueFilter === "critical" ? t("dirNoCritical") : t("dirNoWarnings")}
              </p>
            ) : (
              <div className="space-y-0.5">
                {filteredIssues.map((issue) => (
                  <div
                    key={issue.id}
                    className={`flex items-center gap-2 pl-3 pr-2 py-2.5 rounded-lg hover:bg-muted/50 cursor-pointer group transition-colors border-l-2 ${
                      issueFilter === "critical"
                        ? "border-red-400 dark:border-red-600"
                        : "border-orange-400 dark:border-orange-600"
                    }`}
                    onClick={() => {
                      if (issue.classId) router.push(`/director/class/${issue.classId}`);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{issue.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{issue.description}</p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Eng yuqori natijalar — no card, no background */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="h-4 w-4 text-emerald-600 shrink-0" />
            <span className="font-semibold text-sm">{t("dirTopResults")}</span>
          </div>
          {kpis.topImproved.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">{t("dirInsufficientData")}</p>
          ) : (
            <div className="space-y-1">
              {kpis.topImproved.map((cls, i) => (
                <div
                  key={cls.id}
                  className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => router.push(`/director/class/${cls.id}`)}
                >
                  <span className="w-5 text-xs font-bold text-emerald-600 dark:text-emerald-400 shrink-0 text-center">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{cls.name}</p>
                    {cls.subject && <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{cls.subject}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {cls.change !== null && cls.change !== 0 && (
                      <div className={`flex items-center gap-0.5 text-xs font-semibold ${cls.change > 0 ? "text-emerald-500" : "text-red-500"}`}>
                        {cls.change > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {Math.abs(cls.change)}%
                      </div>
                    )}
                    <div className="w-16 bg-muted rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${cls.avg >= 85 ? "bg-emerald-500" : cls.avg >= 70 ? "bg-orange-400" : "bg-red-400"}`}
                        style={{ width: `${cls.avg}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold text-emerald-600 w-9 text-right">{cls.avg}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Eng past natijalar — no card, no background */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="h-4 w-4 text-red-600 shrink-0" />
            <span className="font-semibold text-sm">{t("dirLowestResults")}</span>
          </div>
          {kpis.topDeclined.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">{t("dirInsufficientData")}</p>
          ) : (
            <div className="space-y-1">
              {kpis.topDeclined.map((cls, i) => (
                <div
                  key={cls.id}
                  className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => router.push(`/director/class/${cls.id}`)}
                >
                  <span className="w-5 text-xs font-bold text-red-600 dark:text-red-400 shrink-0 text-center">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{cls.name}</p>
                    {cls.subject && <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{cls.subject}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {cls.change !== null && cls.change !== 0 && (
                      <div className={`flex items-center gap-0.5 text-xs font-semibold ${cls.change > 0 ? "text-emerald-500" : "text-red-500"}`}>
                        {cls.change > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {Math.abs(cls.change)}%
                      </div>
                    )}
                    <div className="w-16 bg-muted rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${cls.avg >= 85 ? "bg-emerald-500" : cls.avg >= 70 ? "bg-orange-400" : "bg-red-400"}`}
                        style={{ width: `${cls.avg}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold text-red-600 w-9 text-right">{cls.avg}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Subject Heatmap */}
      {!classesLoading && heatmap && (
        <Card className="border-0 shadow-none">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Grid3X3 className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">{t("dirHeatmapTitle")}</CardTitle>
              </div>
              <ExportBtn
                onClick={() => exportDataAsExcel("heatmap")}
                variant="text"
                label="Excel"
                title={t("dirExportAsExcel")}
              />
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto pb-2">
              <table className="w-max table-fixed border-collapse">
                <colgroup>
                  <col className="w-24 min-w-24" />
                  {heatmap.subjects.map((subj) => (
                    <col key={subj} className="w-24 min-w-24" />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th className="w-24 min-w-24 px-3 py-2.5 text-left text-sm font-medium text-gray-600 dark:text-gray-400">{t("dirTableClass")}</th>
                    {heatmap.subjects.map((subj) => (
                      <th key={subj} className="w-24 min-w-24 max-w-24 px-2 py-2.5 text-center align-middle">
                        <span
                          className="mx-auto block w-full truncate text-[13px] font-medium text-gray-600 dark:text-gray-400"
                          title={subj}
                        >
                          {subj}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatmap.grades.map((grade) => (
                    <tr key={grade} className="border-t border-border/40">
                      <td className="h-12 w-24 min-w-24 whitespace-nowrap px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400">{grade}-sinf</td>
                      {heatmap.subjects.map((subj) => {
                        const cell = heatmap.cellMap.get(`${grade}-${subj}`);
                        return (
                          <td key={subj} className="h-12 w-24 min-w-24 max-w-24 px-2 py-2 text-center align-middle">
                            {cell ? (
                              <button
                                className={`font-semibold text-sm transition-opacity hover:opacity-70 ${heatmapTextColor(cell.avg)}`}
                                onClick={() => router.push(`/director/class/${cell.id}`)}
                              >
                                {cell.avg}%
                              </button>
                            ) : (
                              <span className="text-muted-foreground/30">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Legend */}
            <div className="flex gap-5 mt-4 justify-center text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-gray-600 dark:text-gray-400">{t("dirLegendExcellent")}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span className="text-gray-600 dark:text-gray-400">{t("dirLegendGood")}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                <span className="text-gray-600 dark:text-gray-400">{t("dirLegendPoor")}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
