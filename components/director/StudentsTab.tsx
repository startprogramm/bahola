"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, Plus, Loader2, Copy, Check, ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { ExportBtn } from "@/components/director/ExportBtn";
import { exportDataAsExcel } from "@/lib/director/export-client";
import { useLanguage } from "@/lib/i18n/language-context";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useCachedFetch } from "@/lib/director/use-cached-fetch";
import { chartLegendStyle } from "@/lib/director/chart-theme";
import type { DirectorStudent } from "@/lib/director/types";
import { formatScore, scoreColorForGrade } from "@/lib/director/cambridge";


type SortCol = "name" | "grade" | "subclass" | "avg";
type SortKey = { col: SortCol; dir: "asc" | "desc" };

export function StudentsTab() {
  const router = useRouter();
  const { t } = useLanguage();
  const [gradeFilter, setGradeFilter] = useState<string[]>([]);
  const [subclassFilter, setSubclassFilter] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKeys, setSortKeys] = useState<SortKey[]>([]);
  const [gradeDropdownOpen, setGradeDropdownOpen] = useState(false);
  const [subclassDropdownOpen, setSubclassDropdownOpen] = useState(false);
  const gradeDropdownRef = useRef<HTMLDivElement>(null);
  const subclassDropdownRef = useRef<HTMLDivElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const PAGE_SIZE = 500;
  const [students, setStudents] = useState<DirectorStudent[]>([]);
  const [totalStudents, setTotalStudents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Available grades/subclasses from school membership data
  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});

  const gradeSubclassMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const [grade, subclasses] of Object.entries(filterOptions)) {
      map.set(grade, new Set(subclasses));
    }
    return map;
  }, [filterOptions]);

  const availableGrades = useMemo(() =>
    Array.from(gradeSubclassMap.keys()).sort((a, b) => Number(a) - Number(b)),
    [gradeSubclassMap]
  );

  // Subclasses shown in filter: if grade(s) selected → only subclasses for those grades; else all
  const visibleSubclasses = useMemo(() => {
    const relevantGrades = gradeFilter.length > 0 ? gradeFilter : Array.from(gradeSubclassMap.keys());
    const set = new Set<string>();
    for (const g of relevantGrades) {
      for (const sc of gradeSubclassMap.get(g) || []) set.add(sc);
    }
    return Array.from(set).sort();
  }, [gradeFilter, gradeSubclassMap]);

  // Auto-clear subclass selections that no longer exist for selected grades
  useEffect(() => {
    if (subclassFilter.length > 0 && visibleSubclasses.length > 0) {
      const valid = subclassFilter.filter(sc => visibleSubclasses.includes(sc));
      if (valid.length !== subclassFilter.length) setSubclassFilter(valid);
    }
  }, [visibleSubclasses]); // eslint-disable-line react-hooks/exhaustive-deps

  // Add student dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGrade, setNewGrade] = useState("");
  const [newSubclass, setNewSubclass] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState<{
    email: string;
    password: string;
    name: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchStudents = useCallback((grade: string, subclass: string, search: string, append = false, skipOverride?: number) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const params = new URLSearchParams();
    if (grade) params.set("grade", grade);
    if (subclass) params.set("subclass", subclass);
    if (search) params.set("search", search);
    params.set("take", String(PAGE_SIZE));
    params.set("skip", String(skipOverride ?? 0));
    const url = `/api/director/students?${params}`;

    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    fetch(url, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((data) => {
        if (append) {
          setStudents((prev) => [...prev, ...(data.students || [])]);
        } else {
          setStudents(data.students || []);
        }
        if (typeof data.total === "number") setTotalStudents(data.total);
        if (data.filters) setFilterOptions(data.filters);
        setLoading(false);
        setLoadingMore(false);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setLoading(false);
        setLoadingMore(false);
      });
  }, []);

  const toggleGrade = (g: string) => {
    setGradeFilter((prev) => prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]);
  };

  const toggleSubclass = (s: string) => {
    setSubclassFilter((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  };

  // Initial load
  useEffect(() => {
    fetchStudents("", "", "");
    return () => { abortRef.current?.abort(); };
  }, [fetchStudents]);

  // Grade/subclass filter change → immediate fetch
  useEffect(() => {
    fetchStudents(gradeFilter.join(","), subclassFilter.join(","), searchQuery.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradeFilter, subclassFilter]);

  // Search query change → debounced fetch (300ms)
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      fetchStudents(gradeFilter.join(","), subclassFilter.join(","), searchQuery.trim());
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (gradeDropdownRef.current && !gradeDropdownRef.current.contains(e.target as Node)) {
        setGradeDropdownOpen(false);
      }
      if (subclassDropdownRef.current && !subclassDropdownRef.current.contains(e.target as Node)) {
        setSubclassDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const refetch = useCallback(() => {
    fetchStudents(gradeFilter.join(","), subclassFilter.join(","), searchQuery.trim());
  }, [fetchStudents, gradeFilter, subclassFilter, searchQuery]);

  const handleLoadMore = useCallback(() => {
    fetchStudents(
      gradeFilter.join(","),
      subclassFilter.join(","),
      searchQuery.trim(),
      true,
      students.length
    );
  }, [fetchStudents, gradeFilter, subclassFilter, searchQuery, students.length]);

  const handleSort = (col: SortCol) => {
    setSortKeys(prev => {
      const existing = prev.find(k => k.col === col);
      if (!existing) return [...prev, { col, dir: "asc" }];
      if (existing.dir === "asc") return prev.map(k => k.col === col ? { ...k, dir: "desc" } : k);
      return prev.filter(k => k.col !== col);
    });
  };

  const sortedStudents = useMemo(() => {
    if (sortKeys.length === 0) return students;
    return [...students].sort((a, b) => {
      for (const { col, dir } of sortKeys) {
        let cmp = 0;
        if (col === "name") cmp = (a.name || "").localeCompare(b.name || "");
        else if (col === "grade") cmp = (Number(a.grade) || 0) - (Number(b.grade) || 0);
        else if (col === "subclass") cmp = (a.subclass || "").localeCompare(b.subclass || "");
        else if (col === "avg") cmp = (a.avgScore ?? -1) - (b.avgScore ?? -1);
        if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
      }
      return 0;
    });
  }, [students, sortKeys]);

  // Group radar chart
  const singleGrade = gradeFilter.length === 1 ? gradeFilter[0] : null;
  const singleSubclass = subclassFilter.length === 1 ? subclassFilter[0] : null;
  const groupStatsUrl = singleGrade && singleSubclass
    ? `/api/director/group-stats?grade=${singleGrade}&subclass=${singleSubclass}`
    : null;
  const { data: groupStatsRaw } = useCachedFetch<{
    groups: Record<string, { name: string; avg: number }[]>;
    gradeAvg: { name: string; avg: number }[];
  }>(groupStatsUrl);

  // Transform API response into radar chart format
  const groupStats = useMemo(() => {
    if (!groupStatsRaw || !singleSubclass) return null;
    const groupData = groupStatsRaw.groups?.[singleSubclass];
    const gradeAvg = groupStatsRaw.gradeAvg;
    if (!groupData || !gradeAvg) return null;
    const subjects = groupData.map((item) => {
      const gradeItem = gradeAvg.find((g) => g.name === item.name);
      return { name: item.name, groupAvg: item.avg, gradeAvg: gradeItem?.avg ?? 0 };
    });
    return { subjects };
  }, [groupStatsRaw, singleSubclass]);

  const handleAddStudent = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/director/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          grade: newGrade || undefined,
          subclass: newSubclass || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create student");
      }
      const data = await res.json();
      setCreatedCredentials({
        email: data.credentials.email,
        password: data.credentials.password,
        name: data.student.name,
      });
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error");
    } finally {
      setCreating(false);
    }
  };

  const handleCopyCredentials = () => {
    if (!createdCredentials) return;
    const text = `Ism: ${createdCredentials.name}\nLogin: ${createdCredentials.email}\nParol: ${createdCredentials.password}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const closeAddDialog = () => {
    setAddDialogOpen(false);
    setNewName("");
    setNewGrade("");
    setNewSubclass("");
    setCreatedCredentials(null);
    setCopied(false);
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
        {/* Grade multi-select dropdown */}
        <div className="relative" ref={gradeDropdownRef}>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1 text-sm font-normal"
            onClick={() => { setGradeDropdownOpen((v) => !v); setSubclassDropdownOpen(false); }}
          >
            {gradeFilter.length === 0 ? t("dirFilterAllClasses") : gradeFilter.map((g) => `${g}-sinf`).join(", ")}
            <ChevronDown className="h-3.5 w-3.5 opacity-50" />
          </Button>
          {gradeDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 min-w-[160px] rounded-md border bg-popover p-1.5 shadow-md">
              {availableGrades.map((g) => (
                <label
                  key={g}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-muted cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={gradeFilter.includes(g)}
                    onChange={() => toggleGrade(g)}
                    className="rounded border-input"
                  />
                  {g}-sinf
                </label>
              ))}
              {gradeFilter.length > 0 && (
                <button
                  className="w-full mt-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground text-left"
                  onClick={() => setGradeFilter([])}
                >
                  {t("dirFilterClear")}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Subclass multi-select dropdown */}
        <div className="relative" ref={subclassDropdownRef}>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1 text-sm font-normal"
            onClick={() => { setSubclassDropdownOpen((v) => !v); setGradeDropdownOpen(false); }}
          >
            {subclassFilter.length === 0 ? t("dirFilterAllGroups") : subclassFilter.join(", ")}
            <ChevronDown className="h-3.5 w-3.5 opacity-50" />
          </Button>
          {subclassDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 min-w-[120px] rounded-md border bg-popover p-1.5 shadow-md">
              {visibleSubclasses.map((s) => (
                <label
                  key={s}
                  className="flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-muted cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={subclassFilter.includes(s)}
                    onChange={() => toggleSubclass(s)}
                    className="rounded border-input"
                  />
                  {s}
                </label>
              ))}
              {subclassFilter.length > 0 && (
                <button
                  className="w-full mt-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground text-left"
                  onClick={() => setSubclassFilter([])}
                >
                  {t("dirFilterClear")}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <ExportBtn
            onClick={() => exportDataAsExcel("students")}
            variant="text"
            label="Excel"
            title={t("dirExportAsExcel")}
          />
          <Button size="sm" onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            {t("dirStudentsAddStudent")}
          </Button>
        </div>
      </div>

      {/* Group radar chart */}
      {singleGrade && singleSubclass && groupStats && groupStats.subjects?.length >= 3 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {singleGrade}-sinf {singleSubclass} — {t("dirStudentsSubjectComparison")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={groupStats.subjects} cx="50%" cy="50%" outerRadius="75%">
                  <PolarGrid strokeDasharray="3 3" />
                  <PolarAngleAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} />
                  <Radar
                    name={`${singleGrade}-${singleSubclass}`}
                    dataKey="groupAvg"
                    stroke="#2563eb"
                    fill="#2563eb"
                    fillOpacity={0.3}
                    strokeWidth={2}
                  />
                  <Radar
                    name={`${singleGrade}-${t("dirStudentsGradeAverage")}`}
                    dataKey="gradeAvg"
                    stroke="#9333ea"
                    fill="#9333ea"
                    fillOpacity={0.1}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                  />
                  <Legend wrapperStyle={chartLegendStyle("11px", "8px")} iconType="circle" iconSize={8} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Count */}
      <p className="text-sm text-muted-foreground">
        {loading
          ? t("dirLoading")
          : totalStudents > students.length
            ? `${students.length} / ${totalStudents} ${t("dirStudentsCountLabel")}`
            : `${students.length} ${t("dirStudentsCountLabel")}`
        }
      </p>

      {/* Students list */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : students.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">{t("dirStudentsNotFound")}</p>
      ) : (
        <div className="space-y-2">
          {/* Table header with multi-sort */}
          <div className="hidden md:grid grid-cols-[2fr_80px_50px_80px] gap-2 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider select-none">
            {(["name", "grade", "subclass", "avg"] as const).map((col, i) => {
              const labels = [t("dirTableName"), t("dirTableClass"), t("dirTableGroup"), t("dirTableAverage")];
              const keyIdx = sortKeys.findIndex(k => k.col === col);
              const isActive = keyIdx !== -1;
              const dir = isActive ? sortKeys[keyIdx].dir : null;
              const Icon = !isActive ? ChevronsUpDown : dir === "asc" ? ChevronUp : ChevronDown;
              return (
                <button
                  key={col}
                  onClick={() => handleSort(col)}
                  className={`flex items-center gap-1 hover:text-foreground transition-colors ${i > 0 ? "justify-center" : ""} ${isActive ? "text-foreground" : ""}`}
                >
                  {labels[i]}
                  {!isActive
                    ? <ChevronsUpDown className="h-3 w-3 opacity-40 shrink-0" />
                    : <span className="inline-flex items-center gap-px shrink-0 text-primary bg-primary/15 px-1 rounded leading-none py-0.5">
                        {dir === "asc" ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
                        {sortKeys.length > 1 && <span className="text-[9px] font-bold">{keyIdx + 1}</span>}
                      </span>
                  }
                </button>
              );
            })}
          </div>

          {sortedStudents.map((student) => (
            <Card
              key={student.id}
              className="cursor-pointer hover:shadow-sm transition-shadow"
              onClick={() => router.push(`/director/student/${student.id}`)}
            >
              <CardContent className="py-2.5 px-4">
                <div className="grid grid-cols-1 md:grid-cols-[2fr_80px_50px_80px] gap-2 items-center">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{student.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate md:hidden">
                      {student.grade ? `${student.grade}-sinf` : "—"} {student.subclass || ""}
                    </p>
                  </div>
                  <p className="hidden md:block text-sm text-center">
                    {student.grade ? `${student.grade}-sinf` : "—"}
                  </p>
                  <p className="hidden md:block text-sm text-center">
                    {student.subclass || "—"}
                  </p>
                  <p className={`hidden md:block text-sm font-semibold text-center ${scoreColorForGrade(student.avgScore, student.grade)}`}>
                    {formatScore(student.avgScore, student.grade)}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Show more button */}
      {!loading && students.length < totalStudents && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="gap-2"
          >
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("dirStudentsShowMore")}
          </Button>
        </div>
      )}

      {/* Add Student Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={(open) => { if (!open) closeAddDialog(); else setAddDialogOpen(true); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {createdCredentials ? t("dirStudentsCreated") : t("dirStudentsAddStudent")}
            </DialogTitle>
          </DialogHeader>

          {createdCredentials ? (
            <div className="space-y-4 py-2">
              <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg space-y-2">
                <p className="text-sm font-medium">{createdCredentials.name}</p>
                <div className="space-y-1 text-sm">
                  <p><span className="text-muted-foreground">{t("dirLabelLogin")}</span> {createdCredentials.email}</p>
                  <p><span className="text-muted-foreground">{t("dirLabelPassword")}</span> <code className="bg-muted px-1 rounded">{createdCredentials.password}</code></p>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleCopyCredentials}
              >
                {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                {copied ? t("dirCopied") : t("dirCopy")}
              </Button>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>{t("dirTableName")}</Label>
                <Input
                  placeholder={t("dirPlaceholderFullName")}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{t("dirTableClass")}</Label>
                  <select
                    value={newGrade}
                    onChange={(e) => setNewGrade(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">{t("dirPlaceholderSelect")}</option>
                    {availableGrades.map((g) => (
                      <option key={g} value={g}>{g}-sinf</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>{t("dirTableGroup")}</Label>
                  <select
                    value={newSubclass}
                    onChange={(e) => setNewSubclass(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">{t("dirPlaceholderSelect")}</option>
                    {(newGrade
                      ? Array.from(gradeSubclassMap.get(newGrade) || []).sort()
                      : Array.from(new Set(Array.from(gradeSubclassMap.values()).flatMap(s => Array.from(s)))).sort()
                    ).map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            {createdCredentials ? (
              <Button onClick={closeAddDialog}>{t("dirClose")}</Button>
            ) : (
              <>
                <Button variant="outline" onClick={closeAddDialog}>
                  {t("dirCancel")}
                </Button>
                <Button onClick={handleAddStudent} disabled={creating || !newName.trim()}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  {t("dirCreate")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
