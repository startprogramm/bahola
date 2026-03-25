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

    const studentId = session.user.id;

    // Run independent queries in parallel for better performance
    const [totalClasses, completedAssessments, submissions, enrolledClassIds] = await Promise.all([
      prisma.enrollment.count({
        where: { studentId },
      }),
      prisma.submission.count({
        where: {
          studentId,
          status: "GRADED",
        },
      }),
      prisma.submission.findMany({
        where: {
          studentId,
          status: "GRADED",
          score: { not: null },
          maxScore: { not: null },
        },
        select: {
          score: true,
          maxScore: true,
        },
      }),
      prisma.enrollment.findMany({
        where: { studentId },
        select: { classId: true },
      }),
    ]);

    // Calculate average score
    let averageScore = 0;
    if (submissions.length > 0) {
      const totalPercentage = submissions.reduce((acc, sub) => {
        return acc + ((sub.score || 0) / (sub.maxScore || 1)) * 100;
      }, 0);
      averageScore = totalPercentage / submissions.length;
    }

    const classIds = enrolledClassIds.map((e) => e.classId);

    // Run remaining dependent queries in parallel
    const [totalActiveAssessments, submittedAssessments] = await Promise.all([
      prisma.assessment.count({
        where: {
          classId: { in: classIds },
          status: "ACTIVE",
        },
      }),
      prisma.submission.count({
        where: {
          studentId,
          assessment: {
            classId: { in: classIds },
          },
        },
      }),
    ]);

    const pendingAssessments = totalActiveAssessments - submittedAssessments;

    return NextResponse.json({
      totalClasses,
      completedAssessments,
      averageScore,
      pendingAssessments: Math.max(0, pendingAssessments),
    }, {
      headers: {
        'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error("Error fetching student dashboard stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard stats" },
      { status: 500 }
    );
  }
}
