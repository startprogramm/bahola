import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireDirector } from "@/lib/director/auth";

/**
 * GET /api/director/assessment-types
 * Average scores grouped by assessment type (homework, test, etc.)
 */
export async function GET(_req: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { school } = auth;

  const assessments = await prisma.assessment.findMany({
    where: { class: { schoolId: school.id } },
    select: {
      assessmentType: true,
      submissions: {
        where: { status: "GRADED", maxScore: { gt: 0 } },
        select: { score: true, maxScore: true },
      },
    },
  });

  const typeStats: Record<string, { sum: number; count: number; passCount: number }> = {};

  for (const a of assessments) {
    const type = a.assessmentType || "standard";
    if (!typeStats[type]) typeStats[type] = { sum: 0, count: 0, passCount: 0 };

    for (const s of a.submissions) {
      if (s.score !== null && s.maxScore !== null && s.maxScore > 0) {
        const pct = s.score / s.maxScore;
        typeStats[type].sum += pct * 100;
        typeStats[type].count++;
        if (pct >= 0.85) typeStats[type].passCount++;
      }
    }
  }

  const result = Object.entries(typeStats).map(([type, data]) => ({
    type,
    label: type === "homework" ? "Uy ishi" : type === "test" ? "Test" : type === "standard" ? "Standart" : type,
    avgScore: data.count > 0 ? Math.round(data.sum / data.count) : 0,
    passRate: data.count > 0 ? Math.round((data.passCount / data.count) * 100) : 0,
    count: data.count,
  }));

  const response = NextResponse.json({ types: result });
  response.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
  return response;
}
