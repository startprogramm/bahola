import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireDirector } from "@/lib/director/auth";

/**
 * GET /api/director/class-students?classId=xxx
 * GET /api/director/class-students?classIds=id1,id2,id3
 * Returns students enrolled in a class (or multiple classes) with their average scores.
 */
export async function GET(req: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { school } = auth;

  const classIdParam = req.nextUrl.searchParams.get("classId");
  const classIdsParam = req.nextUrl.searchParams.get("classIds");

  // Parse class IDs — support both single classId and comma-separated classIds
  let classIds: string[] = [];
  if (classIdsParam) {
    classIds = classIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (classIdParam) {
    classIds = [classIdParam];
  }

  if (classIds.length === 0) {
    return NextResponse.json({ error: "classId or classIds required" }, { status: 400 });
  }

  // Verify all classes belong to this school
  const classes = await prisma.class.findMany({
    where: { id: { in: classIds }, schoolId: school.id },
    select: { id: true },
  });
  if (classes.length !== classIds.length) {
    return NextResponse.json({ error: "One or more classes not found" }, { status: 404 });
  }

  // For each class, fetch enrollments + compute avg score
  const allStudentEntries: {
    id: string;
    name: string;
    email: string | null;
    avatar: string | null;
    subclass: string | null;
    avgScore: number | null;
    gradedCount: number;
    totalAssessments: number;
    variantClassId?: string;
  }[] = [];

  for (const cid of classIds) {
    // Get enrolled students
    const enrollments = await prisma.enrollment.findMany({
      where: { classId: cid, role: "STUDENT" },
      select: {
        student: {
          select: { id: true, name: true, email: true, avatar: true },
        },
      },
    });

    // Get all assessments for this class
    const assessments = await prisma.assessment.findMany({
      where: { classId: cid },
      select: { id: true },
    });
    const assessmentIds = assessments.map((a) => a.id);

    // Get all graded submissions for these assessments
    const submissions = await prisma.submission.findMany({
      where: {
        assessmentId: { in: assessmentIds },
        status: "GRADED",
        maxScore: { gt: 0 },
      },
      select: { studentId: true, score: true, maxScore: true },
    });

    // Fetch subclass info from SchoolMembership
    const studentIds = enrollments.map((e) => e.student.id);
    const memberships = await prisma.schoolMembership.findMany({
      where: { schoolId: school.id, role: "STUDENT", userId: { in: studentIds } },
      select: { userId: true, subclass: true },
    });
    const subclassMap: Record<string, string | null> = {};
    for (const m of memberships) {
      subclassMap[m.userId] = m.subclass;
    }

    // Compute per-student avg
    const studentScores: Record<string, { sum: number; count: number }> = {};
    for (const s of submissions) {
      if (s.score === null || !s.maxScore || s.maxScore <= 0) continue;
      if (!studentScores[s.studentId]) studentScores[s.studentId] = { sum: 0, count: 0 };
      studentScores[s.studentId].sum += (s.score / s.maxScore) * 100;
      studentScores[s.studentId].count++;
    }

    const classStudents = enrollments.map((e) => {
      const scores = studentScores[e.student.id];
      return {
        id: e.student.id,
        name: e.student.name,
        email: e.student.email,
        avatar: e.student.avatar,
        subclass: subclassMap[e.student.id] || null,
        avgScore: scores ? Math.round((scores.sum / scores.count) * 10) / 10 : null,
        gradedCount: scores?.count || 0,
        totalAssessments: assessmentIds.length,
        variantClassId: classIds.length > 1 ? cid : undefined,
      };
    });

    allStudentEntries.push(...classStudents);
  }

  // Sort combined list by avgScore descending
  const students = allStudentEntries.sort((a, b) => {
    if (a.avgScore === null && b.avgScore === null) return 0;
    if (a.avgScore === null) return 1;
    if (b.avgScore === null) return -1;
    return b.avgScore - a.avgScore;
  });

  return NextResponse.json({ students }, {
    headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=120" },
  });
}
