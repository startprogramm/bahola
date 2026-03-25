import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { EnrollmentRole } from "@prisma/client";
import ToReviewClient from "./to-review-client";

export default async function ToReviewPage() {
  const session = await getAuthSession();
  if (!session?.user?.id) redirect("/login");

  const classFilter = {
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

  const [submissions, teacherClasses] = await Promise.all([
    prisma.submission.findMany({
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
      include: {
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
    }),
    prisma.class.findMany({
      where: classFilter,
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <ToReviewClient
      initialSubmissions={JSON.parse(JSON.stringify(submissions))}
      initialClasses={JSON.parse(JSON.stringify(teacherClasses))}
    />
  );
}
