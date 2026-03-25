"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Users, UserCheck, BookOpen, TrendingUp, AlertTriangle } from "lucide-react";
import dynamic from "next/dynamic";
import type { DirectorTab } from "@/lib/director/types";
import { useLanguage } from "@/lib/i18n/language-context";
import type { TranslationKey } from "@/lib/i18n/translations";
import { useCachedFetch } from "@/lib/director/use-cached-fetch";

interface KPIData {
  passRate: number;
  missingRate: number;
  atRiskCount: number;
  studentCount: number;
  teacherCount: number;
  classCount: number;
  totalGraded: number;
  totalSubmissions: number;
  topImproved: unknown[];
  topDeclined: unknown[];
  gradeAverages: unknown[];
}

// Lazy-load tab components — each is 250-670 lines with heavy deps (recharts, etc.)
const OverviewTab = dynamic(() => import("@/components/director/OverviewTab").then(m => ({ default: m.OverviewTab })));
const ExploreTab = dynamic(() => import("@/components/director/ExploreTab").then(m => ({ default: m.ExploreTab })));
const IssuesTab = dynamic(() => import("@/components/director/IssuesTab").then(m => ({ default: m.IssuesTab })));
const StudentsTab = dynamic(() => import("@/components/director/StudentsTab").then(m => ({ default: m.StudentsTab })));
const TeachersTab = dynamic(() => import("@/components/director/TeachersTab").then(m => ({ default: m.TeachersTab })));
const CambridgeTab = dynamic(() => import("@/components/director/CambridgeTab").then(m => ({ default: m.CambridgeTab })));

const TAB_TITLE_KEYS: Record<DirectorTab, TranslationKey> = {
  overview: "dirOverview",
  teachers: "dirTeachers",
  explore: "dirClasses",
  students: "dirStudents",
  issues: "dirIssues",
  health: "dirOverview",
  cambridge: "dirCambridge",
};

const ALL_TABS: DirectorTab[] = ["overview", "teachers", "explore", "students", "cambridge", "issues"];

function DirectorPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();

  // Track which tabs have been visited (lazy mount, never unmount)
  const [mountedTabs, setMountedTabs] = useState<Set<DirectorTab>>(() => new Set(["overview"]));

  const rawTab = searchParams.get("tab");
  const activeTab: DirectorTab =
    rawTab === "explore" || rawTab === "issues" || rawTab === "students" || rawTab === "teachers" || rawTab === "cambridge"
      ? rawTab
      : "overview";

  // Mount tab on first visit
  if (!mountedTabs.has(activeTab)) {
    setMountedTabs(prev => new Set(prev).add(activeTab));
  }

  const setActiveTab = (tab: DirectorTab) => {
    if (tab === "overview") router.push("/director");
    else router.push(`/director?tab=${tab}`);
  };

  const { data: kpis } = useCachedFetch<KPIData>("/api/director/kpis");

  // No client-side auth check — middleware handles auth + role redirect
  return (
    <>
      {/* Header with inline stats */}
      <header className="flex-shrink-0 sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="flex items-center justify-between px-6 h-14">
          <h2 className="text-lg font-semibold shrink-0">{t(TAB_TITLE_KEYS[activeTab])}</h2>
          {/* Inline KPI stats — hidden on small screens */}
          {kpis && (
            <div className="hidden md:flex items-center gap-1 lg:gap-2">
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full dark:border dark:border-blue-700/50 dark:bg-blue-950/50">
                <Users className="h-4 w-4 text-blue-600 dark:text-blue-300" />
                <span className="text-base font-bold text-blue-700 dark:text-blue-200">{kpis.studentCount}</span>
                <span className="text-xs text-blue-600 dark:text-blue-300 hidden lg:inline">{t("dirKpiStudents")}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full dark:border dark:border-violet-700/50 dark:bg-violet-950/50">
                <UserCheck className="h-4 w-4 text-violet-600 dark:text-violet-300" />
                <span className="text-base font-bold text-violet-700 dark:text-violet-200">{kpis.teacherCount}</span>
                <span className="text-xs text-violet-600 dark:text-violet-300 hidden lg:inline">{t("dirKpiTeachers")}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full dark:border dark:border-cyan-700/50 dark:bg-cyan-950/50">
                <BookOpen className="h-4 w-4 text-cyan-600 dark:text-cyan-300" />
                <span className="text-base font-bold text-cyan-700 dark:text-cyan-200">{kpis.classCount}</span>
                <span className="text-xs text-cyan-600 dark:text-cyan-300 hidden lg:inline">{t("dirKpiClasses")}</span>
              </div>
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full ${kpis.passRate >= 70 ? "dark:border dark:border-emerald-700/50 dark:bg-emerald-950/50" : kpis.passRate >= 50 ? "dark:border dark:border-amber-700/50 dark:bg-amber-950/50" : "dark:border dark:border-red-700/50 dark:bg-red-950/50"}`}>
                <TrendingUp className={`h-4 w-4 ${kpis.passRate >= 70 ? "text-emerald-500 dark:text-emerald-300" : kpis.passRate >= 50 ? "text-amber-500 dark:text-amber-300" : "text-red-500 dark:text-red-300"}`} />
                <span className={`text-base font-bold ${kpis.passRate >= 70 ? "text-emerald-600 dark:text-emerald-200" : kpis.passRate >= 50 ? "text-amber-600 dark:text-amber-200" : "text-red-600 dark:text-red-200"}`}>{kpis.passRate}%</span>
                <span className={`text-xs hidden lg:inline ${kpis.passRate >= 70 ? "text-emerald-500 dark:text-emerald-300" : kpis.passRate >= 50 ? "text-amber-500 dark:text-amber-300" : "text-red-500 dark:text-red-300"}`}>{t("dirKpiPassRate")}</span>
              </div>
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full ${kpis.atRiskCount > 0 ? "dark:border dark:border-red-700/50 dark:bg-red-950/50" : "dark:border dark:border-gray-600/50"}`}>
                <AlertTriangle className={`h-4 w-4 ${kpis.atRiskCount > 0 ? "text-red-500 dark:text-red-300" : "text-gray-400 dark:text-gray-400"}`} />
                <span className={`text-base font-bold ${kpis.atRiskCount > 0 ? "text-red-600 dark:text-red-200" : "text-gray-500 dark:text-gray-400"}`}>{kpis.atRiskCount}</span>
                <span className={`text-xs hidden lg:inline ${kpis.atRiskCount > 0 ? "text-red-500 dark:text-red-300" : "text-gray-400 dark:text-gray-400"}`}>{t("dirKpiAtRisk")}</span>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Tab content — keep-alive: once mounted, stay mounted (hidden via CSS) */}
      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-4 py-6">
          {mountedTabs.has("overview") && (
            <div style={{ display: activeTab === "overview" ? undefined : "none" }}>
              <OverviewTab onNavigate={setActiveTab} />
            </div>
          )}
          {mountedTabs.has("explore") && (
            <div style={{ display: activeTab === "explore" ? undefined : "none" }}>
              <ExploreTab />
            </div>
          )}
          {mountedTabs.has("issues") && (
            <div style={{ display: activeTab === "issues" ? undefined : "none" }}>
              <IssuesTab />
            </div>
          )}
          {mountedTabs.has("students") && (
            <div style={{ display: activeTab === "students" ? undefined : "none" }}>
              <StudentsTab />
            </div>
          )}
          {mountedTabs.has("teachers") && (
            <div style={{ display: activeTab === "teachers" ? undefined : "none" }}>
              <TeachersTab />
            </div>
          )}
          {mountedTabs.has("cambridge") && (
            <div style={{ display: activeTab === "cambridge" ? undefined : "none" }}>
              <CambridgeTab />
            </div>
          )}
        </div>
      </main>
    </>
  );
}

export default function DirectorPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center flex-1">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    }>
      <DirectorPageContent />
    </Suspense>
  );
}
