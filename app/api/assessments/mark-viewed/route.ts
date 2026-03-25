import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { invalidateClassDetailCache } from "@/lib/server-cache";

/* global var __classDetailCache is declared in classes/[classId]/route.ts */

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { assessmentIds } = body;

    if (!Array.isArray(assessmentIds) || assessmentIds.length === 0 || assessmentIds.length > 50) {
      return NextResponse.json({ error: "Invalid assessmentIds" }, { status: 400 });
    }

    await prisma.assessmentView.createMany({
      data: assessmentIds.map((assessmentId: string) => ({
        userId: session.user.id,
        assessmentId,
      })),
      skipDuplicates: true,
    });

    // Invalidate server-side class detail cache for this user so next
    // GET /api/classes/[classId] recomputes isNew correctly.
    const classDetailCacheMap = (globalThis as any).__classDetailCache as
      | Map<string, unknown>
      | undefined;
    if (classDetailCacheMap) {
      const userFragment = `${session.user.id}:`;
      for (const key of classDetailCacheMap.keys()) {
        if (key.startsWith(userFragment)) {
          classDetailCacheMap.delete(key);
        }
      }
    }

    // Also invalidate the general class detail cache for affected classes
    const assessmentsWithClass = await prisma.assessment.findMany({
      where: { id: { in: assessmentIds } },
      select: { classId: true },
      distinct: ["classId"],
    });
    for (const a of assessmentsWithClass) {
      invalidateClassDetailCache(a.classId);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error marking assessments as viewed:", error);
    return NextResponse.json({ error: "Failed to mark as viewed" }, { status: 500 });
  }
}
