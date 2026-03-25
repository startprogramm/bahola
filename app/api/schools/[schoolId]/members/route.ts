import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ schoolId: string }> };

/** GET /api/schools/[schoolId]/members - List school members (director only) */
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
  const role = searchParams.get("role"); // STUDENT | TEACHER | null
  const search = searchParams.get("search") || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, parseInt(searchParams.get("limit") || "50"));

  const where: any = { schoolId, status: "active" };
  if (role === "STUDENT" || role === "TEACHER") where.role = role;

  const [memberships, total] = await Promise.all([
    prisma.schoolMembership.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
            createdAt: true,
            _count: { select: { submissions: true } },
          },
        },
      },
      orderBy: { joinedAt: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.schoolMembership.count({ where }),
  ]);

  // Filter by search after fetch (for simplicity, or use db-level)
  const filtered = search
    ? memberships.filter(
        (m) =>
          m.user.name.toLowerCase().includes(search.toLowerCase()) ||
          (m.user.email ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : memberships;

  return NextResponse.json({
    members: filtered.map((m) => ({
      membershipId: m.id,
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt,
      user: m.user,
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  }, {
    headers: {
      "Cache-Control": "private, max-age=30, stale-while-revalidate=120",
    },
  });
}

/** DELETE /api/schools/[schoolId]/members - Remove a member (director only) */
export async function DELETE(req: NextRequest, { params }: Params) {
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

  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  await prisma.$transaction([
    prisma.schoolMembership.updateMany({
      where: { userId, schoolId },
      data: { status: "removed" },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { schoolId: null },
    }),
  ]);

  return NextResponse.json({ success: true });
}
