"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  MoreVertical,
  Archive,
  Clock,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n/language-context";
import { getInitials, normalizeImageUrl } from "@/lib/utils";
import { useSession } from "next-auth/react";
import { getBannerStyle } from "@/lib/class-banners";

const DEFAULT_COLORS = [
  "#1967d2", // Google blue
  "#137333", // Google green
  "#a142f4", // Google purple
  "#e37400", // Google orange
  "#1a73e8", // Light blue
  "#c5221f", // Google red
];

interface Assessment {
  id: string;
  title: string;
  dueDate: string | null;
}

interface ClassData {
  id: string;
  name: string;
  code: string;
  subject: string | null;
  headerColor?: string;
  bannerStyle?: string | null;
  createdAt: string;
  _count: {
    enrollments: number;
    assessments: number;
  };
  assessments?: Assessment[];
}

export function TeacherDashboard() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const router = useRouter();
  const { data: session } = useSession();
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const classesRes = await fetch("/api/classes");

      if (classesRes.ok) {
        const data = await classesRes.json();
        setClasses(data.classes || []);
      }
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  const archiveClass = async (classId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!confirm(t("archiveClassConfirm"))) return;

    try {
      const res = await fetch(`/api/classes/${classId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });

      if (res.ok) {
        toast({ title: t("classArchived") });
        setClasses((prev) => prev.filter((c) => c.id !== classId));
      }
    } catch {
      toast({ title: t("somethingWentWrong"), variant: "destructive" });
    }
  };

  const deleteClass = async (classId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!confirm(t("deleteClassConfirm") || "Are you sure you want to delete this class? This cannot be undone.")) return;

    try {
      const res = await fetch(`/api/classes/${classId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        toast({ title: t("classDeleted") || "Class deleted successfully" });
        setClasses((prev) => prev.filter((c) => c.id !== classId));
      } else {
        throw new Error();
      }
    } catch {
      toast({ title: t("somethingWentWrong"), variant: "destructive" });
    }
  };

  const getClassColor = (classItem: ClassData, index: number) => {
    // Use new banner system first, then fall back to headerColor or default
    if (classItem.bannerStyle) {
      return getBannerStyle(classItem.bannerStyle);
    }
    return classItem.headerColor || DEFAULT_COLORS[index % DEFAULT_COLORS.length];
  };

  const getYear = (dateString: string) => {
    return new Date(dateString).getFullYear();
  };

  const getUpcomingAssessments = (assessments?: Assessment[]) => {
    if (!assessments) return [];
    const now = new Date();
    // Show upcoming (future due date) first, then recent assessments without due dates
    const upcoming = assessments
      .filter((a) => a.dueDate && new Date(a.dueDate) > now)
      .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());
    const noDueDate = assessments.filter((a) => !a.dueDate);
    return [...upcoming, ...noDueDate].slice(0, 2);
  };

  const formatDueDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  if (loading) {
    return <DashboardSkeleton />;
  }

  return (
    <div>
      {classes.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={t("noClasses")}
          description={t("manageClasses")}
          action={
            <Link href="/classes/new">
              <Button size="sm">
                {t("createFirstClass")}
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {classes.map((classItem, index) => {
            const color = getClassColor(classItem, index);
            const upcomingAssessments = getUpcomingAssessments(classItem.assessments);

            return (
              <Link
                key={classItem.id}
                href={`/classes/${classItem.id}`}
                className="block group"
              >
                <div className="rounded-lg overflow-hidden h-[280px] flex flex-col">
                  {/* Colored Banner */}
                  <div
                    className="px-3 sm:px-4 pt-3 sm:pt-4 pb-8 sm:pb-10 relative flex-shrink-0"
                    style={{ backgroundColor: color }}
                  >
                    <h3 className="text-white font-medium text-base sm:text-lg truncate pr-8">
                      {classItem.name}
                    </h3>
                    <p className="text-white/80 text-xs sm:text-sm mt-0.5">
                      {getYear(classItem.createdAt)}
                    </p>
                    <p className="text-white/70 text-xs sm:text-sm truncate mt-1">
                      {session?.user?.name}
                    </p>

                    {/* Context Menu */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="absolute top-2 right-2 h-8 w-8 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/20"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                        >
                          <MoreVertical className="h-5 w-5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => archiveClass(classItem.id, e)}
                        >
                          <Archive className="h-4 w-4 mr-2" />
                          {t("archive")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => deleteClass(classItem.id, e)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          {t("delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Card Body */}
                  <div className="flex-1 relative px-4 pt-2 pb-3 bg-card border border-border border-t-0 rounded-b-lg shadow-[0_1px_2px_0_rgba(60,64,67,0.3),0_2px_6px_2px_rgba(60,64,67,0.15)] dark:shadow-[0_1px_2px_0_rgba(0,0,0,0.5),0_2px_6px_2px_rgba(0,0,0,0.3)]">
                    {/* Teacher Avatar */}
                    <div className="absolute -top-6 sm:-top-7 right-3 sm:right-4">
                      <Avatar className="h-12 w-12 sm:h-14 sm:w-14 border-2 border-card shadow-md">
                        <AvatarImage src={normalizeImageUrl(session?.user?.avatar) || undefined} />
                        <AvatarFallback
                          className="text-base font-medium text-white"
                          style={{ backgroundColor: color }}
                        >
                          {getInitials(session?.user?.name || "T")}
                        </AvatarFallback>
                      </Avatar>
                    </div>

                    {/* Upcoming Assessments */}
                    <div className="mt-8 space-y-2">
                      {upcomingAssessments.length > 0 ? (
                        upcomingAssessments.map((assessment) => (
                          <div
                            key={assessment.id}
                            className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-muted-foreground"
                          >
                            <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" />
                            <span className="truncate flex-1">{assessment.title}</span>
                            {assessment.dueDate && (
                              <span className="text-[10px] sm:text-xs shrink-0">
                                {formatDueDate(assessment.dueDate)}
                              </span>
                            )}
                          </div>
                        ))
                      ) : null}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {[...Array(8)].map((_, i) => (
        <div key={i} className="rounded-lg overflow-hidden h-[280px] shadow-sm shadow-black/5 dark:shadow-white/5">
          <Skeleton className="h-24 w-full rounded-none" />
          <div className="p-4 bg-card">
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
