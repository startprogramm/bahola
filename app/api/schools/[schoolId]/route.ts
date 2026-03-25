import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(2).optional(),
});

type Params = { params: Promise<{ schoolId: string }> };

/** GET /api/schools/[schoolId] - Get school details */
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { schoolId } = await params;

  // Fetch school and membership check in parallel
  const [school, isMember] = await Promise.all([
    prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        directorId: true,
        createdAt: true,
        director: { select: { id: true, name: true, email: true, avatar: true } },
        _count: {
          select: {
            members: true,
            classes: { where: { archived: false } },
          },
        },
      },
    }),
    prisma.schoolMembership.findUnique({
      where: { userId_schoolId: { userId: session.user.id, schoolId } },
      select: { id: true },
    }),
  ]);

  if (!school) return NextResponse.json({ error: "School not found" }, { status: 404 });

  if (school.directorId !== session.user.id && !isMember) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ school }, {
    headers: {
      "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
    },
  });
}

/** PATCH /api/schools/[schoolId] - Update school (director only) */
export async function PATCH(req: NextRequest, { params }: Params) {
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

  const body = await req.json();
  const data = updateSchema.parse(body);

  const updated = await prisma.school.update({
    where: { id: schoolId },
    data,
  });

  return NextResponse.json({ school: updated });
}

/** DELETE /api/schools/[schoolId] - Deactivate school (director only) */
export async function DELETE(_req: NextRequest, { params }: Params) {
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

  await prisma.school.update({ where: { id: schoolId }, data: { isActive: false } });
  return NextResponse.json({ success: true });
}
