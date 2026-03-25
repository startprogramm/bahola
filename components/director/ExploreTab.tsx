"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search, ChevronDown, ChevronRight, ExternalLink, X } from "lucide-react";
import { formatScore, scoreColorForGrade } from "@/lib/director/cambridge";
import { useLanguage } from "@/lib/i18n/language-context";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PerformanceChart } from "@/components/director/PerformanceChart";
import { DistributionChart } from "@/components/director/DistributionChart";
import type { DistSeries } from "@/components/director/DistributionChart";
import { ExportBtn } from "@/components/director/ExportBtn";
import { exportChartAsPNG } from "@/lib/director/export-client";
import { useCachedFetch } from "@/lib/director/use-cached-fetch";
import type { DirectorClass, ScoreBucket } from "@/lib/director/types";

function getMonthPresetRange(preset: string): { from: string; to: string } {
  const now = new Date();
  const m = now.getMonth(); // 0-based: 0=Jan..11=Dec
  const y = now.getFullYear();
  const fmt = (yr: number, mo: number) => `${yr}-${String(mo).padStart(2, "0")}`;
  const to = fmt(y, m + 1);
  // Academic year starts in Sep.  ayear = year when Sep started.
  const ayear = m >= 8 ? y : y - 1; // Sep(8)+ → this year, Jan-Aug → last year
  if (preset === "month") return { from: fmt(m === 0 ? y - 1 : y, m === 0 ? 12 : m), to };
  if (preset === "quarter") {
    // Q1: Sep-Oct, Q2: Nov-Dec, Q3: Jan-Feb-Mar, Q4: Apr-May-Jun
    if (m >= 8 && m <= 9) return { from: fmt(y, 9), to };          // Sep-Oct
    if (m >= 10 && m <= 11) return { from: fmt(y, 11), to };       // Nov-Dec
    if (m >= 0 && m <= 2) return { from: fmt(y, 1), to };          // Jan-Feb-Mar
    if (m >= 3 && m <= 5) return { from: fmt(y, 4), to };          // Apr-May-Jun
    // Jul-Aug: show Q4 of previous academic year
    return { from: fmt(y, 4), to: fmt(y, 6) };
  }
  if (preset === "semester") {
    // S1: Sep-Dec, S2: Jan-Jun
    if (m >= 8) return { from: fmt(y, 9), to };                    // In S1
    if (m <= 5) return { from: fmt(y, 1), to };                    // In S2
    // Jul-Aug: show S2
    return { from: fmt(y, 1), to: fmt(y, 6) };
  }
  if (preset === "year") return { from: fmt(ayear, 9), to };
  return { from: "", to: "" };
}

export interface GradeSelection {
  grade: string;
  subclasses: string[]; // empty = whole grade
}

interface PerformanceData {
  series: { grade: number; thread: string; subject: string }[];
  availableGrades: number[];
}

export function ExploreTab() {
  const router = useRouter();
  const { t } = useLanguage();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [subjectFilters, setSubjectFilters] = useState<string[]>([]);
  const [selections, setSelections] = useState<GradeSelection[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [subjectDropdownOpen, setSubjectDropdownOpen] = useState(false);
  const [expandedGrades, setExpandedGrades] = useState<Set<string>>(new Set());
  const [monthFrom, setMonthFrom] = useState("");
  const [monthTo, setMonthTo] = useState("");
  const [datePreset, setDatePreset] = useState("all");
  const [chartHighlight, setChartHighlight] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const subjectDropdownRef = useRef<HTMLDivElement>(null);
  const classListRef = useRef<HTMLDivElement>(null);

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (subjectDropdownRef.current && !subjectDropdownRef.current.contains(e.target as Node)) {
        setSubjectDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Fetch performance data to get real grades/subclasses (from actual SchoolMembership)
  const { data: perfData } = useCachedFetch<PerformanceData>("/api/director/performance");

  // Build grade → subclasses map from REAL membership data (not class name parsing)
  const gradeSubclassMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const s of perfData?.series || []) {
      const grade = String(s.grade);
      if (!map.has(grade)) map.set(grade, new Set());
      if (s.thread) map.get(grade)!.add(s.thread);
    }
    return map;
  }, [perfData?.series]);

  const availableGrades = useMemo(() =>
    Array.from(gradeSubclassMap.keys()).sort((a, b) => Number(a) - Number(b)),
    [gradeSubclassMap]
  );

  // Available subjects from performance data (real subjects from actual classes)
  const availableSubjects = useMemo(() => {
    const subjects = new Set<string>();
    for (const s of perfData?.series || []) {
      if (s.subject) subjects.add(s.subject);
    }
    return Array.from(subjects).sort();
  }, [perfData?.series]);

  // Cross-filtered subjects: if grade(s) selected, only show subjects taught in those grades
  const filteredSubjects = useMemo(() => {
    if (selections.length === 0) return availableSubjects;
    const selectedGradeNums = new Set(selections.map(s => Number(s.grade)));
    const subjects = new Set<string>();
    for (const s of perfData?.series || []) {
      if (selectedGradeNums.has(s.grade) && s.subject) subjects.add(s.subject);
    }
    return Array.from(subjects).sort();
  }, [selections, perfData?.series, availableSubjects]);

  // Cross-filtered grades: if subject(s) selected, only show grades that teach those subjects
  const filteredGrades = useMemo(() => {
    if (subjectFilters.length === 0) return availableGrades;
    const subjectSet = new Set(subjectFilters);
    return availableGrades.filter(g =>
      (perfData?.series || []).some(s => String(s.grade) === g && subjectSet.has(s.subject))
    );
  }, [subjectFilters, perfData?.series, availableGrades]);

  // Fetch class list (filtered by subjects if selected)
  const params = new URLSearchParams();
  if (subjectFilters.length === 1) params.set("subject", subjectFilters[0]);
  if (search) params.set("search", search);
  const { data: classesData, loading } = useCachedFetch<{ classes: DirectorClass[] }>(
    `/api/director/classes?${params}`,
    { keepPreviousData: true }
  );
  const allClasses = classesData?.classes || [];

  const multiSubjects = subjectFilters.length > 1;

  // ── Distribution: separate curve URL and bar URL ──
  // Curves follow the same simplification as the line chart.
  // Bars may show a different breakdown (e.g., per-grade when curves are aggregate).

  const { curvesUrl, barsUrl } = useMemo(() => {
    const base = new URLSearchParams();
    if (monthFrom) base.set("from", monthFrom);
    if (monthTo) base.set("to", monthTo);

    if (selections.length === 0) {
      // No filters → curves: school-wide aggregate, bars: per-grade (server-side discovery)
      const curvesUrl = `/api/director/score-distribution?${base}`;
      const barsP = new URLSearchParams(base);
      barsP.set("perGrade", "1");
      return { curvesUrl, barsUrl: `/api/director/score-distribution?${barsP}` };
    }

    if (multiSubjects) {
      // Multi-subjects: per-subject for both curves and bars
      const p = new URLSearchParams(base);
      p.set("selections", JSON.stringify(selections));
      p.set("subjects", subjectFilters.join(","));
      const url = `/api/director/score-distribution?${p}`;
      return { curvesUrl: url, barsUrl: null };
    }

    if (subjectFilters.length === 0 && filteredSubjects.length > 1) {
      // Grade/variant selected, no subject filter → curves: per-selection, bars: per-subject
      const curvesP = new URLSearchParams(base);
      curvesP.set("selections", JSON.stringify(selections));
      const curvesUrl = `/api/director/score-distribution?${curvesP}`;
      const barsP = new URLSearchParams(base);
      barsP.set("selections", JSON.stringify(selections));
      barsP.set("subjects", filteredSubjects.join(","));
      return { curvesUrl, barsUrl: `/api/director/score-distribution?${barsP}` };
    }

    // Default: same data for curves and bars
    const p = new URLSearchParams(base);
    p.set("selections", JSON.stringify(selections));
    if (subjectFilters.length === 1) p.set("subject", subjectFilters[0]);
    const url = `/api/director/score-distribution?${p}`;
    return { curvesUrl: url, barsUrl: null };
  }, [selections, subjectFilters, filteredSubjects, multiSubjects, monthFrom, monthTo]);

  const { data: curvesData, loading: curvesLoading } = useCachedFetch<{
    buckets?: ScoreBucket[];
    series?: DistSeries[];
  }>(curvesUrl, { keepPreviousData: true });

  const { data: barsData, loading: barsLoading } = useCachedFetch<{
    series?: DistSeries[];
  }>(barsUrl, { keepPreviousData: true });

  const distLoading = curvesLoading || (barsUrl !== null && barsLoading);

  // Curve series for distribution chart
  const displayDistSeries: DistSeries[] = useMemo(() => {
    if (selections.length === 0 && curvesData?.buckets) {
      // School-wide aggregate → wrap as single series
      return [{ label: t("dirChartOverall"), buckets: curvesData.buckets }];
    }
    return curvesData?.series ?? [];
  }, [selections.length, curvesData, t]);

  // Bar series (only when different from curves)
  const displayBarSeries: DistSeries[] | undefined = useMemo(() => {
    if (barsUrl === null) return undefined; // Same as curves
    if (selections.length === 0) {
      // No filters: bars show per-grade
      return barsData?.series;
    }
    if (subjectFilters.length === 0 && barsData?.series) {
      // Grade/variant + no subjects: merge by subject across selections
      // Labels come as "4A — Matematika" or "4-sinf — Matematika" → extract subject
      const subjMap = new Map<string, ScoreBucket[]>();
      for (const s of barsData.series) {
        const subj = s.label.includes(" — ") ? s.label.split(" — ").slice(1).join(" — ") : s.label;
        if (!subjMap.has(subj)) {
          subjMap.set(subj, Array.from({ length: 10 }, (_, i) => ({
            label: `${i * 10}-${(i + 1) * 10}%`, min: i * 10, max: (i + 1) * 10, count: 0,
          })));
        }
        const buckets = subjMap.get(subj)!;
        for (let i = 0; i < 10; i++) buckets[i].count += s.buckets[i]?.count ?? 0;
      }
      return Array.from(subjMap.entries()).map(([label, buckets]) => ({ label, buckets }));
    }
    return barsData?.series;
  }, [barsUrl, barsData, selections.length, subjectFilters.length]);

  // Filter class list by selected grades and subjects
  const filteredClasses = useMemo(() => {
    let result = allClasses;
    if (selections.length > 0) {
      result = result.filter((cls) => {
        const match = cls.name.match(/^(\d+)/);
        if (!match) return false;
        const grade = match[1];
        return selections.some((sel) => sel.grade === grade);
      });
    }
    if (subjectFilters.length > 0) {
      result = result.filter((cls) =>
        cls.subject && subjectFilters.includes(cls.subject)
      );
    }
    return result;
  }, [allClasses, selections, subjectFilters]);

  // Group filtered classes by (grade, subject) combination
  const groupedClasses = useMemo(() => {
    const groups = new Map<string, {
      grade: string;
      subject: string;
      classes: typeof allClasses;
      avgScore: number | null;
      studentCount: number;
    }>();
    for (const cls of filteredClasses) {
      const m = cls.name.match(/^(\d+)[A-Za-z]?-sinf\s*(.*)?$/);
      const grade = m ? m[1] : String(cls.grade || "?");
      const subject = (m ? m[2]?.trim() : null) || cls.subject || "";
      const key = `${grade}-${subject}`;
      if (!groups.has(key)) {
        groups.set(key, { grade, subject, classes: [], avgScore: null, studentCount: 0 });
      }
      const g = groups.get(key)!;
      g.classes.push(cls);
      g.studentCount += cls.studentCount || 0;
    }
    // Compute avg score as weighted average
    for (const g of groups.values()) {
      const scored = g.classes.filter((c) => c.avgScore !== null);
      if (scored.length > 0) {
        const total = scored.reduce((s, c) => s + (c.avgScore! * (c.studentCount || 1)), 0);
        const cnt = scored.reduce((s, c) => s + (c.studentCount || 1), 0);
        g.avgScore = Math.round(total / cnt);
      }
    }
    return Array.from(groups.values()).sort((a, b) => {
      const gCmp = Number(a.grade) - Number(b.grade);
      return gCmp !== 0 ? gCmp : a.subject.localeCompare(b.subject);
    });
  }, [filteredClasses]);

  const toggleGrade = (grade: string) => {
    setSelections((prev) => {
      const existing = prev.find((s) => s.grade === grade);
      if (existing) return prev.filter((s) => s.grade !== grade);
      setExpandedGrades((eg) => { const n = new Set(eg); n.add(grade); return n; });
      return [...prev, { grade, subclasses: [] }];
    });
  };

  const toggleSubclass = (grade: string, subclass: string) => {
    setSelections((prev) => {
      const existing = prev.find((s) => s.grade === grade);
      if (!existing) return prev;
      const hasSubclass = existing.subclasses.includes(subclass);
      const newSubclasses = hasSubclass
        ? existing.subclasses.filter((s) => s !== subclass)
        : [...existing.subclasses, subclass];
      return prev.map((s) => s.grade === grade ? { ...s, subclasses: newSubclasses } : s);
    });
  };

  const toggleExpand = (grade: string) => {
    setExpandedGrades((prev) => {
      const next = new Set(prev);
      if (next.has(grade)) next.delete(grade); else next.add(grade);
      return next;
    });
  };

  const isGradeSelected = (grade: string) => selections.some((s) => s.grade === grade);
  const isSubclassSelected = (grade: string, subclass: string) => {
    const sel = selections.find((s) => s.grade === grade);
    return sel ? sel.subclasses.includes(subclass) : false;
  };

  const filterLabel = useMemo(() => {
    if (selections.length === 0) return t("dirClasses");
    const parts: string[] = [];
    for (const sel of selections) {
      if (sel.subclasses.length === 0) {
        parts.push(`${sel.grade}-sinf`);
      } else {
        for (const sc of sel.subclasses) parts.push(`${sel.grade}${sc}`);
      }
    }
    if (parts.length <= 3) return parts.join(", ");
    return `${parts.slice(0, 2).join(", ")} +${parts.length - 2}`;
  }, [selections, t]);

  const scoreColor = (score: number | null, grade?: string) => {
    if (score === null) return "text-muted-foreground";
    return scoreColorForGrade(score, grade);
  };

  return (
    <div className="space-y-4">
      {/* Search + Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("dirExploreSearchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Grade + subclass dropdown */}
        <div className="relative" ref={dropdownRef}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="gap-1 min-w-[120px] justify-between h-9"
          >
            <span className="truncate max-w-[200px] text-left text-sm">{filterLabel}</span>
            {selections.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 min-w-[20px] p-0 justify-center text-[10px]">
                {selections.reduce((n, s) => n + (s.subclasses.length || 1), 0)}
              </Badge>
            )}
            <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
          </Button>

          {dropdownOpen && (
            <div className="absolute z-50 mt-1 w-60 bg-popover border rounded-lg shadow-lg py-1 left-0 max-h-80 overflow-y-auto">
              {filteredGrades.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">{t("dirNoData")}</p>
              ) : (
                filteredGrades.map((grade) => {
                  const selected = isGradeSelected(grade);
                  const subclasses = Array.from(gradeSubclassMap.get(grade) || []).sort();
                  const expanded = expandedGrades.has(grade);
                  return (
                    <div key={grade}>
                      <div className="flex items-center px-2 py-1.5 hover:bg-muted/50 rounded-md mx-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleExpand(grade); }}
                          className="p-0.5 mr-1 hover:bg-muted rounded shrink-0"
                        >
                          <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
                        </button>
                        <label className="flex items-center gap-2.5 flex-1 cursor-pointer text-sm py-0.5">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleGrade(grade)}
                            className="h-4 w-4 rounded border-gray-300 cursor-pointer"
                          />
                          <span className="font-medium">{grade}-sinf</span>
                          {subclasses.length > 0 && (
                            <span className="text-xs text-muted-foreground ml-auto">
                              {subclasses.length}
                            </span>
                          )}
                        </label>
                      </div>

                      {expanded && selected && subclasses.length > 0 && (
                        <div className="ml-9 border-l-2 border-muted pl-2 mb-1 mr-1">
                          {subclasses.map((sc) => (
                            <label
                              key={sc}
                              className="flex items-center gap-2.5 px-2 py-1 cursor-pointer text-sm hover:bg-muted/50 rounded-md"
                            >
                              <input
                                type="checkbox"
                                checked={isSubclassSelected(grade, sc)}
                                onChange={() => toggleSubclass(grade, sc)}
                                className="h-4 w-4 rounded border-gray-300 cursor-pointer"
                              />
                              {grade}{sc}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              {selections.length > 0 && (
                <div className="border-t mt-1 pt-1 px-3 pb-1">
                  <button
                    onClick={() => { setSelections([]); setExpandedGrades(new Set()); }}
                    className="text-xs text-muted-foreground hover:text-foreground py-1"
                  >
                    {t("dirFilterClear")}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Subject filter — multi-select dropdown with checkboxes */}
        <div className="relative" ref={subjectDropdownRef}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSubjectDropdownOpen(!subjectDropdownOpen)}
            className="gap-1 min-w-[120px] justify-between h-9"
          >
            <span className="truncate max-w-[200px] text-left text-sm">
              {subjectFilters.length === 0
                ? t("dirFilterSubjects")
                : subjectFilters.length <= 2
                ? subjectFilters.join(", ")
                : `${subjectFilters[0]} +${subjectFilters.length - 1}`}
            </span>
            {subjectFilters.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 min-w-[20px] p-0 justify-center text-[10px]">
                {subjectFilters.length}
              </Badge>
            )}
            <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${subjectDropdownOpen ? "rotate-180" : ""}`} />
          </Button>

          {subjectDropdownOpen && (
            <div className="absolute z-50 mt-1 w-52 bg-popover border rounded-lg shadow-lg py-1 left-0 max-h-80 overflow-y-auto">
              {filteredSubjects.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">{t("dirNoData")}</p>
              ) : (
                filteredSubjects.map((subject) => (
                  <label
                    key={subject}
                    className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-muted/50 rounded-md mx-1 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={subjectFilters.includes(subject)}
                      onChange={() => {
                        setSubjectFilters((prev) =>
                          prev.includes(subject)
                            ? prev.filter((s) => s !== subject)
                            : [...prev, subject]
                        );
                      }}
                      className="h-4 w-4 rounded border-gray-300 cursor-pointer"
                    />
                    {subject}
                  </label>
                ))
              )}
              {subjectFilters.length > 0 && (
                <div className="border-t mt-1 pt-1 px-3 pb-1">
                  <button
                    onClick={() => setSubjectFilters([])}
                    className="text-xs text-muted-foreground hover:text-foreground py-1"
                  >
                    {t("dirFilterClear")}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Date preset filter */}
        <div className="flex gap-1">
          {([
            { key: "all", tKey: "dirDateAll" as const },
            { key: "year", tKey: "dirDateYear" as const },
            { key: "semester", tKey: "dirDateSemester" as const },
            { key: "quarter", tKey: "dirDateQuarter" as const },
            { key: "month", tKey: "dirDateMonth" as const },
          ] as const).map(({ key, tKey }) => {
            const label = t(tKey);
            return (
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
          );
          })}
        </div>
      </div>

      {/* Active selection badges */}
      {(selections.length > 0 || subjectFilters.length > 0) && (
        <div className="flex gap-1.5 flex-wrap">
          {selections.flatMap((sel) => {
            if (sel.subclasses.length === 0) {
              return [(
                <Badge key={sel.grade} variant="secondary" className="gap-1">
                  {sel.grade}-sinf
                  <button onClick={() => toggleGrade(sel.grade)} className="ml-0.5 hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )];
            }
            return sel.subclasses.map((sc) => (
              <Badge key={`${sel.grade}-${sc}`} variant="secondary" className="gap-1">
                {sel.grade}{sc}
                <button onClick={() => toggleSubclass(sel.grade, sc)} className="ml-0.5 hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ));
          })}
          {subjectFilters.map((subject) => (
            <Badge key={subject} variant="secondary" className="gap-1">
              {subject}
              <button
                onClick={() => setSubjectFilters((prev) => prev.filter((s) => s !== subject))}
                className="ml-0.5 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Performance chart + Distribution chart side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PerformanceChart
          selections={selections}
          subjectFilters={subjectFilters}
          monthFrom={monthFrom}
          monthTo={monthTo}
          classes={allClasses}
          highlightValue={chartHighlight}
          onHighlightChange={setChartHighlight}
        />
        <DistributionChart
          series={displayDistSeries}
          barSeries={displayBarSeries}
          loading={distLoading}
          highlightValue={chartHighlight}
          onHighlightChange={setChartHighlight}
        />
      </div>

      {/* Results count + export */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {loading ? t("dirLoading") : `${groupedClasses.length}`}
        </p>
        {!loading && groupedClasses.length > 0 && (
          <ExportBtn
            onClick={() => classListRef.current && exportChartAsPNG(classListRef.current, "sinflar")}
            title={t("dirExportPng")}
          />
        )}
      </div>

      {/* Class list — grouped by (grade, subject) */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : groupedClasses.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">{t("dirExploreNoClasses")}</p>
      ) : (
        <div ref={classListRef} className="space-y-2">
          {groupedClasses.map((g) => (
            <Card
              key={`${g.grade}-${g.subject}`}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() =>
                router.push(
                  `/director/class/${g.classes[0].id}?allIds=${encodeURIComponent(g.classes.map((c) => c.id).join(","))}`
                )
              }
            >
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{g.grade}-sinf {g.subject}</p>
                      <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {g.classes.length} ta bo&apos;lim · {g.studentCount} o&apos;quvchi
                    </p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                      <p className={`text-sm font-bold ${scoreColor(g.avgScore, g.grade)}`}>
                        {g.avgScore !== null ? formatScore(g.avgScore, g.grade) : t("dirInsufficientData")}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("dirLabelAverage")}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

