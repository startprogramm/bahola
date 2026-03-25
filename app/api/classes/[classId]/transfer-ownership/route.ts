import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma, { isUserClassTeacher } from "@/lib/prisma";
import { invalidateClassDetailCache } from "@/lib/server-cache";

// POST: Promote a student to co-teacher (or demote a co-teacher back to student)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { classId } = await params;

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { newTeacherId, demote } = await request.json();

    if (!newTeacherId) {
      return NextResponse.json({ error: "User ID required" }, { status: 400 });
    }

    const classData = await prisma.class.findUnique({
      where: { id: classId },
      select: {
        id: true,
        teacherId: true,
        enrollments: {
          select: {
            id: true,
            studentId: true,
            role: true,
          },
        },
      },
    });

    if (!classData) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    // Class owner or co-teacher can promote/demote members
    const hasAccess = await isUserClassTeacher(session.user.id, classId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Only class admins can promote or demote members" }, { status: 403 });
    }

    // Can't promote/demote yourself
    if (newTeacherId === session.user.id) {
      return NextResponse.json({ error: "Cannot change your own role" }, { status: 400 });
    }

    // User must be enrolled in the class
    const enrollment = classData.enrollments.find(
      (e) => e.studentId === newTeacherId
    );

    if (!enrollment) {
      return NextResponse.json({ error: "User must be enrolled in the class" }, { status: 400 });
    }

    const newRole = demote ? "STUDENT" : "TEACHER";

    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: { role: newRole },
    });

    invalidateClassDetailCache(classId);

    return NextResponse.json({
      message: demote ? "Demoted to student" : "Promoted to teacher",
      role: newRole,
    });
  } catch (error) {
    console.error("Error updating member role:", error);
    return NextResponse.json(
      { error: "Failed to update member role" },
      { status: 500 }
    );
  }
}
