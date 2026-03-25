"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Users, BookOpen, ClipboardCheck,
  TrendingUp, Building2, Loader2
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/language-context";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import Link from "next/link";

interface School {
  id: string;
  name: string;
  description?: string;
  directorId: string;
  _count: { members: number; classes: number };
}

interface Stats {
  students: number;
  teachers: number;
  classes: number;
  assessments: number;
  submissions: number;
  avgScore: number | null;
}

interface RecentItem {
  id: string;
  score: number | null;
  maxScore: number;
  updatedAt: string;
  student: { id: string; name: string };
  assessment: { title: string; class: { id: string; name: string } };
}

export default function SchoolDashboardPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { toast } = useToast();
  const [school, setSchool] = useState<School | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const load = async () => {
      try {
        const schoolRes = await fetch("/api/schools");
        const schoolData = await schoolRes.json();
        if (!schoolRes.ok || !schoolData.school) {
          router.push("/school/create");
          return;
        }
        setSchool(schoolData.school);

        const dashRes = await fetch(`/api/schools/${schoolData.school.id}/dashboard`);
        if (dashRes.ok) {
          const d = await dashRes.json();
          setStats(d.stats);
          setRecent(d.recentActivity);
        }
      } catch {
        toast({ title: "Failed to load school data", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [router, toast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!school) return null;

  const statCards = [
    { label: t("totalStudents"), value: stats?.students ?? 0, icon: Users, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-900/20" },
    { label: t("totalTeachers"), value: stats?.teachers ?? 0, icon: BookOpen, color: "text-purple-600", bg: "bg-purple-50 dark:bg-purple-900/20" },
    { label: t("totalClasses"), value: stats?.classes ?? 0, icon: ClipboardCheck, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
    { label: t("avgScore"), value: stats?.avgScore !== null ? `${stats?.avgScore}%` : "—", icon: TrendingUp, color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-900/20" },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10 text-primary">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{school.name}</h1>
            <p className="text-muted-foreground text-sm">{t("schoolDashboard")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/school/members">{t("schoolMembers")}</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/school/grades">{t("schoolGrades")}</Link>
          </Button>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{card.label}</p>
                  <p className="text-2xl font-bold mt-1">{card.value}</p>
                </div>
                <div className={`p-2 rounded-lg ${card.bg}`}>
                  <card.icon className={`h-5 w-5 ${card.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("recentActivity")}</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4 text-center">{t("noActivity")}</p>
          ) : (
            <div className="divide-y">
              {recent.map((item) => (
                <div key={item.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{item.student.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {item.assessment.title} · {item.assessment.class.name}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-bold text-sm">
                      {item.score ?? 0}/{item.maxScore}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatDate(item.updatedAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
