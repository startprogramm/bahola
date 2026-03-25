"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/lib/i18n/language-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface Assessment {
  id: string;
  title: string;
  dueDate: string;
  totalMarks: number;
  class: {
    id: string;
    name: string;
    headerColor: string;
  };
  submissions?: {
    id: string;
    status: string;
    score: number | null;
    maxScore: number | null;
  }[];
  _count?: {
    submissions: number;
  };
}

interface CalendarData {
  startDate: string;
  endDate: string;
  weekDays: Record<string, Assessment[]>;
  totalAssessments: number;
}

type CalendarVisibility = "week" | "month";

interface MonthDay {
  dateStr: string;
  assessments: Assessment[];
  inCurrentMonth: boolean;
}

const dayKeys = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export default function CalendarPage() {
  const { t } = useLanguage();
  const [calendarData, setCalendarData] = useState<CalendarData | null>(null);
  const [monthDays, setMonthDays] = useState<MonthDay[]>([]);
  const [calendarVisibility, setCalendarVisibility] = useState<CalendarVisibility>("week");
  const [loading, setLoading] = useState(true);
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() => {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  });
  const [currentMonthStart, setCurrentMonthStart] = useState<Date>(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });

  // Note: Calendar shows assessments from both teaching and enrolled classes
  // The API returns appropriate data based on user's relationship to each class

  useEffect(() => {
    fetchCalendarData();
  }, [currentWeekStart, currentMonthStart, calendarVisibility]);

  const getMonday = (date: Date) => {
    const monday = new Date(date);
    const day = monday.getDay();
    const diff = monday.getDate() - day + (day === 0 ? -6 : 1);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  };

  const getSunday = (date: Date) => {
    const sunday = new Date(date);
    const day = sunday.getDay();
    const diff = sunday.getDate() + (day === 0 ? 0 : 7 - day);
    sunday.setDate(diff);
    sunday.setHours(0, 0, 0, 0);
    return sunday;
  };

  const toDateKey = (date: Date) => date.toISOString().split("T")[0];

  const fetchMonthData = async (monthStart: Date) => {
    const gridStart = getMonday(monthStart);
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    const gridEnd = getSunday(monthEnd);

    const weekStarts: Date[] = [];
    const current = new Date(gridStart);
    while (current <= gridEnd) {
      weekStarts.push(new Date(current));
      current.setDate(current.getDate() + 7);
    }

    const weekResults = await Promise.all(
      weekStarts.map(async (weekStart) => {
        const res = await fetch(`/api/calendar/week?start=${toDateKey(weekStart)}`);
        if (!res.ok) return null;
        return res.json() as Promise<CalendarData>;
      })
    );

    const assessmentsByDate = new Map<string, Assessment[]>();
    weekResults.forEach((weekData) => {
      if (!weekData) return;
      Object.entries(weekData.weekDays).forEach(([dateStr, assessments]) => {
        assessmentsByDate.set(dateStr, assessments);
      });
    });

    const days: MonthDay[] = [];
    const dateCursor = new Date(gridStart);
    while (dateCursor <= gridEnd) {
      const dateStr = toDateKey(dateCursor);
      days.push({
        dateStr,
        assessments: assessmentsByDate.get(dateStr) || [],
        inCurrentMonth: dateCursor.getMonth() === monthStart.getMonth(),
      });
      dateCursor.setDate(dateCursor.getDate() + 1);
    }

    setMonthDays(days);
  };

  const fetchCalendarData = async () => {
    setLoading(true);
    try {
      if (calendarVisibility === "month") {
        await fetchMonthData(currentMonthStart);
        return;
      }

      const res = await fetch(`/api/calendar/week?start=${toDateKey(currentWeekStart)}`);
      if (!res.ok) return;
      const data = await res.json();
      setCalendarData(data);
    } catch (error) {
      console.error("Failed to fetch calendar data:", error);
    } finally {
      setLoading(false);
    }
  };

  const navigatePeriod = (direction: "prev" | "next") => {
    if (calendarVisibility === "month") {
      setCurrentMonthStart((prev) => {
        const delta = direction === "prev" ? -1 : 1;
        return new Date(prev.getFullYear(), prev.getMonth() + delta, 1);
      });
      return;
    }

    setCurrentWeekStart((prev) => {
      const newDate = new Date(prev);
      newDate.setDate(newDate.getDate() + (direction === "prev" ? -7 : 7));
      return newDate;
    });
  };

  const goToToday = () => {
    const today = new Date();
    const monday = getMonday(today);
    setCurrentWeekStart(monday);
    setCurrentMonthStart(new Date(today.getFullYear(), today.getMonth(), 1));
  };

  const formatDateRange = () => {
    if (calendarVisibility === "month") {
      return currentMonthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }

    const endDate = new Date(currentWeekStart);
    endDate.setDate(endDate.getDate() + 6);

    const startMonth = currentWeekStart.toLocaleDateString("en-US", { month: "short" });
    const endMonth = endDate.toLocaleDateString("en-US", { month: "short" });
    const year = currentWeekStart.getFullYear();

    if (startMonth === endMonth) {
      return `${startMonth} ${currentWeekStart.getDate()} - ${endDate.getDate()}, ${year}`;
    }
    return `${startMonth} ${currentWeekStart.getDate()} - ${endMonth} ${endDate.getDate()}, ${year}`;
  };

  const isToday = (dateStr: string) => {
    const today = new Date().toISOString().split("T")[0];
    return dateStr === today;
  };

  const getSubmissionStatus = (assessment: Assessment) => {
    if (!assessment.submissions || assessment.submissions.length === 0) {
      return "not_submitted";
    }
    const submission = assessment.submissions[0];
    if (submission.status === "GRADED") return "graded";
    if (submission.status === "PROCESSING") return "processing";
    return "submitted";
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "graded":
        return <Badge variant="default" className="bg-green-500">{t("graded")}</Badge>;
      case "processing":
        return <Badge variant="secondary">{t("processing")}</Badge>;
      case "submitted":
        return <Badge variant="outline">{t("turnedIn")}</Badge>;
      default:
        return <Badge variant="destructive">{t("assigned")}</Badge>;
    }
  };

  const renderAssessmentCard = (assessment: Assessment, compact = false) => {
    const hasSubmissions = assessment.submissions && assessment.submissions.length >= 0;
    const status = hasSubmissions ? getSubmissionStatus(assessment) : null;
    return (
      <Link
        key={assessment.id}
        href={`/classes/${assessment.class.id}?tab=classwork`}
        className="block"
      >
        <div
          className={cn(
            "rounded hover:opacity-80 transition-opacity cursor-pointer",
            compact ? "p-1 text-[10px]" : "p-1 sm:p-2 text-[10px] sm:text-xs"
          )}
          style={{ backgroundColor: assessment.class.headerColor + "20" }}
        >
          <div
            className="font-medium truncate"
            style={{ color: assessment.class.headerColor }}
          >
            {assessment.title}
          </div>
          <div className={cn("text-muted-foreground truncate mt-0.5", compact ? "text-[9px]" : "text-[9px] sm:text-[10px]")}>
            {assessment.class.name}
          </div>
          {status && (
            <div className="mt-0.5 sm:mt-1">
              <Badge variant="outline" className={cn("px-1", compact ? "text-[8px] h-4" : "text-[8px] sm:text-[10px] h-4")}>
                {status === "graded" && t("graded")}
                {status === "processing" && t("processing")}
                {status === "submitted" && t("turnedIn")}
                {status === "not_submitted" && t("assigned")}
              </Badge>
            </div>
          )}
          {!compact && assessment._count && (
            <div className="mt-0.5 sm:mt-1 text-[9px] sm:text-[10px] text-muted-foreground">
              {assessment._count.submissions} {t("submissions")}
            </div>
          )}
        </div>
      </Link>
    );
  };

  return (
    <div className="space-y-6">
      {/* Week Navigation */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => navigatePeriod("prev")}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => navigatePeriod("next")}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="ghost" onClick={goToToday}>
                {t("today")}
              </Button>
              <Select
                value={calendarVisibility}
                onValueChange={(value) => setCalendarVisibility(value as CalendarVisibility)}
              >
                <SelectTrigger className="w-[120px] h-9">
                  <SelectValue placeholder={t("week")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">{t("week")}</SelectItem>
                  <SelectItem value="month">{t("month")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <CardTitle className="text-lg font-semibold">{formatDateRange()}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ))}
            </div>
          ) : calendarVisibility === "month" ? (
            <div className="space-y-2">
              <div className="grid grid-cols-7 gap-2">
                {dayKeys.map((dayKey) => (
                  <div key={dayKey} className="text-center text-xs font-semibold text-muted-foreground uppercase py-1">
                    {t(dayKey)}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                {monthDays.map((day) => {
                  const date = new Date(day.dateStr);
                  const isTodayDate = isToday(day.dateStr);
                  return (
                    <div
                      key={day.dateStr}
                      className={cn(
                        "min-h-[120px] rounded-lg border p-2 space-y-1",
                        !day.inCurrentMonth && "opacity-45",
                        isTodayDate && "border-blue-500 bg-blue-50/40"
                      )}
                    >
                      <div className={cn("text-sm font-semibold", isTodayDate && "text-blue-700")}>
                        {date.getDate()}
                      </div>
                      <div className="space-y-1">
                        {day.assessments.length === 0 ? (
                          <div className="text-[10px] text-muted-foreground">-</div>
                        ) : (
                          day.assessments.slice(0, 3).map((assessment) => renderAssessmentCard(assessment, true))
                        )}
                        {day.assessments.length > 3 && (
                          <div className="text-[10px] text-muted-foreground px-1">
                            +{day.assessments.length - 3} {t("more")}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : calendarData ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
              {Object.entries(calendarData.weekDays).map(([dateStr, assessments], index) => {
                const date = new Date(dateStr);
                const dayName = t(dayKeys[index]);
                const dayNumber = date.getDate();
                const isTodayDate = isToday(dateStr);

                return (
                  <div key={dateStr} className="min-h-[120px] sm:min-h-[150px]">
                    {/* Day Header */}
                    <div
                      className={cn(
                        "text-center p-1.5 sm:p-2 rounded-t-lg border-b",
                        isTodayDate
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50"
                      )}
                    >
                      <div className="text-[10px] sm:text-xs font-medium uppercase">{dayName}</div>
                      <div className={cn("text-base sm:text-lg font-bold", isTodayDate && "text-primary-foreground")}>
                        {dayNumber}
                      </div>
                    </div>

                    {/* Day Content */}
                    <div className={cn(
                      "p-0.5 sm:p-1 rounded-b-lg border border-t-0 min-h-[100px] sm:min-h-[120px] space-y-0.5 sm:space-y-1",
                      isTodayDate && "border-muted-foreground/40"
                    )}>
                      {assessments.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-[10px] sm:text-xs text-muted-foreground">
                          -
                        </div>
                      ) : (
                        assessments.map((assessment) => renderAssessmentCard(assessment))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              {t("noAssignmentsThisWeek")}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
