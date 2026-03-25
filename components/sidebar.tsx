"use client";

import { useState, useEffect, useRef, memo, useCallback, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Home,
  Calendar,
  ListTodo,
  Archive,
  ClipboardCheck,
  ChevronDown,
  ChevronRight,
  X,
  Send,
  Building2,
  Users,
  BarChart3,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cachedFetch, notifyClassesChanged } from "@/lib/fetch-cache";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LogoIcon, LogoText } from "@/components/logo";
import { useLanguage } from "@/lib/i18n/language-context";
import { useToast } from "@/hooks/use-toast";
import { getBannerStyle } from "@/lib/class-banners";

interface NavItem {
  labelKey: "home" | "calendar" | "archivedClasses";
  href: string;
  icon: React.ElementType;
  teacherOnly?: boolean;
  studentOnly?: boolean;
}

interface EnrolledClass {
  id: string;
  name: string;
  headerColor: string;
  bannerStyle?: string | null;
  classAvatar?: string | null;
}

interface ClassesByRole {
  teaching: EnrolledClass[];
  enrolled: EnrolledClass[];
}

const navItems: NavItem[] = [
  { labelKey: "home", href: "/classes", icon: Home },
  { labelKey: "calendar", href: "/calendar", icon: Calendar },
  { labelKey: "archivedClasses", href: "/archived", icon: Archive, teacherOnly: true },
];

function getClassInitials(name: string): string {
  return name.trim()[0]?.toUpperCase() || "?";
}

// Read localStorage values once on mount
function readSidebarState() {
  if (typeof window === "undefined") return { pinned: false, sections: { teaching: false, enrolled: false, toReview: false } };
  const pinned = localStorage.getItem("sidebar-pinned") === "true";
  return {
    pinned,
    sections: {
      teaching: localStorage.getItem("sidebar-teaching-collapsed") === "true",
      enrolled: localStorage.getItem("sidebar-enrolled-collapsed") === "true",
      toReview: localStorage.getItem("sidebar-toReview-collapsed") === "true",
    },
  };
}

/** Memoized class avatar */
const ClassAvatar = memo(function ClassAvatar({ classItem, size }: { classItem: EnrolledClass; size: "sm" | "lg" }) {
  const sizeClass = size === "lg" ? "h-10 w-10 text-sm" : "h-8 w-8 text-xs";
  return (
    <div
      className={cn("rounded-full flex items-center justify-center text-white font-bold shrink-0 overflow-hidden", sizeClass)}
      style={classItem.classAvatar ? {} : { background: classItem.bannerStyle ? getBannerStyle(classItem.bannerStyle) : classItem.headerColor }}
    >
      {classItem.classAvatar
        ? <img src={classItem.classAvatar} alt={classItem.name} className="w-full h-full object-cover" loading="lazy" />
        : getClassInitials(classItem.name)
      }
    </div>
  );
});

export function Sidebar() {
  const initialState = useRef(readSidebarState());
  const [pinned, setPinned] = useState(initialState.current.pinned);
  const [expanded, setExpanded] = useState(initialState.current.pinned);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [classCode, setClassCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [classesByRole, setClassesByRole] = useState<ClassesByRole>({ teaching: [], enrolled: [] });
  const [userSchool, setUserSchool] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const [sectionsCollapsed, setSectionsCollapsed] = useState(initialState.current.sections);
  const [isHovering, setIsHovering] = useState(false);
  const [hasNewTodo, setHasNewTodo] = useState(false);
  const [hasNewToReview, setHasNewToReview] = useState(false);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const { t } = useLanguage();
  const { toast } = useToast();
  const fetchedRef = useRef(false);

  // Event listeners - mount once
  useEffect(() => {
    const handlePinChange = (e: CustomEvent) => {
      setPinned(e.detail);
      setExpanded(e.detail);
    };
    const handleMobileToggle = () => setMobileOpen(prev => !prev);

    window.addEventListener("sidebar-pin-change", handlePinChange as EventListener);
    window.addEventListener("sidebar-mobile-toggle", handleMobileToggle as EventListener);
    return () => {
      window.removeEventListener("sidebar-pin-change", handlePinChange as EventListener);
      window.removeEventListener("sidebar-mobile-toggle", handleMobileToggle as EventListener);
    };
  }, []);

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Fetch school info for director (once per mount, cached)
  const schoolFetchedRef = useRef(false);
  useEffect(() => {
    if (!session || schoolFetchedRef.current) return;
    schoolFetchedRef.current = true;
    cachedFetch("/api/schools", 300_000) // 5 min cache
      .then((d: any) => setUserSchool(d?.school ?? null))
      .catch(() => setUserSchool(null));
  }, [session]);

  // Check for new items in todo/to-review (compare count with localStorage)
  const indicatorFetchedRef = useRef(false);
  useEffect(() => {
    if (!session || indicatorFetchedRef.current) return;
    indicatorFetchedRef.current = true;

    // Fetch todo count (student) — API returns { total, grouped, classIds }
    cachedFetch("/api/todo?status=assigned", 120_000)
      .then((data: any) => {
        const count = typeof data?.total === "number" ? data.total : 0;
        const seen = parseInt(localStorage.getItem("sidebar-todo-seen") || "0", 10);
        if (count > seen) setHasNewTodo(true);
      })
      .catch(() => {});

    // Fetch to-review count (teacher) — API returns { submissions: [...] }
    cachedFetch("/api/to-review", 120_000)
      .then((data: any) => {
        const count = Array.isArray(data?.submissions) ? data.submissions.length : 0;
        const seen = parseInt(localStorage.getItem("sidebar-to-review-seen") || "0", 10);
        if (count > seen) setHasNewToReview(true);
      })
      .catch(() => {});
  }, [session]);

  // Mark indicators as seen when navigating to those pages
  useEffect(() => {
    if (pathname === "/todo" && hasNewTodo) {
      cachedFetch("/api/todo?status=assigned", 120_000)
        .then((data: any) => {
          const count = typeof data?.total === "number" ? data.total : 0;
          localStorage.setItem("sidebar-todo-seen", String(count));
          setHasNewTodo(false);
        })
        .catch(() => setHasNewTodo(false));
    }
    if (pathname === "/to-review" && hasNewToReview) {
      cachedFetch("/api/to-review", 120_000)
        .then((data: any) => {
          const count = Array.isArray(data?.submissions) ? data.submissions.length : 0;
          localStorage.setItem("sidebar-to-review-seen", String(count));
          setHasNewToReview(false);
        })
        .catch(() => setHasNewToReview(false));
    }
  }, [pathname, hasNewTodo, hasNewToReview]);

  // Fetch classes — lightweight sidebar endpoint (only id, name, colors)
  const refreshSidebarClasses = useCallback(() => {
    cachedFetch("/api/sidebar/classes")
      .then((data: any) => {
        setClassesByRole({
          teaching: (data?.teaching || []).map((c: any) => ({
            id: c.id, name: c.name,
            headerColor: c.headerColor || "#2563eb",
            bannerStyle: c.bannerStyle,
            classAvatar: c.classAvatar || null,
          })),
          enrolled: (data?.enrolled || []).map((c: any) => ({
            id: c.id, name: c.name,
            headerColor: c.headerColor || "#2563eb",
            bannerStyle: c.bannerStyle,
            classAvatar: c.classAvatar || null,
          })),
        });
      })
      .catch((error: any) => console.error("Error fetching classes:", error));
  }, []);

  useEffect(() => {
    if (!session || fetchedRef.current) return;
    fetchedRef.current = true;
    refreshSidebarClasses();
  }, [session, refreshSidebarClasses]);

  // Listen for class mutations (create, delete, join, leave) to refresh sidebar
  useEffect(() => {
    const handler = () => refreshSidebarClasses();
    window.addEventListener("classes-changed", handler);
    return () => window.removeEventListener("classes-changed", handler);
  }, [refreshSidebarClasses]);

  const handleMouseEnter = useCallback(() => {
    if (pinned) return;
    setIsHovering(true);
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => setExpanded(true), 200);
  }, [pinned]);

  const handleMouseLeave = useCallback(() => {
    if (pinned) return;
    setIsHovering(false);
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setExpanded(false);
  }, [pinned]);

  const toggleSection = useCallback((section: 'teaching' | 'enrolled' | 'toReview') => {
    setSectionsCollapsed(prev => {
      const newState = { ...prev, [section]: !prev[section] };
      localStorage.setItem(`sidebar-${section}-collapsed`, String(newState[section]));
      return newState;
    });
  }, []);

  const handleJoinClass = useCallback(async () => {
    setJoinError("");
    if (!classCode.trim()) {
      setJoinError(t("enterAClassCode") || "Enter a class code");
      return;
    }

    setJoining(true);
    try {
      const response = await fetch("/api/classes/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: classCode.toUpperCase() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to join class");

      toast({ title: t("joinedSuccessfully"), description: `${t("youHaveJoined")} ${data.class.name}` });
      setJoinDialogOpen(false);
      setClassCode("");
      setJoinError("");
      notifyClassesChanged();
      router.push(`/classes/${data.class.id}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Something went wrong";
      setJoinError(msg);
      toast({ title: t("failedToJoin"), description: msg, variant: "destructive" });
    } finally {
      setJoining(false);
    }
  }, [classCode, toast, t, router]);

  // Hide sidebar in split-screen submission view
  const isSubmissionDetailPage = /\/assessments\/[^/]+\/(submissions\/[^/]+|feedback)/.test(pathname);
  if (!session || isSubmissionDetailPage) return null;

  // Filter nav items based on role
  const hasTeachingClasses = classesByRole.teaching.length > 0;
  const filteredNavItems = navItems.filter((item) => {
    if (item.teacherOnly && !hasTeachingClasses) return false;
    if (item.studentOnly && hasTeachingClasses) return false;
    return true;
  });

  const isCollapsed = !expanded;
  const showIconsOnly = isHovering && !expanded;
  const hasClasses = classesByRole.teaching.length > 0 || classesByRole.enrolled.length > 0;

  const renderClassList = (classes: EnrolledClass[], section: 'teaching' | 'enrolled', showIcons: boolean) => (
    <div className={section === 'teaching' ? "mb-4" : ""}>
      {!showIcons && (
        <button
          onClick={() => toggleSection(section)}
          className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-2 w-full hover:text-foreground transition-colors"
        >
          {sectionsCollapsed[section] ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          <span>{t(section === 'teaching' ? "teaching" : "enrolled")}</span>
        </button>
      )}
      {!sectionsCollapsed[section] && (
        <div className="space-y-1">
          {/* Section-specific nav link: To-review for teachers, Todo for students */}
          {!showIcons && (() => {
            const sectionLink = section === 'teaching'
              ? { href: "/to-review", icon: ClipboardCheck, labelKey: "toReview" as const, guide: "sidebar-to-review" }
              : { href: "/todo", icon: ListTodo, labelKey: "todo" as const, guide: "sidebar-todo" };
            const isLinkActive = pathname === sectionLink.href;
            const hasNew = section === 'teaching' ? hasNewToReview : hasNewTodo;
            return (
              <Link
                href={sectionLink.href}
                data-guide={sectionLink.guide}
                className={cn(
                  "no-underline flex items-center gap-3 px-3 py-2 rounded-full transition-all duration-200",
                  isLinkActive ? "bg-primary/10 text-primary font-bold" : "text-foreground/70 hover:bg-foreground/10 hover:text-foreground font-semibold"
                )}
              >
                <sectionLink.icon className={cn("h-4 w-4 shrink-0", isLinkActive ? "text-primary" : "")} />
                <span className={cn("text-sm whitespace-nowrap flex items-center gap-2", hasNew ? "font-bold" : "font-semibold")}>
                  {t(sectionLink.labelKey)}
                  {hasNew && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                </span>
              </Link>
            );
          })()}
          {classes.map((classItem) => {
            const isActive = pathname === `/classes/${classItem.id}` || pathname.startsWith(`/classes/${classItem.id}/`);
            return (
              <Link
                key={classItem.id}
                href={`/classes/${classItem.id}`}
                className={cn(
                  "no-underline flex items-center rounded-full transition-all duration-200",
                  showIcons ? "justify-center p-2" : "gap-3 px-3 py-2",
                  isActive ? "bg-primary/10 text-primary" : "text-foreground/70 hover:bg-foreground/10 hover:text-foreground"
                )}
              >
                <ClassAvatar classItem={classItem} size={showIcons ? "lg" : "sm"} />
                {!showIcons && <span className="text-sm font-semibold truncate whitespace-nowrap">{classItem.name}</span>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop sidebar - hidden on mobile */}
      <aside
        className={cn(
          "fixed left-0 top-16 z-30 h-[calc(100vh-64px)] bg-muted transition-all duration-300 flex-col hidden md:flex",
          isCollapsed ? "w-[72px]" : "w-[280px]"
        )}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <nav className="py-2 px-3">
          {filteredNavItems.map((item) => {
            const isActive = pathname === item.href || (item.href === "/classes" && pathname === "/");
            return (
              <Link
                key={item.labelKey}
                href={item.href}
                data-guide={undefined}
                className={cn(
                  "no-underline flex items-center gap-3 px-3 py-3 rounded-full transition-all duration-200 mb-1",
                  isActive ? "bg-primary/10 text-primary font-bold" : "text-foreground/70 hover:bg-foreground/10 hover:text-foreground font-semibold",
                  isCollapsed && "justify-center px-3"
                )}
              >
                <item.icon className={cn("h-5 w-5 shrink-0", isActive ? "text-primary" : "")} />
                {!isCollapsed && <span className="text-sm font-semibold whitespace-nowrap">{t(item.labelKey)}</span>}
              </Link>
            );
          })}
        </nav>

        {/* School section — only shown when NEXT_PUBLIC_ENABLE_SCHOOL is set */}
        {process.env.NEXT_PUBLIC_ENABLE_SCHOOL === "true" && userSchool !== undefined && (
          <nav className="px-3 pb-1">
            {!isCollapsed && <div className="mx-0 mb-2 mt-1 border-t border-border" />}
            {userSchool ? (
              // Director: show full school menu
              [
                { href: "/school/dashboard", icon: Building2, labelKey: "schoolDashboard" as const },
                { href: "/school/members", icon: Users, labelKey: "schoolMembers" as const },
                { href: "/school/grades", icon: BarChart3, labelKey: "schoolGrades" as const },
              ].map(({ href, icon: Icon, labelKey }) => {
                const isActive = pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "no-underline flex items-center gap-3 px-3 py-2.5 rounded-full transition-all duration-200 mb-0.5",
                      isActive ? "bg-primary/10 text-primary font-bold" : "text-foreground/70 hover:bg-foreground/10 hover:text-foreground font-semibold",
                      isCollapsed && "justify-center px-3"
                    )}
                  >
                    <Icon className={cn("h-5 w-5 shrink-0", isActive ? "text-primary" : "")} />
                    {!isCollapsed && <span className="text-sm font-semibold whitespace-nowrap">{t(labelKey)}</span>}
                  </Link>
                );
              })
            ) : (
              // No school yet: show "Create School" entry
              <Link
                href="/school/create"
                className={cn(
                  "no-underline flex items-center gap-3 px-3 py-2.5 rounded-full transition-all duration-200 mb-0.5",
                  pathname.startsWith("/school") ? "bg-primary/10 text-primary font-bold" : "text-foreground/70 hover:bg-foreground/10 hover:text-foreground font-semibold",
                  isCollapsed && "justify-center px-3"
                )}
              >
                <Building2 className={cn("h-5 w-5 shrink-0", pathname.startsWith("/school") ? "text-primary" : "")} />
                {!isCollapsed && <span className="text-sm font-semibold whitespace-nowrap">{t("createSchool")}</span>}
              </Link>
            )}
          </nav>
        )}

        {(isHovering || !isCollapsed) && hasClasses && (
          <>
            {!isCollapsed && <div className="mx-3 my-2 border-t border-border" />}
            <div className="flex-1 overflow-y-auto px-3 py-2">
              {classesByRole.teaching.length > 0 && renderClassList(classesByRole.teaching, 'teaching', showIconsOnly)}
              {classesByRole.enrolled.length > 0 && renderClassList(classesByRole.enrolled, 'enrolled', showIconsOnly)}
            </div>
          </>
        )}

        <div className="mt-auto px-3 pb-3">
          <a
            href="https://t.me/baholabot"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "no-underline flex items-center gap-3 px-3 py-3 rounded-full transition-all duration-200 text-foreground/70 hover:bg-foreground/10 hover:text-foreground font-semibold",
              isCollapsed && "justify-center px-3"
            )}
            title="@baholabot"
          >
            <Send className="h-5 w-5 shrink-0" />
            {!isCollapsed && <span className="text-sm font-semibold whitespace-nowrap">@baholabot</span>}
          </a>
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[280px] bg-muted flex flex-col shadow-xl z-10 animate-slide-in-left">
            <div className="h-16 flex items-center justify-between px-3">
              <Link href="/classes" className="no-underline flex items-center ml-1" onClick={() => setMobileOpen(false)}>
                <div className="flex items-center justify-center w-7 h-7 shrink-0 text-primary translate-y-[-1px]">
                  <LogoIcon size={24} />
                </div>
                <LogoText className="text-lg ml-2" />
              </Link>
              <Button variant="ghost" size="icon" className="h-10 w-10 rounded-full" onClick={() => setMobileOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <nav className="py-2 px-3">
              {filteredNavItems.map((item) => {
                const isActive = pathname === item.href || (item.href === "/classes" && pathname === "/");
                return (
                  <Link
                    key={item.labelKey}
                    href={item.href}
                    className={cn(
                      "no-underline flex items-center gap-3 px-3 py-3 rounded-full transition-all duration-200 mb-1",
                      isActive ? "bg-primary/10 text-primary font-bold" : "text-foreground/70 hover:bg-foreground/10 hover:text-foreground font-semibold"
                    )}
                  >
                    <item.icon className={cn("h-5 w-5 shrink-0", isActive ? "text-primary" : "")} />
                    <span className="text-sm font-semibold whitespace-nowrap">{t(item.labelKey)}</span>
                  </Link>
                );
              })}
            </nav>

            {/* School section (mobile) — only shown when NEXT_PUBLIC_ENABLE_SCHOOL is set */}
            {process.env.NEXT_PUBLIC_ENABLE_SCHOOL === "true" && userSchool !== undefined && (
              <>
                <div className="mx-3 my-2 border-t border-border" />
                <nav className="px-3">
                  {userSchool ? (
                    [
                      { href: "/school/dashboard", icon: Building2, labelKey: "schoolDashboard" as const },
                      { href: "/school/members", icon: Users, labelKey: "schoolMembers" as const },
                      { href: "/school/grades", icon: BarChart3, labelKey: "schoolGrades" as const },
                    ].map(({ href, icon: Icon, labelKey }) => {
                      const isActive = pathname.startsWith(href);
                      return (
                        <Link
                          key={href}
                          href={href}
                          onClick={() => setMobileOpen(false)}
                          className={cn(
                            "no-underline flex items-center gap-3 px-3 py-3 rounded-full transition-all duration-200 mb-1",
                            isActive ? "bg-primary/10 text-primary font-bold" : "text-foreground/70 hover:bg-foreground/10 hover:text-foreground font-semibold"
                          )}
                        >
                          <Icon className={cn("h-5 w-5 shrink-0", isActive ? "text-primary" : "")} />
                          <span className="text-sm font-semibold whitespace-nowrap">{t(labelKey)}</span>
                        </Link>
                      );
                    })
                  ) : (
                    <Link
                      href="/school/create"
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "no-underline flex items-center gap-3 px-3 py-3 rounded-full transition-all duration-200 mb-1",
                        pathname.startsWith("/school") ? "bg-primary/10 text-primary font-bold" : "text-foreground/70 hover:bg-foreground/10 hover:text-foreground font-semibold"
                      )}
                    >
                      <Building2 className={cn("h-5 w-5 shrink-0", pathname.startsWith("/school") ? "text-primary" : "")} />
                      <span className="text-sm font-semibold whitespace-nowrap">{t("createSchool")}</span>
                    </Link>
                  )}
                </nav>
              </>
            )}

            {hasClasses && (
              <>
                <div className="mx-3 my-2 border-t border-border" />
                <div className="flex-1 overflow-y-auto px-3 py-2">
                  {classesByRole.teaching.length > 0 && renderClassList(classesByRole.teaching, 'teaching', false)}
                  {classesByRole.enrolled.length > 0 && renderClassList(classesByRole.enrolled, 'enrolled', false)}
                </div>
              </>
            )}

            <div className="mt-auto px-3 pb-3">
              <a
                href="https://t.me/baholabot"
                target="_blank"
                rel="noopener noreferrer"
                className="no-underline flex items-center gap-3 px-3 py-3 rounded-full transition-all duration-200 text-foreground/70 hover:bg-foreground/10 hover:text-foreground font-semibold"
                onClick={() => setMobileOpen(false)}
              >
                <Send className="h-5 w-5 shrink-0" />
                <span className="text-sm font-semibold whitespace-nowrap">@baholabot</span>
              </a>
            </div>
          </aside>
        </div>
      )}

      {/* Join Class Dialog */}
      <Dialog open={joinDialogOpen} onOpenChange={setJoinDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("joinClass")}</DialogTitle>
            <DialogDescription>{t("enterClassCode")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="classCode">{t("classCode")}</Label>
              <Input
                id="classCode"
                placeholder="ABC123"
                value={classCode}
                onChange={(e) => { setClassCode(e.target.value.toUpperCase()); setJoinError(""); }}
                maxLength={6}
                className="text-center text-xl tracking-widest font-mono"
                onKeyDown={(e) => { if (e.key === "Enter") handleJoinClass(); }}
              />
              {joinError && (
                <p className="text-sm text-destructive font-medium">{joinError}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setJoinDialogOpen(false); setJoinError(""); }}>{t("cancel")}</Button>
            <Button onClick={handleJoinClass} disabled={joining}>{joining ? t("loading") : t("joinClass")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
