import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireDirector } from "@/lib/director/auth";
import { cached, isCacheHit } from "@/lib/director/server-cache";

/**
 * GET /api/director/trends?classId=xxx&subclass=A,B
 * Score progression over time. If classId provided, returns per-assessment trend.
 * Otherwise returns school-wide weekly trend.
 * When subclass param provided, returns per-subclass average lines.
 */
export async function GET(req: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { school } = auth;

  const classId = req.nextUrl.searchParams.get("classId");
  const subclassParam = req.nextUrl.searchParams.get("subclass");
  const schoolId = school.id;

  if (classId) {
    const cacheKey = `director:trends:${schoolId}:class=${classId}:${subclassParam || ""}`;

    const result = await cached(cacheKey, async () => {
      // Per-class: one data point per assessment
      const cls = await prisma.class.findFirst({
        where: { id: classId, schoolId: school.id },
        select: { id: true, name: true },
      });
      if (!cls) return null;

      const assessments = await prisma.assessment.findMany({
        where: { classId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          createdAt: true,
          submissions: {
            where: { status: "GRADED", maxScore: { gt: 0 } },
            select: { score: true, maxScore: true, studentId: true },
          },
        },
      });

      // If subclass filter, build studentId -> subclass map
      if (subclassParam) {
        const subclasses = subclassParam.split(",").map((s) => s.trim()).filter(Boolean);

        const memberships = await prisma.schoolMembership.findMany({
          where: { schoolId: school.id, role: "STUDENT", subclass: { in: subclasses } },
          select: { userId: true, subclass: true },
        });

        const studentSubclassMap: Record<string, string> = {};
        for (const m of memberships) {
          if (m.subclass) studentSubclassMap[m.userId] = m.subclass;
        }

        const trend = assessments.map((a) => {
          // Compute per-subclass averages
          const subclassAccum: Record<string, { sum: number; count: number }> = {};
          for (const sc of subclasses) subclassAccum[sc] = { sum: 0, count: 0 };

          for (const s of a.submissions) {
            if (s.score === null || !s.maxScore || s.maxScore <= 0) continue;
            const sc = studentSubclassMap[s.studentId];
            if (!sc || !subclasses.includes(sc)) continue;
            subclassAccum[sc].sum += (s.score / s.maxScore) * 100;
            subclassAccum[sc].count++;
          }

          const lines: Record<string, number | null> = {};
          for (const sc of subclasses) {
            lines[sc] = subclassAccum[sc].count > 0
              ? Math.round(subclassAccum[sc].sum / subclassAccum[sc].count)
              : null;
          }

          // Also compute overall avg
          const allPcts = a.submissions
            .filter((s) => s.score !== null && s.maxScore !== null && s.maxScore > 0 && studentSubclassMap[s.studentId])
            .map((s) => (s.score! / s.maxScore!) * 100);
          const avg = allPcts.length > 0 ? Math.round(allPcts.reduce((x, y) => x + y, 0) / allPcts.length) : null;

          return {
            assessmentId: a.id,
            label: a.title,
            date: a.createdAt.toISOString().slice(0, 10),
            avg,
            count: allPcts.length,
            lines,
          };
        });

        return { className: cls.name, trend };
      }

      // Default: no subclass filter
      const trend = assessments.map((a) => {
        const pcts = a.submissions
          .filter((s) => s.score !== null && s.maxScore !== null && s.maxScore > 0)
          .map((s) => (s.score! / s.maxScore!) * 100);
        const avg = pcts.length > 0 ? Math.round(pcts.reduce((x, y) => x + y, 0) / pcts.length) : null;
        return {
          assessmentId: a.id,
          label: a.title,
          date: a.createdAt.toISOString().slice(0, 10),
          avg,
          count: pcts.length,
        };
      });

      return { className: cls.name, trend };
    }, 5 * 60_000); // 5 min TTL

    if (result === null) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    const response = NextResponse.json(result);
    response.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
    response.headers.set("X-Data-Cache", isCacheHit(cacheKey) ? "HIT" : "MISS");
    return response;
  }

  // School-wide: weekly aggregation
  const schoolWideCacheKey = `director:trends:${schoolId}:school-wide`;

  const data = await cached(schoolWideCacheKey, async () => {
    const submissions = await prisma.submission.findMany({
      where: {
        status: "GRADED",
        maxScore: { gt: 0 },
        assessment: { class: { schoolId: school.id } },
      },
      select: { score: true, maxScore: true, gradedAt: true, createdAt: true },
      orderBy: { gradedAt: "asc" },
    });

    // Group by week
    const weekMap: Record<string, { sum: number; count: number }> = {};
    for (const s of submissions) {
      if (s.score === null || !s.maxScore) continue;
      const d = s.gradedAt || s.createdAt;
      const weekStart = new Date(d);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const key = weekStart.toISOString().slice(0, 10);
      if (!weekMap[key]) weekMap[key] = { sum: 0, count: 0 };
      weekMap[key].sum += (s.score / s.maxScore) * 100;
      weekMap[key].count++;
    }

    const trend = Object.entries(weekMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({
        label: date,
        date,
        avg: Math.round(data.sum / data.count),
        count: data.count,
      }));

    return { className: null, trend };
  }, 5 * 60_000); // 5 min TTL

  const response = NextResponse.json(data);
  response.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
  response.headers.set("X-Data-Cache", isCacheHit(schoolWideCacheKey) ? "HIT" : "MISS");
  return response;
}
