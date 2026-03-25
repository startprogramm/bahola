import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ schoolId: string }> };

/** GET /api/schools/[schoolId]/classes - School classes with stats (director only) */
export async function GET(_req: NextRequest, { params }: Params) {
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

  const classes = await prisma.class.findMany({
    where: { schoolId, archived: false },
    select: {
      id: true,
      name: true,
      subject: true,
      code: true,
      headerColor: true,
      bannerStyle: true,
      classAvatar: true,
      createdAt: true,
      teacherId: true,
      teacher: { select: { id: true, name: true, avatar: true } },
      _count: {
        select: {
          enrollments: true,
          assessments: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ classes }, {
    headers: {
      "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
    },
  });
}
