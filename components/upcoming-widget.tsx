"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n/language-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Clock, Calendar, CheckCircle2, PartyPopper } from "lucide-react";
import { cn } from "@/lib/utils";

interface UpcomingAssessment {
  id: string;
  title: string;
  dueDate: string | null;
  class: {
    id: string;
    name: string;
    headerColor: string;
  };
  submissionStatus?: "assigned" | "missing" | "done";
  submission?: {
    status: string;
  } | null;
}

interface UpcomingWidgetProps {
  classId?: string;
  maxItems?: number;
}

export function UpcomingWidget({ classId, maxItems = 5 }: UpcomingWidgetProps) {
  const { data: session } = useSession();
  const { t } = useLanguage();
  const [items, setItems] = useState<UpcomingAssessment[]>([]);
  const [loading, setLoading] = useState(true);


  useEffect(() => {
    fetchUpcoming();
  }, [classId]);

  const fetchUpcoming = async () => {
    setLoading(true);
    try {
      // Get this week's start
      const today = new Date();
      const dayOfWeek = today.getDay();
      const monday = new Date(today);
      monday.setDate(today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1));
      monday.setHours(0, 0, 0, 0);

      // Get next two weeks
      const endDate = new Date(monday);
      endDate.setDate(endDate.getDate() + 14);

      const startStr = monday.toISOString().split("T")[0];
      const res = await fetch(`/api/calendar/week?start=${startStr}`);
      if (res.ok) {
        const data = await res.json();

        // Flatten all assessments from the week
        const allAssessments: UpcomingAssessment[] = [];
        Object.values(data.weekDays).forEach((dayItems) => {
          (dayItems as UpcomingAssessment[]).forEach((item) => {
            if (!classId || item.class.id === classId) {
              allAssessments.push(item);
            }
          });
        });

        // Sort by due date and limit
        const sorted = allAssessments
          .filter((a) => {
            if (!a.dueDate) return false;
            return new Date(a.dueDate) >= today;
          })
          .sort((a, b) => {
            if (!a.dueDate || !b.dueDate) return 0;
            return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
          })
          .slice(0, maxItems);

        setItems(sorted);
      }
    } catch (error) {
      console.error("Failed to fetch upcoming:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatDueDate = (dueDate: string) => {
    const date = new Date(dueDate);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dueDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (dueDay.getTime() === today.getTime()) {
      return t("dueToday");
    } else if (dueDay.getTime() === tomorrow.getTime()) {
      return t("dueTomorrow");
    } else {
      return date.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    }
  };

  const isOverdue = (dueDate: string) => {
    const now = new Date();
    return new Date(dueDate) < now;
  };

  const isDueToday = (dueDate: string) => {
    const date = new Date(dueDate);
    const now = new Date();
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            {t("upcoming")}
          </CardTitle>
          <Link
            href="/todo"
            className="text-xs text-primary hover:underline"
          >
            {t("viewAll")}
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-2">
                <Skeleton className="h-10 w-1 shrink-0" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-3/4 mb-1" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-4">
            <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center mx-auto mb-2">
              <PartyPopper className="h-5 w-5 text-green-700 dark:text-green-500" />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("noUpcomingWork")}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/assessments/${item.id}`}
                className="block group"
              >
                <div className="flex gap-2">
                  <div
                    className="w-1 rounded-full shrink-0"
                    style={{ backgroundColor: item.class.headerColor }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                      {item.title}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{item.class.name}</span>
                      {item.dueDate && (
                        <>
                          <span>•</span>
                          <span
                            className={cn(
                              "flex items-center gap-1 shrink-0",
                              isOverdue(item.dueDate) && "text-destructive",
                              isDueToday(item.dueDate) && !isOverdue(item.dueDate) && "text-orange-500"
                            )}
                          >
                            <Clock className="h-3 w-3" />
                            {formatDueDate(item.dueDate)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
