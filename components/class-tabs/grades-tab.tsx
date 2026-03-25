"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import {
  ChevronDown,
  Loader2,
  ClipboardList,
  Crown,
  AlertCircle,
  Clock,
  Download,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n/language-context";
import { cn } from "@/lib/utils";
import { cachedFetch } from "@/lib/fetch-cache";
import type { ClassDetail } from "./types";
import {
  type GradesFilterState,
  type GradesTimelineType,
  getAcademicYearStart,
  getAcademicYears,
  getGradesDateRange,
  getCurrentAcademicSelection,
  formatAcademicYearLabel,
  isSubmissionLate,
  getGradesScoreColor,
} from "./types";

interface GradesTabProps {
  classId: string;
  classData: ClassDetail;
  canManageGrades: boolean;
  isFreePlan: boolean;
}

export function GradesTab({
  classId,
  classData,
  canManageGrades,
  isFreePlan,
}: GradesTabProps) {
  const { toast } = useToast();
  const { t, language } = useLanguage();

  const [gradesData, setGradesData] = useState<{
    assessments: { id: string; title: string; totalMarks: number | null; actualMaxScore: number | null; dueDate: string | null; createdAt: string }[];
    students: { id: string; name: string; email: string | null; avatar: string | null }[];
    submissionMap: Record<string, { score: number | null; maxScore: number | null; status: string; submittedAt: string | null }>;
  } | null>(null);
  const [gradesLoading, setGradesLoading] = useState(false);
  const [studentsSortBy, setStudentsSortBy] = useState<"firstName" | "lastName" | "avgScore">("firstName");
  const [gradesFilter, setGradesFilter] = useState<GradesFilterState>({
    type: "all",
    quarter: 1,
    semester: 1,
    academicYear: null,
  });
  const [editingCell, setEditingCell] = useState<{ studentId: string; assessmentId: string } | null>(null);
  const [editingScore, setEditingScore] = useState<string>("");
  const [savingCell, setSavingCell] = useState<{ studentId: string; assessmentId: string } | null>(null);

  // Fetch grades data
  const fetchGrades = useCallback(async () => {
    if (!classId || gradesData || gradesLoading) return;
    setGradesLoading(true);
    try {
      const data = await cachedFetch(`/api/classes/${classId}/grades`);
      if (data) {
        setGradesData(data);
      } else {
        // API returned error (e.g. 403) — set empty data to prevent infinite retry
        setGradesData({ assessments: [], students: [], submissionMap: {} });
      }
    } catch {
      // Network error — set empty data to prevent infinite retry
      setGradesData({ assessments: [], students: [], submissionMap: {} });
    } finally {
      setGradesLoading(false);
    }
  }, [classId, gradesData, gradesLoading]);

  useEffect(() => {
    if (!gradesData && !gradesLoading) {
      fetchGrades();
    }
  }, [gradesData, gradesLoading, fetchGrades]);

  const savingRef = useRef(false);
  const saveGradeScore = useCallback(async (studentId: string, assessmentId: string, newScore: number, maxScore: number) => {
    if (savingRef.current) return;
    savingRef.current = true;
    const key = { studentId, assessmentId };
    setEditingCell(null);
    setSavingCell(key);
    try {
      const res = await fetch(`/api/classes/${classId}/grades/set-score`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, assessmentId, score: newScore, maxScore }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Failed");
      }
      setGradesData((prev) => {
        if (!prev) return prev;
        const mapKey = `${studentId}-${assessmentId}`;
        return {
          ...prev,
          submissionMap: {
            ...prev.submissionMap,
            [mapKey]: { ...(prev.submissionMap[mapKey] || {}), score: newScore, maxScore, status: "GRADED", submittedAt: prev.submissionMap[mapKey]?.submittedAt ?? new Date().toISOString() },
          },
        };
      });
    } catch (err) {
      toast({ title: language === "uz" ? "Xatolik yuz berdi" : language === "ru" ? "Ошибка сохранения" : "Failed to save score", description: String(err), variant: "destructive" });
    } finally {
      setSavingCell(null);
      savingRef.current = false;
    }
  }, [classId, language, toast]);

  const academicYears = useMemo(
    () => getAcademicYears(gradesData?.assessments ?? []),
    [gradesData]
  );

  const defaultAcademicYear = useMemo(
    () => academicYears[0] ?? getAcademicYearStart(new Date()),
    [academicYears]
  );

  const currentAcademicYearStart = useMemo(
    () => getAcademicYearStart(new Date()),
    []
  );

  const academicYearOptions = useMemo(() => {
    const options = new Set<number>([currentAcademicYearStart, ...academicYears, defaultAcademicYear]);
    return Array.from(options).sort((a, b) => b - a);
  }, [currentAcademicYearStart, academicYears, defaultAcademicYear]);

  useEffect(() => {
    setGradesFilter((prev) => {
      if (prev.academicYear != null && academicYearOptions.includes(prev.academicYear)) {
        return prev;
      }
      return { ...prev, academicYear: academicYearOptions[0] ?? prev.academicYear };
    });
  }, [academicYearOptions]);

  const gradesDateRange = useMemo(
    () => getGradesDateRange(gradesFilter, defaultAcademicYear),
    [gradesFilter, defaultAcademicYear]
  );

  const filteredAssessments = useMemo(() => {
    if (!gradesData) return [];
    if (!gradesDateRange) return gradesData.assessments;

    return gradesData.assessments.filter((assessment) => {
      const createdAt = new Date(assessment.createdAt);
      if (Number.isNaN(createdAt.getTime())) return false;
      return createdAt >= gradesDateRange.from && createdAt <= gradesDateRange.to;
    });
  }, [gradesData, gradesDateRange]);

  const currentAcademicSelection = useMemo(
    () => getCurrentAcademicSelection(new Date()),
    []
  );

  const timelineSecondaryOptions = useMemo(() => {
    if (gradesFilter.type === "quarter") {
      return academicYearOptions.flatMap((academicYear) =>
        ([1, 2, 3, 4] as const).map((quarter) => ({
          value: `${academicYear}-q${quarter}`,
          label: `Q${quarter} ${formatAcademicYearLabel(academicYear)}`,
        }))
      );
    }

    if (gradesFilter.type === "semester") {
      return academicYearOptions.flatMap((academicYear) =>
        ([1, 2] as const).map((semester) => ({
          value: `${academicYear}-s${semester}`,
          label: `S${semester} ${formatAcademicYearLabel(academicYear)}`,
        }))
      );
    }

    if (gradesFilter.type === "year") {
      return academicYearOptions.map((academicYear) => ({
        value: `${academicYear}`,
        label: formatAcademicYearLabel(academicYear),
      }));
    }

    return [];
  }, [gradesFilter.type, academicYearOptions]);

  const timelineSecondaryValue = useMemo(() => {
    const selectedAcademicYear = gradesFilter.academicYear ?? defaultAcademicYear;

    if (gradesFilter.type === "quarter") {
      return `${selectedAcademicYear}-q${gradesFilter.quarter}`;
    }

    if (gradesFilter.type === "semester") {
      return `${selectedAcademicYear}-s${gradesFilter.semester}`;
    }

    if (gradesFilter.type === "year") {
      return `${selectedAcademicYear}`;
    }

    return "";
  }, [gradesFilter, defaultAcademicYear]);

  const studentAvgScores = useMemo(() => {
    if (!gradesData) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const student of gradesData.students) {
      let totalPct = 0;
      let count = 0;
      for (const assessment of gradesData.assessments) {
        const sub = gradesData.submissionMap[`${student.id}-${assessment.id}`];
        if (sub && sub.score != null && sub.maxScore != null && sub.maxScore > 0) {
          totalPct += (sub.score / sub.maxScore) * 100;
          count++;
        }
      }
      map.set(student.id, count > 0 ? totalPct / count : -1);
    }
    return map;
  }, [gradesData]);

  const sortedStudents = useMemo(() => {
    if (!gradesData) return [];

    const getFirstName = (fullName: string) => fullName.trim().split(/\s+/)[0] ?? fullName;
    const getLastName = (fullName: string) => {
      const parts = fullName.trim().split(/\s+/);
      return parts[parts.length - 1] ?? fullName;
    };

    return [...gradesData.students].sort((a, b) => {
      if (studentsSortBy === "avgScore") {
        const avgA = studentAvgScores.get(a.id) ?? -1;
        const avgB = studentAvgScores.get(b.id) ?? -1;
        if (avgA !== avgB) return avgB - avgA;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }
      const primaryA = studentsSortBy === "firstName" ? getFirstName(a.name) : getLastName(a.name);
      const primaryB = studentsSortBy === "firstName" ? getFirstName(b.name) : getLastName(b.name);
      const primaryCompared = primaryA.localeCompare(primaryB, undefined, { sensitivity: "base" });
      if (primaryCompared !== 0) return primaryCompared;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  }, [gradesData, studentsSortBy, studentAvgScores]);

  if (isFreePlan) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Lock className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">
          {language === "uz" ? "Analitika faqat Plus va Pro foydalanuvchilari uchun" : language === "ru" ? "Аналитика доступна только для Plus и Pro" : "Analytics available for Plus & Pro users"}
        </h3>
        <p className="text-sm text-muted-foreground mb-6 max-w-sm">
          {language === "uz" ? "Baholar jadvali, eksport va batafsil statistikadan foydalanish uchun tarifni oshiring." : language === "ru" ? "Обновите тариф для доступа к таблице оценок, экспорту и подробной статистике." : "Upgrade your plan to access the grades table, export, and detailed statistics."}
        </p>
        <Link href="/shop">
          <Button className="gap-2">
            <Crown className="h-4 w-4" />
            {language === "uz" ? "Tarifni oshirish" : language === "ru" ? "Обновить тариф" : "Upgrade Plan"}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="mx-auto w-full pl-4 pr-3 sm:pl-6 sm:pr-4 md:pl-8 md:pr-6">
        {gradesLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !gradesData || gradesData.assessments.length === 0 ? (
          <div className="text-center py-16">
            <ClipboardList className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground">
              {language === "uz" ? "Hali baholangan ishlar yo'q" : language === "ru" ? "Нет заданий для оценки" : "No assessments yet"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2" data-guide="grades-toolbar">
              <span className="text-xs text-muted-foreground">
                {gradesData.students.length} {language === "uz" ? "o'quvchi" : language === "ru" ? "уч." : "students"}
              </span>
              <div className="flex items-center gap-2 ml-auto flex-wrap">
              {/* Mobile sort control */}
              <div className="relative md:hidden">
                <select
                  value={studentsSortBy}
                  onChange={(e) => setStudentsSortBy(e.target.value as "firstName" | "lastName" | "avgScore")}
                  className="h-8 appearance-none rounded-md border border-border/40 bg-transparent pl-2.5 pr-7 text-xs font-medium text-foreground/70 outline-none transition-colors hover:bg-muted focus:ring-0"
                >
                  <option value="firstName">{language === "uz" ? "Ism" : language === "ru" ? "Имя" : "Name"}</option>
                  <option value="lastName">{language === "uz" ? "Familiya" : language === "ru" ? "Фамилия" : "Last name"}</option>
                  <option value="avgScore">{language === "uz" ? "O'rtacha ball" : language === "ru" ? "Ср. балл" : "Avg score"}</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              </div>
              <select
                value={gradesFilter.type}
                onChange={(e) => {
                  const nextType = e.target.value as GradesTimelineType;
                  setGradesFilter((prev) => {
                    if (nextType === "quarter") {
                      return {
                        ...prev,
                        type: nextType,
                        quarter: currentAcademicSelection.quarter,
                        academicYear: currentAcademicSelection.academicYear,
                      };
                    }
                    if (nextType === "semester") {
                      return {
                        ...prev,
                        type: nextType,
                        semester: currentAcademicSelection.semester,
                        academicYear: currentAcademicSelection.academicYear,
                      };
                    }
                    if (nextType === "year") {
                      return {
                        ...prev,
                        type: nextType,
                        academicYear: currentAcademicSelection.academicYear,
                      };
                    }
                    return {
                      ...prev,
                      type: nextType,
                    };
                  });
                }}
                className="h-8 min-w-[168px] rounded-md border border-border/20 bg-transparent pl-3 pr-7 text-xs font-medium outline-none transition-colors hover:border-border/40 hover:bg-muted/20 focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
              >
                <option value="all">{language === "uz" ? "Barchasi" : language === "ru" ? "Все время" : "All time"}</option>
                <option value="month">{language === "uz" ? "Oxirgi oy" : language === "ru" ? "Последний месяц" : "Last month"}</option>
                <option value="quarter">{language === "uz" ? "Chorak" : language === "ru" ? "Квартал" : "Quarter"}</option>
                <option value="semester">{language === "uz" ? "Semestr" : language === "ru" ? "Семестр" : "Semester"}</option>
                <option value="year">{language === "uz" ? "Yil" : language === "ru" ? "Год" : "Year"}</option>
              </select>
              {(gradesFilter.type === "quarter" || gradesFilter.type === "semester" || gradesFilter.type === "year") && (
                <select
                  value={timelineSecondaryValue}
                  onChange={(e) => {
                    const value = e.target.value;
                    setGradesFilter((prev) => {
                      if (prev.type === "quarter") {
                        const match = value.match(/^(\d+)-q([1-4])$/);
                        if (!match) return prev;
                        return {
                          ...prev,
                          academicYear: Number.parseInt(match[1]!, 10),
                          quarter: Number.parseInt(match[2]!, 10) as 1 | 2 | 3 | 4,
                        };
                      }
                      if (prev.type === "semester") {
                        const match = value.match(/^(\d+)-s([1-2])$/);
                        if (!match) return prev;
                        return {
                          ...prev,
                          academicYear: Number.parseInt(match[1]!, 10),
                          semester: Number.parseInt(match[2]!, 10) as 1 | 2,
                        };
                      }
                      if (prev.type === "year") {
                        const nextYear = Number.parseInt(value, 10);
                        if (Number.isNaN(nextYear)) return prev;
                        return {
                          ...prev,
                          academicYear: nextYear,
                        };
                      }
                      return prev;
                    });
                  }}
                  className="h-8 min-w-[220px] rounded-md border border-border/20 bg-transparent pl-3 pr-7 text-xs font-medium outline-none transition-colors hover:border-border/40 hover:bg-muted/20 focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
                >
                  {timelineSecondaryOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
              <button
                data-guide="grades-export"
                onClick={async () => {
                  try {
                    const params = new URLSearchParams({ filterType: gradesFilter.type });
                    if (gradesFilter.type === "quarter" && gradesFilter.quarter != null) {
                      params.set("quarter", String(gradesFilter.quarter));
                      params.set("academicYear", String(gradesFilter.academicYear ?? new Date().getFullYear()));
                    }
                    if (gradesFilter.type === "semester" && gradesFilter.semester != null) {
                      params.set("semester", String(gradesFilter.semester));
                      params.set("academicYear", String(gradesFilter.academicYear ?? new Date().getFullYear()));
                    }
                    if (gradesFilter.type === "year" && gradesFilter.academicYear != null) {
                      params.set("academicYear", String(gradesFilter.academicYear));
                    }
                    const res = await fetch(`/api/classes/${classId}/grades/export?${params.toString()}`);
                    if (!res.ok) throw new Error("Export failed");
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `grades-${classData?.name ?? classId}.xlsx`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  } catch {
                    toast({ title: language === "uz" ? "Eksport xatoligi" : language === "ru" ? "Ошибка экспорта" : "Export failed", variant: "destructive" });
                  }
                }}
                className="h-8 px-3 flex items-center gap-1.5 rounded-md border border-border/40 bg-transparent text-xs font-medium text-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
                title={language === "uz" ? "Excel'ga eksport qilish" : language === "ru" ? "Экспорт в Excel" : "Export to Excel"}
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">
                  {language === "uz" ? "Eksport" : language === "ru" ? "Экспорт" : "Export"}
                </span>
              </button>
              </div>
            </div>

            {filteredAssessments.length === 0 ? (
              <div className="rounded-lg border border-border py-12 text-center">
                <ClipboardList className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground">
                  {language === "uz"
                    ? "Tanlangan davrda baholash topshiriqlari yo'q"
                    : language === "ru"
                      ? "В выбранном периоде нет заданий"
                      : "No assessments in the selected timeline"}
                </p>
              </div>
            ) : (
              <>
              {/* Mobile card view */}
              <div className="block md:hidden space-y-2">
                {sortedStudents.map((student) => {
                  const scores: { score: number; maxScore: number }[] = [];
                  filteredAssessments.forEach((assessment) => {
                    const sub = gradesData!.submissionMap[`${student.id}-${assessment.id}`];
                    if (sub?.status === "GRADED" && sub.score != null && (sub.maxScore || assessment.actualMaxScore)) {
                      scores.push({ score: sub.score, maxScore: sub.maxScore || assessment.actualMaxScore || 100 });
                    }
                  });
                  const avgPct = scores.length > 0
                    ? Math.round(scores.reduce((sum, s) => sum + (s.score / s.maxScore) * 100, 0) / scores.length)
                    : null;
                  return (
                    <div key={student.id} className="rounded-lg border border-border bg-background overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2.5 bg-muted/40">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                            <span className="text-xs font-medium">{student.name.charAt(0).toUpperCase()}</span>
                          </div>
                          <span className="font-semibold text-sm">{student.name}</span>
                        </div>
                        {avgPct != null && (
                          <span className={`text-sm font-bold ${getGradesScoreColor(avgPct, 100)}`}>{avgPct}%</span>
                        )}
                      </div>
                      <div className="divide-y divide-border">
                        {filteredAssessments.map((assessment) => {
                          const sub = gradesData!.submissionMap[`${student.id}-${assessment.id}`];
                          const effectiveMax = assessment.actualMaxScore || sub?.maxScore || assessment.totalMarks || null;
                          return (
                            <div key={assessment.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                              <span className="text-muted-foreground truncate max-w-[60%]">{assessment.title}</span>
                              {sub?.status === "GRADED" && sub.score != null ? (
                                <span className={`font-semibold ${getGradesScoreColor(sub.score, effectiveMax || sub.maxScore || 100)}`}>
                                  {sub.score}{effectiveMax != null ? `/${effectiveMax}` : ""}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/40">—</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Desktop table view */}
              <div className="hidden md:block overflow-x-auto rounded-lg border border-border focus:outline-none" data-guide="grades-table">
                <table className="w-full text-sm border-collapse focus:outline-none">
                  <thead>
                    <tr className="bg-muted">
                      <th className="sticky left-0 z-10 bg-muted text-left px-4 py-3 font-semibold text-foreground border-b border-r border-border min-w-[180px]">
                        <div className="flex items-center justify-between gap-2">
                          <span>{t("students")}</span>
                          <div className="relative">
                            <select
                              value={studentsSortBy}
                              onChange={(e) => setStudentsSortBy(e.target.value as "firstName" | "lastName" | "avgScore")}
                              className="h-8 appearance-none rounded-md border-0 bg-transparent pl-3 pr-8 text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:bg-muted/25 hover:text-foreground focus:ring-0"
                            >
                              <option value="firstName">
                                {language === "uz" ? "Ism bo'yicha" : language === "ru" ? "По имени" : "Sort by name"}
                              </option>
                              <option value="lastName">
                                {language === "uz" ? "Familiya bo'yicha" : language === "ru" ? "По фамилии" : "Sort by last name"}
                              </option>
                              <option value="avgScore">
                                {language === "uz" ? "O'rtacha ball bo'yicha" : language === "ru" ? "По среднему баллу" : "Sort by avg score"}
                              </option>
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          </div>
                        </div>
                      </th>
                      {filteredAssessments.map((assessment) => (
                        <th
                          key={assessment.id}
                          className="text-center px-3 py-3 font-medium text-foreground border-b border-r border-border min-w-[100px] max-w-[150px]"
                        >
                          <div className="truncate" title={assessment.title}>
                            {assessment.title}
                          </div>
                          <div className="text-xs text-muted-foreground font-normal mt-0.5">
                            / {assessment.actualMaxScore ?? "?"}
                          </div>
                        </th>
                      ))}
                      <th className="text-center px-3 py-3 font-semibold text-white border-b border-slate-600 min-w-[90px] bg-slate-600 dark:bg-slate-700">
                        {t("average")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedStudents.map((student, idx) => {
                      const studentScores: { score: number; maxScore: number }[] = [];
                      return (
                        <tr
                          key={student.id}
                          className={idx % 2 === 0 ? "bg-background" : "bg-muted/30"}
                        >
                          <td className={cn("sticky left-0 z-10 px-4 py-2.5 font-medium border-r border-border", idx % 2 === 0 ? "bg-background" : "bg-muted")}>
                            <div className="flex items-center gap-2">
                              <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                                <span className="text-xs font-medium">
                                  {student.name.charAt(0).toUpperCase()}
                                </span>
                              </div>
                              <span className="truncate">{student.name}</span>
                            </div>
                          </td>
                          {filteredAssessments.map((assessment) => {
                            const sub = gradesData!.submissionMap[`${student.id}-${assessment.id}`];
                            const late = isSubmissionLate(sub?.submittedAt, assessment.dueDate);
                            const effectiveMax = assessment.actualMaxScore || sub?.maxScore || assessment.totalMarks || null;
                            if (sub?.status === "GRADED" && sub.score != null && (sub.maxScore || effectiveMax)) {
                              studentScores.push({ score: sub.score, maxScore: sub.maxScore || effectiveMax || 100 });
                            }
                            const isEditing = editingCell?.studentId === student.id && editingCell?.assessmentId === assessment.id;
                            const isSaving = savingCell?.studentId === student.id && savingCell?.assessmentId === assessment.id;
                            return (
                              <td
                                key={assessment.id}
                                className="text-center px-2 py-1.5 border-r border-border group/cell relative"
                              >
                                {isEditing ? (
                                  <div className="flex items-center justify-center gap-0.5">
                                    <input
                                      type="number"
                                      min={0}
                                      max={effectiveMax ?? undefined}
                                      value={editingScore}
                                      onChange={(e) => setEditingScore(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          const v = parseFloat(editingScore);
                                          if (!isNaN(v) && v >= 0) {
                                            saveGradeScore(student.id, assessment.id, v, effectiveMax ?? v);
                                          }
                                        }
                                        if (e.key === "Escape") {
                                          setEditingCell(null);
                                        }
                                      }}
                                      onBlur={() => {
                                        const v = parseFloat(editingScore);
                                        if (!isNaN(v) && v >= 0) {
                                          saveGradeScore(student.id, assessment.id, v, effectiveMax ?? v);
                                        } else {
                                          setEditingCell(null);
                                        }
                                      }}
                                      autoFocus
                                      className="w-12 text-center text-sm font-semibold bg-transparent border-0 border-b border-foreground/40 focus:border-primary outline-none p-0 pb-0.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    />
                                    {effectiveMax != null && <span className="text-xs text-muted-foreground">/{effectiveMax}</span>}
                                  </div>
                                ) : isSaving ? (
                                  <Loader2 className="h-4 w-4 animate-spin text-primary mx-auto" />
                                ) : !sub ? (
                                  canManageGrades ? (
                                  <button
                                    onClick={() => { setEditingCell({ studentId: student.id, assessmentId: assessment.id }); setEditingScore(""); }}
                                    className="text-[11px] font-medium text-muted-foreground/60 hover:text-primary transition-colors w-full"
                                    title={language === "uz" ? "Ball qo'shish" : language === "ru" ? "Добавить балл" : "Add score"}
                                  >
                                    —
                                  </button>
                                  ) : (
                                    <span className="text-muted-foreground/40">—</span>
                                  )
                                ) : sub.status === "GRADED" && sub.score != null ? (
                                  <div
                                    onClick={canManageGrades ? () => { setEditingCell({ studentId: student.id, assessmentId: assessment.id }); setEditingScore(String(sub.score)); } : undefined}
                                    className={`flex flex-col items-center leading-tight ${canManageGrades ? "cursor-pointer" : ""} group/score`}
                                    title={canManageGrades ? (language === "uz" ? "Ballni tahrirlash" : language === "ru" ? "Редактировать балл" : "Click to edit score") : undefined}
                                  >
                                    <span className={`font-semibold ${getGradesScoreColor(sub.score, effectiveMax || sub.maxScore || 100)}`}>
                                      <span className="group-hover/score:hidden">{sub.score}</span>
                                      <span className="hidden group-hover/score:inline text-xs">{sub.score}/{sub.maxScore || effectiveMax || "?"}</span>
                                    </span>
                                    {late && (
                                      <span className="mt-0.5 text-[10px] font-medium text-muted-foreground">
                                        {language === "uz" ? "kech" : language === "ru" ? "поздно" : "late"}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span
                                    className="w-full flex items-center justify-center"
                                    title={
                                      sub.status === "ERROR"
                                        ? (language === "uz" ? "Xatolik yuz berdi" : language === "ru" ? "Ошибка" : "Error")
                                        : sub.status === "PROCESSING"
                                        ? (language === "uz" ? "Tekshirilmoqda..." : language === "ru" ? "Проверяется..." : "Processing...")
                                        : (language === "uz" ? "Topshirilgan, baholanmagan" : language === "ru" ? "Сдано, не проверено" : "Submitted, not graded")
                                    }
                                  >
                                    {sub.status === "ERROR" ? (
                                      <AlertCircle className="h-4 w-4 text-destructive/60 mx-auto" />
                                    ) : sub.status === "PROCESSING" ? (
                                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/60 mx-auto" />
                                    ) : (
                                      <Clock className="h-4 w-4 text-muted-foreground/50 mx-auto" />
                                    )}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                          <td className="text-center px-3 py-2.5 font-semibold bg-slate-100 dark:bg-slate-700/40 select-none outline-none border-0">
                            {studentScores.length > 0 ? (
                              <span className="text-slate-800 dark:text-slate-100 font-bold">
                                {Math.round(studentScores.reduce((sum, s) => sum + (s.score / s.maxScore) * 100, 0) / studentScores.length)}%
                              </span>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-500">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {/* Class Average Footer */}
                  <tfoot>
                    <tr className="bg-muted font-semibold border-t-2 border-border">
                      <td className="sticky left-0 z-10 bg-muted px-4 py-3 border-r border-border">
                        {t("classAverage")}
                      </td>
                      {filteredAssessments.map((assessment) => {
                        const scores = sortedStudents
                          .map((s) => gradesData!.submissionMap[`${s.id}-${assessment.id}`])
                          .filter((sub) => sub?.status === "GRADED" && sub.score != null && (sub.maxScore || assessment.actualMaxScore));
                        const effectiveMax = assessment.actualMaxScore || assessment.totalMarks || null;
                        const avg = scores.length > 0
                          ? scores.reduce((sum, sub) => sum + sub!.score!, 0) / scores.length
                          : null;
                        const pct = avg != null && effectiveMax != null && effectiveMax > 0
                          ? Math.round((avg / effectiveMax) * 100)
                          : null;
                        return (
                          <td key={assessment.id} className="text-center px-3 py-3 border-r border-border">
                            {pct != null ? (
                              <span className={getGradesScoreColor(avg!, effectiveMax!)}>
                                {pct}%
                              </span>
                            ) : avg != null ? (
                              <span className="font-medium">
                                {Math.round(avg)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="text-center px-3 py-3 bg-slate-200 dark:bg-slate-700/60 font-bold select-none outline-none border-0">
                        {(() => {
                          let totalAvgScore = 0;
                          let totalMaxScore = 0;
                          let hasAny = false;
                          filteredAssessments.forEach((assessment) => {
                            const scores = sortedStudents
                              .map((s) => gradesData!.submissionMap[`${s.id}-${assessment.id}`])
                              .filter((sub) => sub?.status === "GRADED" && sub.score != null && (sub.maxScore || assessment.actualMaxScore));
                            if (scores.length > 0) {
                              const avgRaw = scores.reduce((sum, sub) => sum + sub!.score!, 0) / scores.length;
                              totalAvgScore += avgRaw;
                              totalMaxScore += scores[0]!.maxScore || assessment.actualMaxScore || 0;
                              hasAny = true;
                            }
                          });
                          if (!hasAny || totalMaxScore <= 0) return <span className="text-slate-400 dark:text-slate-500">—</span>;
                          const overallPct = Math.round((totalAvgScore / totalMaxScore) * 100);
                          return (
                            <span className="text-slate-800 dark:text-slate-100">
                              {overallPct}%
                            </span>
                          );
                        })()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
