import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { generateETag, checkNotModified, jsonWithETag } from "@/lib/etag";

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only show classes belonging to the user's school
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { schoolId: true },
    });

    const enrollments = await prisma.enrollment.findMany({
      where: {
        studentId: session.user.id,
        ...(user?.schoolId ? { class: { schoolId: user.schoolId } } : {}),
      },
      select: {
        id: true,
        role: true,
        joinedAt: true,
        class: {
          select: {
            id: true,
            name: true,
            code: true,
            subject: true,
            description: true,
            headerColor: true,
            bannerStyle: true,
            classAvatar: true,
            createdAt: true,
            teacherId: true,
            teacher: {
              select: { name: true, avatar: true },
            },
            _count: {
              select: { assessments: true },
            },
            assessments: {
              where: {
                status: "ACTIVE",
              },
              select: {
                id: true,
                title: true,
                dueDate: true,
              },
              orderBy: { createdAt: "desc" },
              take: 5,
            },
          },
        },
      },
      orderBy: { joinedAt: "desc" },
    });

    const payload = { enrollments };
    const etag = generateETag(payload);
    const notModified = checkNotModified(request, etag);
    if (notModified) return notModified;
    return jsonWithETag(payload, etag, {
      "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
    });
  } catch (error) {
    console.error("Error fetching student classes:", error);
    return NextResponse.json(
      { error: "Failed to fetch classes" },
      { status: 500 }
    );
  }
}
