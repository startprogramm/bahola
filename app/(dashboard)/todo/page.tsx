"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useLanguage } from "@/lib/i18n/language-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  Circle,
  AlertCircle,
  Clock,
  ListTodo,
  ChevronDown,
  ChevronRight,
  BookOpen,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface Assessment {
  id: string;
  title: string;
  dueDate: string | null;
  totalMarks: number;
  createdAt: string;
  class: {
    id: string;
    name: string;
    headerColor: string;
  };
  submissionStatus: "assigned" | "missing" | "done";
  submission: {
    id: string;
    status: string;
    score: number | null;
    maxScore: number | null;
    createdAt: string;
  } | null;
}

interface GroupedData {
  noDueDate: Assessment[];
  overdue: Assessment[];
  today: Assessment[];
  tomorrow: Assessment[];
  thisWeek: Assessment[];
  nextWeek: Assessment[];
  later: Assessment[];
}

interface TodoData {
  grouped?: GroupedData;
  items?: Assessment[];  // For teachers
  total: number;
  classIds: string[];
}

type TabType = "assigned" | "missing" | "done";

export default function TodoPage() {
  const { data: session } = useSession();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const [todoData, setTodoData] = useState<TodoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>((searchParams.get("tab") as TabType) || "assigned");
  const [selectedClassId, setSelectedClassId] = useState<string>(searchParams.get("classId") || "all");
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());


  useEffect(() => {
    fetchClasses();
  }, []);

  useEffect(() => {
    fetchTodoData();
  }, [activeTab, selectedClassId]);

  const fetchClasses = async () => {
    try {
      const [myClassesRes, enrolledRes] = await Promise.all([
        fetch("/api/classes"),
        fetch("/api/student/classes")
      ]);

      let all: { id: string; name: string }[] = [];

      if (myClassesRes.ok) {
        const data = await myClassesRes.json();
        const list = data.classes || data || [];
        all = [...all, ...list.map((c: any) => ({ id: c.id, name: c.name }))];
      }

      if (enrolledRes.ok) {
        const data = await enrolledRes.json();
        const list = data.enrollments || [];
        all = [...all, ...list.map((e: any) => ({ id: e.class.id, name: e.class.name }))];
      }
      
      // Remove duplicates
      const unique = Array.from(new Map(all.map(item => [item.id, item])).values());
      setClasses(unique);
    } catch (error) {
      console.error("Failed to fetch classes:", error);
    }
  };

  const fetchTodoData = async () => {
    setLoading(true);
    try {
      const classParam = selectedClassId !== "all" ? `&classId=${selectedClassId}` : "";
      const res = await fetch(`/api/todo?status=${activeTab}${classParam}`);
      if (res.ok) {
        const data = await res.json();

        // Handle teacher case (items array) vs student case (grouped object)
        if (data.items && !data.grouped) {
          // Group items for teachers
          const now = new Date();
          const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const todayEnd = new Date(todayStart);
          todayEnd.setHours(23, 59, 59, 999);
          const tomorrowStart = new Date(todayStart);
          tomorrowStart.setDate(tomorrowStart.getDate() + 1);
          const tomorrowEnd = new Date(tomorrowStart);
          tomorrowEnd.setHours(23, 59, 59, 999);
          const thisWeekEnd = new Date(todayStart);
          thisWeekEnd.setDate(thisWeekEnd.getDate() + (7 - todayStart.getDay()));
          thisWeekEnd.setHours(23, 59, 59, 999);
          const nextWeekEnd = new Date(thisWeekEnd);
          nextWeekEnd.setDate(nextWeekEnd.getDate() + 7);

          const grouped: GroupedData = {
            noDueDate: [],
            overdue: [],
            today: [],
            tomorrow: [],
            thisWeek: [],
            nextWeek: [],
            later: [],
          };

          data.items.forEach((item: Assessment) => {
            if (!item.dueDate) {
              grouped.noDueDate.push(item);
            } else {
              const dueDate = new Date(item.dueDate);
              if (dueDate < todayStart) {
                grouped.overdue.push(item);
              } else if (dueDate <= todayEnd) {
                grouped.today.push(item);
              } else if (dueDate <= tomorrowEnd) {
                grouped.tomorrow.push(item);
              } else if (dueDate <= thisWeekEnd) {
                grouped.thisWeek.push(item);
              } else if (dueDate <= nextWeekEnd) {
                grouped.nextWeek.push(item);
              } else {
                grouped.later.push(item);
              }
            }
          });

          setTodoData({
            grouped,
            total: data.items.length,
            classIds: data.classIds || [],
          });
        } else {
          setTodoData(data);
        }
      }
    } catch (error) {
      console.error("Failed to fetch todo data:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(section)) {
        newSet.delete(section);
      } else {
        newSet.add(section);
      }
      return newSet;
    });
  };

  const formatDueDate = (dueDate: string | null) => {
    if (!dueDate) return t("noDueDate");
    const date = new Date(dueDate);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dueDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (dueDay < today) {
      return t("overdue");
    } else if (dueDay.getTime() === today.getTime()) {
      return t("dueToday");
    } else if (dueDay.getTime() === tomorrow.getTime()) {
      return t("dueTomorrow");
    } else {
      return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    }
  };

  const getEmptyMessage = () => {
    switch (activeTab) {
      case "assigned":
        return t("allCaughtUp");
      case "missing":
        return t("noMissingWork");
      case "done":
        return t("noDoneWork");
      default:
        return t("noAssignments");
    }
  };

  const renderSection = (
    title: string,
    items: Assessment[],
    sectionKey: string,
    variant: "danger" | "warning" | "normal" = "normal"
  ) => {
    if (items.length === 0) return null;

    const isCollapsed = collapsedSections.has(sectionKey);

    return (
      <div className="mb-4">
        <button
          onClick={() => toggleSection(sectionKey)}
          className="flex items-center gap-2 w-full text-left py-2 hover:bg-muted/50 rounded-lg px-2 transition-colors"
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
          <span
            className={cn(
              "font-medium",
              variant === "danger" && "text-destructive",
              variant === "warning" && "text-orange-500"
            )}
          >
            {title}
          </span>
          <Badge variant="secondary" className="ml-auto">
            {items.length}
          </Badge>
        </button>

        {!isCollapsed && (
          <div className="space-y-2 mt-2 pl-6">
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/assessments/${item.id}`}
                className="block"
              >
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div
                        className="w-1 h-12 rounded-full shrink-0"
                        style={{ backgroundColor: item.class.headerColor }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h4 className="font-medium truncate">{item.title}</h4>
                            <p className="text-sm text-muted-foreground truncate">
                              {item.class.name}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            {item.dueDate && (
                              <div
                                className={cn(
                                  "flex items-center gap-1 text-xs",
                                  variant === "danger" && "text-destructive",
                                  variant === "warning" && "text-orange-500"
                                )}
                              >
                                <Clock className="h-3 w-3" />
                                {formatDueDate(item.dueDate)}
                              </div>
                            )}
                            {item.submission && item.submission.status === "GRADED" && (
                              <Badge variant="outline" className="text-xs">
                                {item.submission.score}/{item.submission.maxScore}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  };

  const tabs: { key: TabType; label: string; icon: React.ElementType }[] = [
    { key: "assigned", label: t("assigned"), icon: Circle },
    { key: "missing", label: t("missing"), icon: AlertCircle },
    { key: "done", label: t("done"), icon: CheckCircle2 },
  ];

  return (
    <div className="space-y-6">
      {/* Tabs + Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-1">
        <div className="flex gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 border-b-2 text-sm transition-colors",
              activeTab === tab.key
                ? "border-blue-600 text-blue-600 font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
        </div>
        <Select value={selectedClassId} onValueChange={setSelectedClassId}>
          <SelectTrigger className="w-[190px] h-9">
            <SelectValue placeholder={t("filterByClass")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allClasses")}</SelectItem>
            {classes.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      <div className="space-y-4">
          {loading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ))}
            </div>
          ) : todoData ? (
            <>
              {todoData.total === 0 ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                    {activeTab === "done" ? (
                      <BookOpen className="h-8 w-8 text-muted-foreground" />
                    ) : (
                      <CheckCircle2 className="h-8 w-8 text-green-500" />
                    )}
                  </div>
                  <p className="text-muted-foreground">{getEmptyMessage()}</p>
                </div>
              ) : todoData.grouped ? (
                <div>
                  {renderSection(t("overdue"), todoData.grouped.overdue || [], "overdue", "danger")}
                  {renderSection(t("dueToday"), todoData.grouped.today || [], "today", "warning")}
                  {renderSection(t("dueTomorrow"), todoData.grouped.tomorrow || [], "tomorrow")}
                  {renderSection(t("thisWeek"), todoData.grouped.thisWeek || [], "thisWeek")}
                  {renderSection(t("nextWeek"), todoData.grouped.nextWeek || [], "nextWeek")}
                  {renderSection(t("later"), todoData.grouped.later || [], "later")}
                  {renderSection(t("noDueDate"), todoData.grouped.noDueDate || [], "noDueDate")}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {t("noAssignments")}
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              {t("noAssignments")}
            </div>
          )}
      </div>
    </div>
  );
}
