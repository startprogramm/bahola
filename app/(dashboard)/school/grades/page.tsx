"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ArrowLeft, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLanguage } from "@/lib/i18n/language-context";
import { useToast } from "@/hooks/use-toast";
import { formatDate, getScoreColor, getScoreBgColor } from "@/lib/utils";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface Grade {
  submissionId: string;
  student: { id: string; name: string };
  assessment: { id: string; title: string; class: { id: string; name: string } };
  score: number | null;
  maxScore: number;
  gradedAt: string;
}

interface ClassItem { id: string; name: string }
interface School { id: string; name: string }

export default function SchoolGradesPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { toast } = useToast();
  const [school, setSchool] = useState<School | null>(null);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [classFilter, setClassFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const loadGrades = useCallback(async (schoolId: string, cf: string, p: number) => {
    const params = new URLSearchParams({ page: String(p), limit: "50" });
    if (cf && cf !== "all") params.set("classId", cf);
    const res = await fetch(`/api/schools/${schoolId}/grades?${params}`);
    if (res.ok) {
      const data = await res.json();
      setGrades(data.grades);
      setTotalPages(data.pages);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      const schoolRes = await fetch("/api/schools");
      const schoolData = await schoolRes.json();
      if (!schoolRes.ok || !schoolData.school) { router.push("/school/create"); return; }
      setSchool(schoolData.school);

      const classesRes = await fetch(`/api/schools/${schoolData.school.id}/classes`);
      if (classesRes.ok) {
        const cd = await classesRes.json();
        setClasses(cd.classes.map((c: any) => ({ id: c.id, name: c.name })));
      }

      await loadGrades(schoolData.school.id, "all", 1);
      setLoading(false);
    };
    init();
  }, [router, loadGrades]);

  useEffect(() => {
    if (!school) return;
    loadGrades(school.id, classFilter, page);
  }, [classFilter, page, school, loadGrades]);

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/school/dashboard"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold">{t("schoolGrades")}</h1>
          <p className="text-sm text-muted-foreground">{school?.name}</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-3 flex-wrap items-center">
        <Select value={classFilter} onValueChange={(v) => { setClassFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder={t("allRoles")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("totalClasses")}</SelectItem>
            {classes.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Grades table */}
      <Card>
        <CardContent className="p-0">
          {grades.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">{t("noSubmissionsYet")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-3 px-4 font-medium">{t("student")}</th>
                    <th className="text-left py-3 px-4 font-medium hidden sm:table-cell">{t("totalClasses")}</th>
                    <th className="text-left py-3 px-4 font-medium">Assessment</th>
                    <th className="text-right py-3 px-4 font-medium">Score</th>
                    <th className="text-right py-3 px-4 font-medium hidden md:table-cell">{t("joinedOn")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {grades.map((g) => (
                    <tr key={g.submissionId} className="hover:bg-muted/30">
                      <td className="py-3 px-4 font-medium">{g.student.name}</td>
                      <td className="py-3 px-4 text-muted-foreground hidden sm:table-cell">{g.assessment.class.name}</td>
                      <td className="py-3 px-4 text-muted-foreground">{g.assessment.title}</td>
                      <td className="py-3 px-4 text-right">
                        <span className={cn("font-bold px-2 py-0.5 rounded-md text-xs",
                          getScoreBgColor(g.score ?? 0, g.maxScore),
                          getScoreColor(g.score ?? 0, g.maxScore)
                        )}>
                          {g.score ?? 0}/{g.maxScore}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-muted-foreground text-xs hidden md:table-cell">
                        {formatDate(g.gradedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
