"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, AlertTriangle, Users, ExternalLink, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { DirectorIssue } from "@/lib/director/types";

export default function DirectorIssuePage() {
  const { id: issueId } = useParams<{ id: string }>();
  const router = useRouter();
  const [issue, setIssue] = useState<DirectorIssue | null>(null);
  const [students, setStudents] = useState<{ id: string; name: string; avg: number | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch all issues and find the one matching our ID
    fetch("/api/director/issues")
      .then((r) => r.json())
      .then(async (data) => {
        const found = (data.issues || []).find((i: DirectorIssue) => i.id === issueId);
        setIssue(found || null);

        // If issue has student IDs, fetch their names
        if (found?.studentIds && found.studentIds.length > 0) {
          const studentData = await Promise.all(
            found.studentIds.slice(0, 10).map(async (sid: string) => {
              try {
                const res = await fetch(`/api/director/student/${sid}`);
                if (!res.ok) return { id: sid, name: "O'quvchi", avg: null };
                const d = await res.json();
                return { id: sid, name: d.student?.name || "O'quvchi", avg: d.overallAvg };
              } catch {
                return { id: sid, name: "O'quvchi", avg: null };
              }
            })
          );
          setStudents(studentData);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [issueId]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6 text-center">
        <p className="text-muted-foreground">Muammo topilmadi</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/director")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Orqaga
        </Button>
      </div>
    );
  }

  const severityColor = {
    critical: "text-red-600",
    warning: "text-orange-600",
    info: "text-blue-600",
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push("/director")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{issue.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={issue.severity === "critical" ? "destructive" : "secondary"}>
              {issue.severity === "critical" ? "Jiddiy" : issue.severity === "warning" ? "Ogohlantirish" : "Ma'lumot"}
            </Badge>
            {issue.className && <span className="text-sm text-muted-foreground">{issue.className}</span>}
          </div>
        </div>
      </div>

      {/* Details */}
      <Card>
        <CardContent className="py-4">
          <p className="text-sm">{issue.description}</p>
          {issue.teacherName && (
            <p className="text-sm text-muted-foreground mt-2">
              O'qituvchi: <span className="font-medium">{issue.teacherName}</span>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Navigate to class */}
      {issue.classId && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => router.push(`/director/class/${issue.classId}`)}
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Sinf tahlilini ko'rish
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push(`/classes/${issue.classId}`)}
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Sinf sahifasiga o'tish
          </Button>
        </div>
      )}

      {/* At-risk students list */}
      {students.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Xavfli o'quvchilar ({issue.value})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {students.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between py-2 px-2 rounded cursor-pointer hover:bg-muted"
                  onClick={() => router.push(`/director/student/${s.id}`)}
                >
                  <span className="text-sm">{s.name}</span>
                  <div className="flex items-center gap-2">
                    {s.avg !== null && (
                      <span className={`text-sm font-bold ${
                        s.avg >= 70 ? "text-emerald-600" : s.avg >= 50 ? "text-orange-600" : "text-red-600"
                      }`}>
                        {s.avg}%
                      </span>
                    )}
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </div>
                </div>
              ))}
              {(issue.studentIds?.length || 0) > 10 && (
                <p className="text-xs text-muted-foreground text-center pt-2">
                  va yana {(issue.studentIds?.length || 0) - 10} ta o'quvchi...
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
