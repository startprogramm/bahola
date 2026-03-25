"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, AlertCircle, Info, ChevronRight, CheckCircle2 } from "lucide-react";
import { ExportBtn } from "@/components/director/ExportBtn";
import { exportDataAsExcel } from "@/lib/director/export-client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useCachedFetch } from "@/lib/director/use-cached-fetch";
import { useLanguage } from "@/lib/i18n/language-context";
import type { DirectorIssue } from "@/lib/director/types";

const STORAGE_KEY = "director-resolved-issues";

type Filter = "critical" | "warning" | "done" | null;

export function IssuesTab() {
  const router = useRouter();
  const { t } = useLanguage();
  const [filter, setFilter] = useState<Filter>(null);
  const { data: issuesData, loading } = useCachedFetch<{ issues: DirectorIssue[] }>("/api/director/issues");
  const issues = issuesData?.issues || [];

  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [crossingIds, setCrossingIds] = useState<Set<string>>(new Set());
  const [slidingIds, setSlidingIds] = useState<Set<string>>(new Set());

  // Load resolved IDs from localStorage after mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setResolvedIds(new Set(JSON.parse(stored)));
    } catch { /* ignore */ }
  }, []);

  const handleDone = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Step 1: strike through immediately
    setCrossingIds(prev => new Set([...prev, id]));
    // Step 2: slide left after 350ms
    setTimeout(() => {
      setSlidingIds(prev => new Set([...prev, id]));
      // Step 3: remove from DOM after another 350ms (700ms total)
      setTimeout(() => {
        setResolvedIds(prev => {
          const next = new Set([...prev, id]);
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
          return next;
        });
        setCrossingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        setSlidingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
      }, 350);
    }, 350);
  };

  const severityConfig = {
    critical: {
      icon: AlertTriangle,
      color: "text-red-600",
      bg: "bg-red-50 dark:bg-red-900/20",
      badge: "destructive" as const,
      label: t("dirCritical"),
    },
    warning: {
      icon: AlertCircle,
      color: "text-orange-600",
      bg: "bg-orange-50 dark:bg-orange-900/20",
      badge: "secondary" as const,
      label: t("dirWarning"),
    },
    info: {
      icon: Info,
      color: "text-blue-600",
      bg: "bg-blue-50 dark:bg-blue-900/20",
      badge: "outline" as const,
      label: t("dirIssuesInfo"),
    },
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center mb-3">
            <AlertTriangle className="h-6 w-6 text-emerald-600" />
          </div>
          <p className="font-medium">{t("dirNoIssues")}</p>
          <p className="text-sm text-muted-foreground mt-1">{t("dirIssuesAllOk")}</p>
        </CardContent>
      </Card>
    );
  }

  const unresolvedIssues = issues.filter(i => !resolvedIds.has(i.id));
  const resolvedIssues = issues.filter(i => resolvedIds.has(i.id));
  const criticalCount = unresolvedIssues.filter(i => i.severity === "critical").length;
  const warningCount = unresolvedIssues.filter(i => i.severity === "warning").length;
  const doneCount = resolvedIssues.length;

  const displayedIssues = filter === "done"
    ? resolvedIssues
    : filter
      ? unresolvedIssues.filter(i => i.severity === filter)
      : unresolvedIssues;

  const toggle = (f: Filter) => setFilter(prev => prev === f ? null : f);

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-2 items-center flex-wrap justify-between">
        <div className="flex gap-2 items-center flex-wrap">
          {criticalCount > 0 && (
            <button onClick={() => toggle("critical")}>
              <Badge
                variant="destructive"
                className={`gap-1 cursor-pointer transition-opacity ${filter === "critical" ? "ring-2 ring-red-400 ring-offset-1" : filter !== null ? "opacity-50" : ""}`}
              >
                <AlertTriangle className="h-3 w-3" />
                {criticalCount} {t("dirCritical").toLowerCase()}
              </Badge>
            </button>
          )}
          {warningCount > 0 && (
            <button onClick={() => toggle("warning")}>
              <Badge
                variant="secondary"
                className={`gap-1 cursor-pointer transition-opacity bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-400 ${filter === "warning" ? "ring-2 ring-orange-400 ring-offset-1" : filter !== null ? "opacity-50" : ""}`}
              >
                <AlertCircle className="h-3 w-3" />
                {warningCount} {t("dirWarning").toLowerCase()}
              </Badge>
            </button>
          )}
          {doneCount > 0 && (
            <button onClick={() => toggle("done")}>
              <Badge
                variant="outline"
                className={`gap-1 cursor-pointer transition-opacity border-emerald-500 text-emerald-600 ${filter === "done" ? "ring-2 ring-emerald-400 ring-offset-1 bg-emerald-50 dark:bg-emerald-900/20" : filter !== null ? "opacity-50" : ""}`}
              >
                <CheckCircle2 className="h-3 w-3" />
                {doneCount} {t("dirIssuesDone").toLowerCase()}
              </Badge>
            </button>
          )}
          <span className="text-sm text-muted-foreground">
            {filter === "done"
              ? `${doneCount} ${t("dirIssuesResolved")}`
              : filter
                ? `${displayedIssues.length} ${t("dirIssuesShowing")}`
                : `${t("dirIssuesTotal")} ${unresolvedIssues.length}`}
          </span>
        </div>
        <ExportBtn
          onClick={() => exportDataAsExcel("issues")}
          variant="text"
          label="Excel"
          title={t("dirExportAsExcel")}
        />
      </div>

      {/* Issue cards */}
      <div className="space-y-2 overflow-x-hidden">
        {displayedIssues.length === 0 && (
          <p className="text-center text-muted-foreground text-sm py-6">
            {filter === "done" ? t("dirIssuesNoResolved") : t("dirNoIssues")}
          </p>
        )}
        {displayedIssues.map((issue) => {
          const config = severityConfig[issue.severity];
          const Icon = config.icon;
          const isCrossing = crossingIds.has(issue.id);
          const isSliding = slidingIds.has(issue.id);
          const isDone = resolvedIds.has(issue.id);
          return (
            <div
              key={issue.id}
              style={{
                transform: isSliding ? "translateX(-110%)" : "translateX(0)",
                opacity: isSliding ? 0 : 1,
                transition: "transform 0.35s ease-in, opacity 0.35s ease-in",
              }}
            >
              <Card
                className={`cursor-pointer hover:shadow-md transition-shadow border-l-4 ${
                  isDone
                    ? "border-l-emerald-400 opacity-60"
                    : issue.severity === "critical"
                    ? "border-l-red-500"
                    : issue.severity === "warning"
                    ? "border-l-amber-500"
                    : "border-l-blue-400"
                }`}
                onClick={() => {
                  if (issue.classId) router.push(`/director/class/${issue.classId}`);
                }}
              >
                <CardContent className="py-3 px-4">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${config.bg} shrink-0 mt-0.5`}>
                      <Icon className={`h-4 w-4 ${config.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className={`font-medium text-sm ${(isCrossing || isDone) ? "line-through text-muted-foreground" : ""}`}>
                          {issue.title}
                        </p>
                        {isDone
                          ? <Badge variant="outline" className="text-[10px] shrink-0 border-emerald-500 text-emerald-600">{t("dirIssuesDone")}</Badge>
                          : <Badge variant={config.badge} className={`text-[10px] shrink-0 ${issue.severity === "warning" ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" : ""}`}>{config.label}</Badge>
                        }
                      </div>
                      <p className={`text-xs text-gray-600 dark:text-gray-400 ${(isCrossing || isDone) ? "line-through" : ""}`}>
                        {issue.description}
                      </p>
                      {issue.teacherName && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {t("dirLabelTeacher")} {issue.teacherName}
                        </p>
                      )}
                    </div>
                    {/* Done button — rightmost, only for unresolved */}
                    {!isDone && !isCrossing && (
                      <button
                        onClick={(e) => handleDone(issue.id, e)}
                        className="shrink-0 text-xs px-2.5 py-1.5 rounded-md border border-emerald-400 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors ml-1 font-medium"
                      >
                        {t("dirIssuesDone")}
                      </button>
                    )}
                    {issue.classId && !isCrossing && (
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
