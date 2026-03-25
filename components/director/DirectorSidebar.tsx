"use client";

import { useState, useEffect, Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard, Users, AlertTriangle, GraduationCap, UserCheck,
  School, LogOut, Moon, Sun, User, ChevronDown, ChevronRight, Menu, Settings, Award, CircleHelp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCachedFetch } from "@/lib/director/use-cached-fetch";
import { useLanguage } from "@/lib/i18n/language-context";
import { useTheme } from "@/lib/theme-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import { clearUserCache } from "@/lib/clear-user-cache";
import { updateCachedTheme } from "@/hooks/use-sound-effects";

type NavTab = "overview" | "explore" | "issues" | "students" | "teachers" | "cambridge";

const NAV_KEYS: { tab: NavTab; key: TranslationKey; Icon: React.ComponentType<{ className?: string }> }[] = [
  { tab: "overview", key: "dirOverview", Icon: LayoutDashboard },
  { tab: "teachers", key: "dirTeachers", Icon: UserCheck },
  { tab: "explore", key: "dirClasses", Icon: Users },
  { tab: "students", key: "dirStudents", Icon: GraduationCap },
  { tab: "cambridge", key: "dirCambridge", Icon: Award },
  { tab: "issues", key: "dirIssues", Icon: AlertTriangle },
];

function SidebarInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useLanguage();
  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const { data: schoolData } = useCachedFetch<{ school: { name: string } | null }>("/api/schools");
  const schoolName = schoolData?.school?.name || "Maktab";

  useEffect(() => { setMounted(true); }, []);

  // Close profile dropdown on outside click
  useEffect(() => {
    if (!profileOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-profile-menu]")) setProfileOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [profileOpen]);

  const getActiveTab = (): NavTab => {
    if (pathname.startsWith("/director/class/")) return "explore";
    if (pathname.startsWith("/director/student/")) return "students";
    if (pathname.startsWith("/director/teacher/")) return "teachers";
    const tab = searchParams.get("tab");
    if (tab === "explore" || tab === "issues" || tab === "students" || tab === "teachers" || tab === "cambridge") return tab;
    return "overview";
  };

  const activeTab = getActiveTab();

  const navigate = (tab: NavTab) => {
    if (tab === "overview") router.push("/director");
    else router.push(`/director?tab=${tab}`);
  };

  return (
    <aside className={cn(
      "flex flex-col bg-[hsl(var(--sidebar-background))] text-[hsl(var(--sidebar-foreground))] transition-all duration-300 ease-out flex-shrink-0",
      collapsed ? "w-[72px]" : "w-[240px]"
    )}>
      {/* Header with hamburger toggle */}
      <div className="h-16 flex items-center gap-3 px-3 border-b border-[hsl(var(--sidebar-border))]">
        {/* Hamburger / expand button — top left */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center w-9 h-9 rounded-lg text-[hsl(var(--sidebar-foreground))]/60 hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))] transition-all duration-200 flex-shrink-0"
          title={collapsed ? t("dirExpand") : t("dirCollapse")}
        >
          {collapsed ? <ChevronRight className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        {/* School info */}
        {!collapsed && (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
              <School className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="font-semibold text-sm leading-tight truncate">{schoolName}</h1>
              <p className="text-xs text-white/60">{t("dirPanel")}</p>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 overflow-y-auto">
        <ul className="space-y-1">
          {NAV_KEYS.map(({ tab, key, Icon }) => {
            const isActive = activeTab === tab;
            const label = t(key);
            return (
              <li key={tab}>
                <button
                  onClick={() => navigate(tab)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 text-left",
                    isActive
                      ? "bg-[hsl(var(--sidebar-primary))] text-[hsl(var(--sidebar-primary-foreground))] font-medium shadow-lg"
                      : "text-[hsl(var(--sidebar-foreground))]/80 hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))]"
                  )}
                  title={collapsed ? label : undefined}
                >
                  <Icon className={cn(
                    "w-5 h-5 flex-shrink-0",
                    isActive ? "text-[hsl(var(--sidebar-primary-foreground))]" : "opacity-70"
                  )} />
                  {!collapsed && <span className="text-sm">{label}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Bottom actions */}
      <div className="p-3 border-t border-[hsl(var(--sidebar-border))] relative" data-profile-menu>
        {/* Drop-UP profile dropdown — absolute, above the button */}
        {profileOpen && !collapsed && (
          <div className="absolute bottom-full left-3 right-3 mb-1 rounded-lg bg-[hsl(var(--sidebar-accent))] overflow-hidden shadow-lg z-50 border border-[hsl(var(--sidebar-border))]">
            {mounted && (
              <button
                onClick={() => {
                  const nextTheme = resolvedTheme === "dark" ? "light" : "dark";
                  setTheme(nextTheme);
                  updateCachedTheme(nextTheme as Parameters<typeof updateCachedTheme>[0]);
                  window.dispatchEvent(new CustomEvent("theme-change", { detail: nextTheme }));
                  setProfileOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-[hsl(var(--sidebar-foreground))]/70 hover:bg-[hsl(var(--sidebar-accent))]/80 hover:text-[hsl(var(--sidebar-foreground))] transition-colors"
              >
                {resolvedTheme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                {resolvedTheme === "dark" ? t("dirLightMode") : t("dirDarkMode")}
              </button>
            )}
            <button
              onClick={() => { setProfileOpen(false); router.push("/director/settings"); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-[hsl(var(--sidebar-foreground))]/70 hover:bg-[hsl(var(--sidebar-accent))]/80 hover:text-[hsl(var(--sidebar-foreground))] transition-colors"
            >
              <Settings className="h-3.5 w-3.5" />
              {t("settings")}
            </button>
            <button
              onClick={() => {
                setProfileOpen(false);
                window.open("https://t.me/baholabot", "_blank");
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-[hsl(var(--sidebar-foreground))]/70 hover:bg-[hsl(var(--sidebar-accent))]/80 hover:text-[hsl(var(--sidebar-foreground))] transition-colors"
            >
              <CircleHelp className="h-3.5 w-3.5" />
              {t("support")}
            </button>
            <div className="border-t border-[hsl(var(--sidebar-border))]" />
            <button
              onClick={() => {
                setProfileOpen(false);
                clearUserCache();
                signOut({ callbackUrl: "/login" });
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-red-400 hover:bg-[hsl(var(--sidebar-accent))]/80 hover:text-red-300 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              {t("logout")}
            </button>
          </div>
        )}

        {/* Profile button */}
        <button
          onClick={() => setProfileOpen(!profileOpen)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[hsl(var(--sidebar-foreground))]/70 hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))] transition-all duration-200"
          title={collapsed ? t("profile") : undefined}
        >
          <User className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span className="text-sm flex-1 text-left">{t("profile")}</span>}
          {!collapsed && <ChevronDown className={cn("w-3 h-3 transition-transform", profileOpen && "rotate-180")} />}
        </button>

        {/* Collapsed: show logout directly */}
        {collapsed && (
          <button
            onClick={() => {
              clearUserCache();
              signOut({ callbackUrl: "/login" });
            }}
            className="w-full flex items-center justify-center px-3 py-2 rounded-lg text-[hsl(var(--sidebar-foreground))]/70 hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))] transition-all duration-200"
            title={t("logout")}
          >
            <LogOut className="w-5 h-5" />
          </button>
        )}
      </div>
    </aside>
  );
}

export function DirectorSidebar() {
  return (
    <Suspense fallback={<div className="w-[240px] flex-shrink-0 bg-[hsl(var(--sidebar-background))]" />}>
      <SidebarInner />
    </Suspense>
  );
}
