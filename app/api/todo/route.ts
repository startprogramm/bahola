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
    const status = searchParams.get("status") || "assigned"; // assigned, missing, done
    const classId = searchParams.get("classId");

    const userId = session.user.id;
    const now = new Date();

    // Get user's classes - check both as teacher and student
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
    const isStudent = enrollments.length > 0;
    
    let classIds: string[] = Array.from(new Set([
      ...ownedClasses.map((c) => c.id),
      ...enrollments.map((e) => e.classId)
    ]));

    // Filter by specific class if provided
    if (classId && classIds.includes(classId)) {
      classIds = [classId];
    }

    // Build query
    const assessments = await prisma.assessment.findMany({
      where: {
        classId: { in: classIds },
        class: { archived: false },
        status: "ACTIVE",
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
            teacherId: true,
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
            createdAt: true,
          },
        },
        _count: {
          select: {
            submissions: true,
          },
        },
      },
      orderBy: [
        { dueDate: "asc" },
        { createdAt: "desc" },
      ],
    });

    // Process assessments based on user's role in each class
    let filteredAssessments = assessments.map((a) => {
      const isTeacherOfThisClass = a.class.teacherId === userId;
      const submission = a.submissions[0] || null;
      let submissionStatus: "assigned" | "missing" | "done";

      if (isTeacherOfThisClass) {
        // For teachers:
        // 'done' means all students have submitted (simplified)
        // For now, let's say teachers see all active assessments in 'assigned' 
        // unless they specifically want to see 'done' or 'missing'
        // But the user's request "filter not working" usually implies student view issues.
        // Let's make it consistent:
        submissionStatus = "assigned";
      } else {
        // For students:
        if (!submission) {
          if (a.dueDate && new Date(a.dueDate) < now) {
            submissionStatus = "missing";
          } else {
            submissionStatus = "assigned";
          }
        } else {
          submissionStatus = "done";
        }
      }

      return {
        id: a.id,
        title: a.title,
        dueDate: a.dueDate,
        totalMarks: a.totalMarks,
        createdAt: a.createdAt,
        class: a.class,
        submissionStatus,
        submission,
        isTeacher: isTeacherOfThisClass,
      };
    });

    // Filter by requested status
    if (status === "assigned") {
      filteredAssessments = filteredAssessments.filter(
        (a) => a.submissionStatus === "assigned"
      );
    } else if (status === "missing") {
      filteredAssessments = filteredAssessments.filter(
        (a) => a.submissionStatus === "missing"
      );
    } else if (status === "done") {
      filteredAssessments = filteredAssessments.filter(
        (a) => a.submissionStatus === "done"
      );
    }

    // Group by time period
    const grouped = {
      noDueDate: [] as typeof filteredAssessments,
      overdue: [] as typeof filteredAssessments,
      today: [] as typeof filteredAssessments,
      tomorrow: [] as typeof filteredAssessments,
      thisWeek: [] as typeof filteredAssessments,
      nextWeek: [] as typeof filteredAssessments,
      later: [] as typeof filteredAssessments,
    };

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setHours(23, 59, 59, 999);

    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setHours(23, 59, 59, 999);

    // This week (from tomorrow to Sunday)
    const thisWeekEnd = new Date(todayStart);
    const dayOfWeek = todayStart.getDay(); // 0 is Sunday
    const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    thisWeekEnd.setDate(thisWeekEnd.getDate() + daysUntilSunday);
    thisWeekEnd.setHours(23, 59, 59, 999);

    // Next week
    const nextWeekStart = new Date(thisWeekEnd);
    nextWeekStart.setDate(nextWeekStart.getDate() + 1);
    const nextWeekEnd = new Date(nextWeekStart);
    nextWeekEnd.setDate(nextWeekEnd.getDate() + 6);
    nextWeekEnd.setHours(23, 59, 59, 999);

    filteredAssessments.forEach((a) => {
      if (!a.dueDate) {
        grouped.noDueDate.push(a);
      } else {
        const dueDate = new Date(a.dueDate);
        if (dueDate < todayStart) {
          grouped.overdue.push(a);
        } else if (dueDate >= todayStart && dueDate <= todayEnd) {
          grouped.today.push(a);
        } else if (dueDate >= tomorrowStart && dueDate <= tomorrowEnd) {
          grouped.tomorrow.push(a);
        } else if (dueDate > tomorrowEnd && dueDate <= thisWeekEnd) {
          grouped.thisWeek.push(a);
        } else if (dueDate > thisWeekEnd && dueDate <= nextWeekEnd) {
          grouped.nextWeek.push(a);
        } else {
          grouped.later.push(a);
        }
      }
    });

    return NextResponse.json({
      grouped,
      total: filteredAssessments.length,
      classIds,
    }, {
      headers: { "Cache-Control": "private, max-age=10, stale-while-revalidate=30" },
    });
  } catch (error) {
    console.error("Todo API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch todo data" },
      { status: 500 }
    );
  }
}
