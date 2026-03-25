import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { cached } from "@/lib/server-cache";
import { generateETag, checkNotModified, jsonWithETag } from "@/lib/etag";

const SIDEBAR_SELECT = {
  id: true,
  name: true,
  headerColor: true,
  bannerStyle: true,
  classAvatar: true,
} as const;

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    const payload = await cached(`sidebar-classes:${userId}`, async () => {
      const [teaching, enrollments] = await Promise.all([
        prisma.class.findMany({
          where: { teacherId: userId, archived: false },
          select: SIDEBAR_SELECT,
          orderBy: { createdAt: "desc" },
        }),
        prisma.enrollment.findMany({
          where: { studentId: userId },
          select: {
            class: { select: SIDEBAR_SELECT },
          },
          orderBy: { joinedAt: "desc" },
        }),
      ]);

      return {
        teaching,
        enrolled: enrollments.map((e) => e.class),
      };
    }, 120_000); // 2 min cache

    const etag = generateETag(payload);
    const notModified = checkNotModified(request, etag);
    if (notModified) return notModified;
    return jsonWithETag(payload, etag);
  } catch (error) {
    console.error("Error fetching sidebar classes:", error);
    return NextResponse.json(
      { error: "Failed to fetch sidebar classes" },
      { status: 500 }
    );
  }
}
