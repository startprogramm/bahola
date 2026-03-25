import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireDirector } from "@/lib/director/auth";
import { cached, isCacheHit } from "@/lib/director/server-cache";

/**
 * GET /api/director/teachers/[id]
 * Detailed teacher info: profile, classes, assessments, grading stats, credit usage
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { school } = auth;
  const { id: teacherId } = await params;
  const cacheKey = `director:teacher:${school.id}:${teacherId}`;

  const data = await cached(cacheKey, async () => {
    // Verify teacher belongs to this school
    const membership = await prisma.schoolMembership.findFirst({
      where: { userId: teacherId, schoolId: school.id, role: "TEACHER", status: "active" },
      select: { id: true },
    });

    if (!membership) return null;

    const classSelect = {
      id: true,
      name: true,
      subject: true,
      archived: true,
      _count: { select: { enrollments: { where: { role: "STUDENT" as const } }, assessments: true } },
      assessments: {
        select: {
          id: true,
          title: true,
          totalMarks: true,
          status: true,
          createdAt: true,
          submissions: {
            where: { status: "GRADED" as const },
            select: { score: true, maxScore: true },
          },
        },
        orderBy: { createdAt: "desc" as const },
      },
    };

    const teacher = await prisma.user.findUnique({
      where: { id: teacherId },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        subscription: true,
        credits: true,
        createdAt: true,
        teacherClasses: {
          where: { schoolId: school.id, archived: false },
          select: classSelect,
          orderBy: { name: "asc" },
        },
        creditTransactions: {
          where: { type: "USAGE" },
          select: { amount: true },
        },
      },
    });

    if (!teacher) return null;

    // Also fetch co-teacher classes (where teacher has Enrollment with role TEACHER)
    const coTeacherEnrollments = await prisma.enrollment.findMany({
      where: { studentId: teacherId, role: "TEACHER" },
      select: {
        class: {
          select: classSelect,
        },
      },
    });

    // Merge owned + co-teacher classes, deduplicate by id
    const ownedIds = new Set(teacher.teacherClasses.map((c) => c.id));
    const coTeacherClasses = coTeacherEnrollments
      .map((e) => e.class)
      .filter((c) => !ownedIds.has(c.id) && !c.archived);

    const allTeacherClasses = [...teacher.teacherClasses, ...coTeacherClasses]
      .sort((a, b) => a.name.localeCompare(b.name));

    // Compute stats
    const creditsUsed = teacher.creditTransactions.reduce(
      (sum, tx) => sum + Math.abs(tx.amount),
      0
    );

    const subjects = [
      ...new Set(allTeacherClasses.map((c) => c.subject).filter(Boolean)),
    ];

    let totalGraded = 0;
    let totalScoreSum = 0;

    const classes = allTeacherClasses.map((cls) => {
      let classGraded = 0;
      let classScoreSum = 0;

      for (const a of cls.assessments) {
        for (const s of a.submissions) {
          if (s.score !== null && s.maxScore && s.maxScore > 0) {
            classGraded++;
            classScoreSum += s.score / s.maxScore;
            totalGraded++;
            totalScoreSum += s.score / s.maxScore;
          }
        }
      }

      const assessments = cls.assessments.map((a) => {
        let gradedCount = 0;
        let scoreSum = 0;
        let weakCount = 0;
        let excellentCount = 0;

        for (const s of a.submissions) {
          if (s.score !== null && s.maxScore && s.maxScore > 0) {
            gradedCount++;
            const pct = (s.score / s.maxScore) * 100;
            scoreSum += pct;
            if (pct < 70) weakCount++;
            if (pct >= 85) excellentCount++;
          }
        }

        return {
          id: a.id,
          title: a.title,
          createdAt: a.createdAt,
          avgScore: gradedCount > 0 ? Math.round(scoreSum / gradedCount) : null,
          gradedCount,
          weakCount,
          excellentCount,
        };
      });

      return {
        id: cls.id,
        name: cls.name,
        subject: cls.subject,
        studentCount: cls._count.enrollments,
        assessmentCount: cls._count.assessments,
        avgScore: classGraded > 0 ? Math.round((classScoreSum / classGraded) * 100) : null,
        assessments,
      };
    });

    // Student stats across all classes
    interface StudentStat {
      studentId: string;
      name: string;
      grade: string | null;
      subclass: string | null;
      avgPct: number;
      total: number;
    }

    let allStudents: StudentStat[] = [];
    const classIds = allTeacherClasses.map((c) => c.id);
    if (classIds.length > 0) {
      allStudents = await prisma.$queryRaw<StudentStat[]>`
        SELECT
          u.id                                                                    AS "studentId",
          u.name,
          sm.grade,
          sm.subclass,
          ROUND(AVG(s.score::float / s."maxScore" * 100))::int                   AS "avgPct",
          COUNT(*)::int                                                           AS total
        FROM submissions s
        JOIN assessments a  ON a.id         = s."assessmentId"
        JOIN users u        ON u.id         = s."studentId"
        LEFT JOIN school_memberships sm
                            ON sm."userId"  = u.id
                           AND sm."schoolId"= ${school.id}
        WHERE a."classId" IN (${Prisma.join(classIds)})
          AND s.status     = 'GRADED'
          AND s."maxScore" > 0
        GROUP BY u.id, u.name, sm.grade, sm.subclass
        ORDER BY "avgPct" DESC
      `;
    }

    return {
      teacher: {
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
        avatar: teacher.avatar,
        subscription: teacher.subscription,
        credits: teacher.credits,
        creditsUsed,
        subjects,
        createdAt: teacher.createdAt,
      },
      classes,
      allStudents,
      totalGraded,
      avgScore: totalGraded > 0 ? Math.round((totalScoreSum / totalGraded) * 100) : null,
    };
  }, 2 * 60_000); // 2 min TTL

  if (data === null) {
    return NextResponse.json({ error: "Teacher not found in this school" }, { status: 404 });
  }

  const response = NextResponse.json(data);
  response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=120");
  response.headers.set("X-Data-Cache", isCacheHit(cacheKey) ? "HIT" : "MISS");
  return response;
}
