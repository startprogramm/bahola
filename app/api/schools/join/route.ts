import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { enrollStudentInSchoolClasses } from "@/lib/school-utils";
import { z } from "zod";

const joinSchema = z.object({
  code: z.string().min(1, "School code is required"),
  role: z.enum(["STUDENT", "TEACHER"]),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const data = joinSchema.parse(body);

    // Find school by code
    const school = await prisma.school.findUnique({
      where: { code: data.code.trim().toUpperCase() },
    });

    if (!school || !school.isActive) {
      return NextResponse.json({ error: "School not found. Please check the code." }, { status: 404 });
    }

    // Check if already in this school
    const existing = await prisma.schoolMembership.findUnique({
      where: { userId_schoolId: { userId: session.user.id, schoolId: school.id } },
    });
    if (existing && existing.status === "active") {
      return NextResponse.json({ error: "You are already a member of this school." }, { status: 409 });
    }

    let enrolledCount = 0;

    await prisma.$transaction(async (tx) => {
      // Update user's school and role
      await tx.user.update({
        where: { id: session.user.id },
        data: { schoolId: school.id, role: data.role },
      });

      // Upsert membership record
      await tx.schoolMembership.upsert({
        where: { userId_schoolId: { userId: session.user.id, schoolId: school.id } },
        create: {
          userId: session.user.id,
          schoolId: school.id,
          role: data.role,
          status: "active",
        },
        update: { role: data.role, status: "active" },
      });
    });

    // If student, auto-enroll in all school classes
    if (data.role === "STUDENT") {
      enrolledCount = await enrollStudentInSchoolClasses(session.user.id, school.id);
    }

    return NextResponse.json({
      success: true,
      school: { id: school.id, name: school.name },
      enrolledClasses: enrolledCount,
      message:
        data.role === "STUDENT"
          ? `Successfully joined ${school.name} and enrolled in ${enrolledCount} class${enrolledCount !== 1 ? "es" : ""}.`
          : `Successfully joined ${school.name} as a teacher.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
    }
    console.error("Join school error:", error);
    return NextResponse.json({ error: "Failed to join school" }, { status: 500 });
  }
}

/** Preview: validate a school code before joining */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.json({ error: "Code required" }, { status: 400 });

  const school = await prisma.school.findUnique({
    where: { code: code.trim().toUpperCase() },
    select: {
      id: true,
      name: true,
      code: true,
      isActive: true,
      _count: {
        select: {
          members: { where: { role: "STUDENT" } },
          classes: { where: { archived: false } },
        },
      },
    },
  });

  if (!school || !school.isActive) {
    return NextResponse.json({ school: null });
  }

  return NextResponse.json({ school });
}
