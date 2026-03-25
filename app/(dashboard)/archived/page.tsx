"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/lib/i18n/language-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  RotateCcw,
  Archive,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getBannerStyle } from "@/lib/class-banners";
import { notifyClassesChanged } from "@/lib/fetch-cache";

interface ArchivedClass {
  id: string;
  name: string;
  subject: string | null;
  code: string;
  headerColor: string;
  bannerStyle?: string | null;
  _count: {
    enrollments: number;
    assessments: number;
  };
}

export default function ArchivedClassesPage() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [classes, setClasses] = useState<ArchivedClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    fetchArchivedClasses();
  }, []);

  const fetchArchivedClasses = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/classes?archived=true");
      if (res.ok) {
        const data = await res.json();
        setClasses(data);
      }
    } catch (error) {
      console.error("Failed to fetch archived classes:", error);
    } finally {
      setLoading(false);
    }
  };

  const restoreClass = async (classId: string) => {
    setRestoringId(classId);
    try {
      const res = await fetch(`/api/classes/${classId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });

      if (res.ok) {
        toast({
          title: t("classRestored"),
          description: classes.find((c) => c.id === classId)?.name,
        });
        setClasses((prev) => prev.filter((c) => c.id !== classId));
        notifyClassesChanged();
      } else {
        throw new Error("Failed to restore class");
      }
    } catch (error) {
      toast({
        title: t("somethingWentWrong"),
        variant: "destructive",
      });
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="space-y-6">
      {loading ? (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg overflow-hidden h-[280px] border">
              <Skeleton className="h-24 w-full" />
              <div className="p-4 space-y-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : classes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 rounded-lg bg-transparent">
          <Archive className="h-8 w-8 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-1">{t("noArchivedClasses")}</h3>
          <p className="text-muted-foreground text-center">
            {t("noArchivedClassesDesc")}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6">
          {classes.map((cls) => (
            <div
              key={cls.id}
              className="rounded-lg overflow-hidden transition-shadow duration-200 h-[280px] flex flex-col border shadow-sm hover:shadow-md"
              style={{ borderColor: "var(--class-card-border)" }}
            >
              <div
                className="relative h-24 p-4 text-white flex-shrink-0"
                style={{ background: cls.bannerStyle ? getBannerStyle(cls.bannerStyle) : cls.headerColor }}
              >
                <div
                  className="absolute inset-0 opacity-25"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(135deg, rgba(255,255,255,.22) 0px, rgba(255,255,255,.22) 2px, transparent 2px, transparent 10px)",
                  }}
                />
                <div className="relative">
                  <h3 className="text-xl font-bold truncate">{cls.name}</h3>
                  {cls.subject && <p className="text-sm text-white/80 truncate">{cls.subject}</p>}
                </div>
              </div>
              <div className="flex-1 p-4 bg-card flex flex-col">
                <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
                  <span>{cls._count.enrollments} {t("students").toLowerCase()}</span>
                  <span>{cls._count.assessments} {t("assessments").toLowerCase()}</span>
                </div>
                <Button
                  variant="outline"
                  size="default"
                  className="mt-auto w-full"
                  onClick={() => restoreClass(cls.id)}
                  disabled={restoringId === cls.id}
                >
                  <RotateCcw className={cn("h-4 w-4 mr-2", restoringId === cls.id && "animate-spin")} />
                  {t("restore")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
