import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { EnrollmentRole } from "@prisma/client";
import { generateETag, checkNotModified, jsonWithETag } from "@/lib/etag";
import { cached } from "@/lib/server-cache";

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const classId = searchParams.get("classId");

    const cacheKey = `to-review:${session.user.id}:${classId || "all"}`;

    const classFilter = classId
      ? {
          id: classId,
          OR: [
            { teacherId: session.user.id },
            {
              enrollments: {
                some: {
                  studentId: session.user.id,
                  role: EnrollmentRole.TEACHER,
                },
              },
            },
          ],
        }
      : {
          OR: [
            { teacherId: session.user.id },
            {
              enrollments: {
                some: {
                  studentId: session.user.id,
                  role: EnrollmentRole.TEACHER,
                },
              },
            },
          ],
        };

    const payload = await cached(cacheKey, async () => {
      const submissions = await prisma.submission.findMany({
        where: {
          OR: [
            {
              status: { in: ["PENDING", "PROCESSING"] },
              assessment: { class: classFilter },
            },
            {
              reportedAt: { not: null },
              assessment: { class: classFilter },
            },
          ],
        },
        select: {
          id: true,
          status: true,
          score: true,
          maxScore: true,
          gradingProgress: true,
          createdAt: true,
          reportReason: true,
          reportedAt: true,
          student: {
            select: {
              id: true,
              name: true,
            },
          },
          assessment: {
            select: {
              id: true,
              title: true,
              totalMarks: true,
              feedbackLanguage: true,
              class: {
                select: {
                  id: true,
                  name: true,
                  headerColor: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return { submissions };
    }, 30_000);
    const etag = generateETag(payload);
    const notModified = checkNotModified(request, etag);
    if (notModified) return notModified;
    return jsonWithETag(payload, etag);
  } catch (error) {
    console.error("Error fetching to-review submissions:", error);
    return NextResponse.json(
      { error: "Failed to fetch submissions" },
      { status: 500 }
    );
  }
}
