import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ schoolId: string }> };

/** GET /api/schools/[schoolId]/grades - All grades across school (director only) */
export async function GET(req: NextRequest, { params }: Params) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { schoolId } = await params;

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, directorId: true },
  });
  if (!school) return NextResponse.json({ error: "School not found" }, { status: 404 });
  if (school.directorId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const classId = searchParams.get("classId");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(200, parseInt(searchParams.get("limit") || "50"));

  const where: any = {
    status: "GRADED",
    assessment: { class: { schoolId } },
  };
  if (classId) where.assessment = { classId, class: { schoolId } };

  const [submissions, total] = await Promise.all([
    prisma.submission.findMany({
      where,
      select: {
        id: true,
        score: true,
        maxScore: true,
        updatedAt: true,
        student: { select: { id: true, name: true, avatar: true } },
        assessment: {
          select: {
            id: true,
            title: true,
            totalMarks: true,
            class: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.submission.count({ where }),
  ]);

  return NextResponse.json({
    grades: submissions.map((s) => ({
      submissionId: s.id,
      student: s.student,
      assessment: s.assessment,
      score: s.score,
      maxScore: s.maxScore,
      gradedAt: s.updatedAt,
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  }, {
    headers: {
      "Cache-Control": "private, max-age=15, stale-while-revalidate=60",
    },
  });
}
