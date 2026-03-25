export const revalidate = 60; // Cache for 60 seconds
import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const session = await getAuthSession();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const teacherId = session.user.id;

    // Get user's school to filter classes
    const user = await prisma.user.findUnique({
      where: { id: teacherId },
      select: { schoolId: true },
    });
    const classFilter = {
      teacherId,
      ...(user?.schoolId ? { schoolId: user.schoolId } : {}),
    };

    // Run all counts in parallel for better performance
    const [totalClasses, totalStudents, totalAssessments, pendingSubmissions] = await Promise.all([
      prisma.class.count({
        where: classFilter,
      }),
      prisma.enrollment.count({
        where: {
          class: classFilter,
          role: "STUDENT",
        },
      }),
      prisma.assessment.count({
        where: {
          class: classFilter,
        },
      }),
      prisma.submission.count({
        where: {
          status: { in: ["PENDING", "PROCESSING"] },
          assessment: {
            class: classFilter,
          },
        },
      }),
    ]);

    return NextResponse.json({
      totalClasses,
      totalStudents,
      totalAssessments,
      pendingSubmissions,
    }, {
      headers: {
        'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard stats" },
      { status: 500 }
    );
  }
}
