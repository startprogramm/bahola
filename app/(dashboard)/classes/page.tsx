import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { cached } from "@/lib/server-cache";
import ClassesClient from "./classes-client";

const classSelect = {
  id: true,
  name: true,
  code: true,
  subject: true,
  description: true,
  headerColor: true,
  bannerStyle: true,
  classAvatar: true,
  createdAt: true,
  updatedAt: true,
  teacherId: true,
  _count: {
    select: {
      enrollments: true,
      assessments: true,
    },
  },
  assessments: {
    where: {
      status: "ACTIVE" as const,
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
    },
    orderBy: { createdAt: "desc" as const },
    take: 5,
  },
};

async function getClassesData(userId: string) {
  return cached(`classes:${userId}`, async () => {
    const [teachingClasses, enrollments] = await Promise.all([
      (async () => {
        try {
          return await prisma.class.findMany({
            where: {
              teacherId: userId,
              archived: false,
            },
            select: classSelect,
            orderBy: { createdAt: "desc" },
            take: 50,
          });
        } catch (error) {
          const isSchemaMismatch =
            error instanceof Prisma.PrismaClientKnownRequestError &&
            (error.code === "P2021" || error.code === "P2022");
          if (!isSchemaMismatch) throw error;

          return await prisma.class.findMany({
            where: {
              teacherId: userId,
            },
            select: classSelect,
            orderBy: { createdAt: "desc" },
            take: 50,
          });
        }
      })(),
      prisma.enrollment.findMany({
        where: { studentId: userId },
        select: {
          id: true,
          role: true,
          joinedAt: true,
          class: {
            select: {
              id: true,
              name: true,
              code: true,
              subject: true,
              description: true,
              headerColor: true,
              bannerStyle: true,
              classAvatar: true,
              createdAt: true,
              teacherId: true,
              teacher: {
                select: { name: true, avatar: true },
              },
              _count: {
                select: { assessments: true },
              },
              assessments: {
                where: { status: "ACTIVE" },
                select: { id: true, title: true, dueDate: true },
                orderBy: { createdAt: "desc" },
                take: 5,
              },
            },
          },
        },
        orderBy: { joinedAt: "desc" },
      }),
    ]);
    return { teachingClasses, enrollments };
  }, 120_000); // 2 min cache per user (mutations invalidate via invalidateGeneralCache)
}

export default async function ClassesPage() {
  const session = await getAuthSession();
  if (!session?.user?.id) redirect("/login");

  const { teachingClasses, enrollments } = await getClassesData(session.user.id);

  return (
    <ClassesClient
      initialMyClasses={JSON.parse(JSON.stringify(teachingClasses))}
      initialEnrolledClasses={JSON.parse(JSON.stringify(enrollments))}
    />
  );
}
