import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const startParam = searchParams.get("start");

    // Parse start date or use current week's Monday
    let startDate: Date;
    if (startParam) {
      startDate = new Date(startParam);
    } else {
      startDate = new Date();
      const day = startDate.getDay();
      const diff = startDate.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
      startDate.setDate(diff);
    }
    startDate.setHours(0, 0, 0, 0);

    // End of week (Sunday)
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);
    endDate.setHours(23, 59, 59, 999);

    const userId = session.user.id;

    // Check if user owns any classes (is a teacher) or is enrolled as student
    const [ownedClasses, enrollments] = await Promise.all([
      prisma.class.findMany({
        where: { teacherId: userId, archived: false },
        select: { id: true },
      }),
      prisma.enrollment.findMany({
        where: { studentId: userId },
        select: { classId: true },
      }),
    ]);

    const isTeacher = ownedClasses.length > 0;

    // Get assessments based on role
    let assessments;

    if (isTeacher) {
      // Teachers see assessments from their own classes
      assessments = await prisma.assessment.findMany({
        where: {
          class: {
            teacherId: userId,
            archived: false,
          },
          status: "ACTIVE",
          dueDate: {
            gte: startDate,
            lte: endDate,
          },
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          totalMarks: true,
          createdAt: true,
          class: {
            select: {
              id: true,
              name: true,
              headerColor: true,
            },
          },
          _count: {
            select: {
              submissions: true,
            },
          },
        },
        orderBy: {
          dueDate: "asc",
        },
      });
    } else {
      // Students see assessments from classes they're enrolled in
      const classIds = enrollments.map((e) => e.classId);

      assessments = await prisma.assessment.findMany({
        where: {
          classId: { in: classIds },
          class: {
            archived: false,
          },
          status: "ACTIVE",
          dueDate: {
            gte: startDate,
            lte: endDate,
          },
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          totalMarks: true,
          createdAt: true,
          class: {
            select: {
              id: true,
              name: true,
              headerColor: true,
            },
          },
          submissions: {
            where: {
              studentId: userId,
            },
            select: {
              id: true,
              status: true,
              score: true,
              maxScore: true,
            },
          },
        },
        orderBy: {
          dueDate: "asc",
        },
      });
    }

    // Group assessments by day of week
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const weekDays: Record<string, any[]> = {};
    for (let i = 0; i < 7; i++) {
      const day = new Date(startDate);
      day.setDate(day.getDate() + i);
      const dateKey = day.toISOString().split("T")[0];
      weekDays[dateKey] = [];
    }

    assessments.forEach((assessment) => {
      if (assessment.dueDate) {
        const dateKey = assessment.dueDate.toISOString().split("T")[0];
        if (weekDays[dateKey]) {
          weekDays[dateKey].push(assessment);
        }
      }
    });

    return NextResponse.json({
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      weekDays,
      totalAssessments: assessments.length,
    }, {
      headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Calendar API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch calendar data" },
      { status: 500 }
    );
  }
}
