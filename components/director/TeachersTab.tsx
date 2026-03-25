"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown, CreditCard, BookOpen, ExternalLink, Search
} from "lucide-react";
import { ExportBtn } from "@/components/director/ExportBtn";
import { exportDataAsExcel } from "@/lib/director/export-client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useCachedFetch } from "@/lib/director/use-cached-fetch";
import { useLanguage } from "@/lib/i18n/language-context";
import type { TeacherUsage } from "@/lib/director/types";

interface GradeGroup {
  grade: string;
  classes: TeacherUsage["classes"];
}

function groupClassesByGrade(classes: TeacherUsage["classes"]): GradeGroup[] {
  const map = new Map<string, TeacherUsage["classes"]>();
  for (const cls of classes) {
    const match = cls.name.match(/^(\d+)/);
    const grade = match ? match[1] : "?";
    if (!map.has(grade)) map.set(grade, []);
    map.get(grade)!.push(cls);
  }
  return Array.from(map.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([grade, classes]) => ({ grade, classes }));
}

type SortCol = "name" | "credits" | "classes";
type SortKey = { col: SortCol; dir: "asc" | "desc" };

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
    <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 tracking-wide bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600">{sub}</span>
  );
}

export function TeachersTab() {
  const { t } = useLanguage();
  const router = useRouter();
  const { data: teachersData, loading } = useCachedFetch<{ teachers: TeacherUsage[] }>("/api/director/teachers/usage");
  const teachers = teachersData?.teachers || [];
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedGrades, setExpandedGrades] = useState<Set<string>>(new Set());
  const [subjectFilter, setSubjectFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKeys, setSortKeys] = useState<SortKey[]>([]);

  const allSubjects = useMemo(() => {
    const subjects = new Set<string>();
    for (const t of teachers) {
      for (const s of t.subjects || []) {
        if (s) subjects.add(s);
      }
    }
    return Array.from(subjects).sort();
  }, [teachers]);

  const filteredTeachers = useMemo(() => {
    let result = teachers;
    if (subjectFilter) {
      result = result.filter((t) => t.subjects?.includes(subjectFilter));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.email && t.email.toLowerCase().includes(q))
      );
    }
    return result;
  }, [teachers, subjectFilter, searchQuery]);

  const handleSort = (col: SortCol) => {
    setSortKeys(prev => {
      const existing = prev.find(k => k.col === col);
      if (!existing) return [...prev, { col, dir: "asc" }];
      if (existing.dir === "asc") return prev.map(k => k.col === col ? { ...k, dir: "desc" } : k);
      return prev.filter(k => k.col !== col);
    });
  };

  const sortedTeachers = useMemo(() => {
    if (sortKeys.length === 0) return filteredTeachers;
    return [...filteredTeachers].sort((a, b) => {
      for (const { col, dir } of sortKeys) {
        let cmp = 0;
        if (col === "name") cmp = a.name.localeCompare(b.name);
        else if (col === "credits") cmp = (a.creditsUsed ?? 0) - (b.creditsUsed ?? 0);
        else if (col === "classes") cmp = (a.classCount ?? 0) - (b.classCount ?? 0);
        if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
      }
      return 0;
    });
  }, [filteredTeachers, sortKeys]);

  const SortBadge = ({ col }: { col: SortCol }) => {
    const idx = sortKeys.findIndex(k => k.col === col);
    const key = sortKeys.find(k => k.col === col);
    if (!key) return <ChevronsUpDown className="h-3 w-3 opacity-50 shrink-0" />;
    const Arrow = key.dir === "asc" ? ChevronUp : ChevronDown;
    return (
      <span className="inline-flex items-center gap-px shrink-0 text-primary bg-primary/15 px-1 rounded leading-none py-0.5">
        <Arrow className="h-2.5 w-2.5" />
        {sortKeys.length > 1 && <span className="text-[9px] font-bold">{idx + 1}</span>}
      </span>
    );
  };

  const toggleGradeExpand = (teacherId: string, grade: string) => {
    const key = `${teacherId}:${grade}`;
    setExpandedGrades((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("dirFilterSearch")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <select
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">{t("dirFilterAllSubjects")}</option>
          {allSubjects.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Count + multi-sort header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">
            {loading ? t("dirLoading") : `${filteredTeachers.length} ta o'qituvchi`}
          </p>
          <ExportBtn
            onClick={() => exportDataAsExcel("teachers")}
            variant="text"
            label="Excel"
            title={t("dirExportAsExcel")}
          />
        </div>
        {!loading && filteredTeachers.length > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground select-none">
            <span className="mr-1">{t("dirSortBy")}</span>
            {(["name", "credits", "classes"] as const).map((col) => {
              const labels: Record<SortCol, string> = { name: t("dirSortName"), credits: t("dirSortCredits"), classes: t("dirClasses") };
              const isActive = sortKeys.some(k => k.col === col);
              return (
                <button
                  key={col}
                  onClick={() => handleSort(col)}
                  className={`flex items-center gap-0.5 px-2 py-0.5 rounded border transition-colors ${
                    isActive
                      ? "border-primary text-foreground bg-primary/5"
                      : "border-transparent hover:border-border hover:text-foreground"
                  }`}
                >
                  {labels[col]}
                  <SortBadge col={col} />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Teachers list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : filteredTeachers.length === 0 ? (
        <p className="text-muted-foreground text-center py-6 text-sm">
          {teachers.length === 0 ? t("dirTeachersNotFound") : t("dirFilterNoResults")}
        </p>
      ) : (
        <div className="space-y-3">
          {sortedTeachers.map((teacher) => {
            const isExpanded = expandedId === teacher.id;
            const gradeGroups = groupClassesByGrade(teacher.classes);

            return (
              <Card key={teacher.id} className="overflow-hidden">
                <CardContent
                  className="py-3 px-4 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : teacher.id)}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="font-medium text-sm truncate text-primary hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/director/teacher/${teacher.id}`);
                          }}
                        >
                          {teacher.name}
                        </button>
                        <SubBadge sub={teacher.subscription} />
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {teacher.subjects?.join(", ") || "\u2014"}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <p className="text-sm font-bold">{teacher.creditsUsed}</p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("dirLabelCredits")}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-emerald-600">
                          {teacher.subscription === "PRO" || teacher.subscription === "MAX" ? "\u221E" : teacher.credits}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("dirLabelRemaining")}</p>
                      </div>
                      <ChevronDown
                        className={`h-4 w-4 text-muted-foreground transition-transform ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                      />
                    </div>
                  </div>
                </CardContent>

                {isExpanded && (
                  <div className="border-t bg-muted/30 px-4 py-3 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      {t("dirTeachersClassesCount")} ({teacher.classCount})
                    </p>
                    {gradeGroups.map((group) => {
                      const gradeKey = `${teacher.id}:${group.grade}`;
                      const isGradeExpanded = expandedGrades.has(gradeKey);
                      const singleClass = group.classes.length === 1;

                      if (singleClass) {
                        const cls = group.classes[0];
                        return (
                          <div
                            key={cls.id}
                            className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/director/class/${cls.id}`);
                            }}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="text-sm truncate">{cls.name}</span>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                              <span>{cls.studentCount} o&apos;quvchi</span>
                              <ExternalLink className="h-3 w-3" />
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div key={group.grade}>
                          <button
                            type="button"
                            className="flex items-center gap-2 w-full py-1.5 px-2 rounded hover:bg-muted text-left"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleGradeExpand(teacher.id, group.grade);
                            }}
                          >
                            <ChevronRight
                              className={`h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0 ${
                                isGradeExpanded ? "rotate-90" : ""
                              }`}
                            />
                            <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="text-sm font-medium">{group.grade}-sinf</span>
                            <span className="text-xs text-muted-foreground ml-auto">
                              {group.classes.length} ta sinf
                            </span>
                          </button>

                          {isGradeExpanded && (
                            <div className="ml-6 border-l-2 border-muted pl-2 space-y-0.5">
                              {group.classes.map((cls) => (
                                <div
                                  key={cls.id}
                                  className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    router.push(`/director/class/${cls.id}`);
                                  }}
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-sm truncate">{cls.name}</span>
                                    {cls.subject && (
                                      <span className="text-[10px] text-muted-foreground">
                                        {cls.subject}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                                    <span>{cls.studentCount} o&apos;quvchi</span>
                                    <ExternalLink className="h-3 w-3" />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div className="flex gap-4 pt-2 text-xs text-muted-foreground border-t mt-2">
                      <span className="flex items-center gap-1">
                        <CreditCard className="h-3 w-3" />
                        {teacher.email}
                      </span>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
