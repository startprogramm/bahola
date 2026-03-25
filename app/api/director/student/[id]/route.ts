import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireDirector } from "@/lib/director/auth";
import { cached, isCacheHit } from "@/lib/director/server-cache";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/director/student/[id]
 * Student timeline + subject breakdown for director view.
 * All queries parallelized — no serial waterfalls.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { school } = auth;

  const { id: studentId } = await params;
  const cacheKey = `director:student:${school.id}:${studentId}`;

  const data = await cached(cacheKey, async () => {
    // Single membership query (replaces two separate queries)
    const [membership, student, submissions] = await Promise.all([
      prisma.schoolMembership.findUnique({
        where: { userId_schoolId: { userId: studentId, schoolId: school.id } },
        select: { id: true, status: true, grade: true, subclass: true },
      }),
      prisma.user.findUnique({
        where: { id: studentId },
        select: { id: true, name: true, email: true, avatar: true, createdAt: true },
      }),
      prisma.submission.findMany({
        where: {
          studentId,
          assessment: { class: { schoolId: school.id } },
        },
        select: {
          id: true, score: true, maxScore: true, status: true,
          gradedAt: true, createdAt: true,
          assessment: {
            select: {
              id: true, title: true, totalMarks: true, assessmentType: true,
              class: { select: { id: true, name: true, subject: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 200, // Limit — UI only shows 20, rest for aggregation
      }),
    ]);

    if (!membership || membership.status !== "active") {
      return null; // 404 handled outside
    }
    if (!student) return null;

    const studentGrade = membership.grade;

    // Fire grade comparison in parallel with JS processing (no serial wait)
    const gradeComparisonP = studentGrade
      ? prisma.$queryRaw<{ subject: string; avg: number }[]>`
          SELECT
            COALESCE(c.subject, 'Other') AS subject,
            ROUND(AVG(s.score::float / s."maxScore" * 100))::int AS avg
          FROM submissions s
          JOIN assessments a ON a.id = s."assessmentId"
          JOIN classes c ON c.id = a."classId"
          WHERE c."schoolId" = ${school.id}
            AND c.name LIKE ${studentGrade + "%"}
            AND s.status = 'GRADED'
            AND s."maxScore" > 0
          GROUP BY c.subject
        `
      : Promise.resolve([]);

    // Subject breakdown (computed while grade comparison query runs)
    const subjectStats: Record<string, { subject: string; classId: string; className: string; scores: number[]; missing: number; total: number }> = {};
    const timeline: any[] = [];

    for (const s of submissions) {
      const subject = s.assessment.class.subject || "Other";
      const classId = s.assessment.class.id;
      const key = `${classId}-${subject}`;

      if (!subjectStats[key]) {
        subjectStats[key] = { subject, classId, className: s.assessment.class.name, scores: [], missing: 0, total: 0 };
      }
      subjectStats[key].total++;

      if (s.status === "GRADED" && s.score !== null && s.maxScore && s.maxScore > 0) {
        subjectStats[key].scores.push((s.score / s.maxScore) * 100);
        timeline.push({
          date: (s.gradedAt || s.createdAt).toISOString().slice(0, 10),
          subject,
          className: s.assessment.class.name,
          assessmentTitle: s.assessment.title,
          score: s.score,
          maxScore: s.maxScore,
          pct: Math.round((s.score / s.maxScore) * 100),
          type: s.assessment.assessmentType,
        });
      } else if (s.status === "PENDING") {
        subjectStats[key].missing++;
      }
    }

    const subjects = Object.values(subjectStats).map((ss) => ({
      subject: ss.subject, classId: ss.classId, className: ss.className,
      avgScore: ss.scores.length > 0
        ? Math.round(ss.scores.reduce((a, b) => a + b, 0) / ss.scores.length) : null,
      totalGraded: ss.scores.length, missing: ss.missing, total: ss.total,
      trend: ss.scores.length >= 2
        ? Math.round(ss.scores[ss.scores.length - 1] - ss.scores[0]) : 0,
    }));

    const allScores = submissions
      .filter((s) => s.status === "GRADED" && s.score !== null && s.maxScore && s.maxScore > 0)
      .map((s) => ((s.score ?? 0) / (s.maxScore ?? 1)) * 100);
    const overallAvg = allScores.length > 0
      ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : null;
    const missingCount = submissions.filter((s) => s.status === "PENDING").length;

    // Await grade comparison (already running in parallel)
    const gradeAvgBySubject = await gradeComparisonP;

    return {
      student,
      grade: studentGrade ? parseInt(String(studentGrade), 10) : null,
      overallAvg, totalSubmissions: submissions.length,
      gradedCount: allScores.length, missingCount,
      subjects, timeline: timeline.slice(0, 100), gradeAvgBySubject,
    };
  }, 2 * 60_000); // 2 min TTL

  if (data === null) {
    return NextResponse.json({ error: "Student not found in this school" }, { status: 404 });
  }

  const response = NextResponse.json(data);
  response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=120");
  response.headers.set("X-Data-Cache", isCacheHit(cacheKey) ? "HIT" : "MISS");
  return response;
}
