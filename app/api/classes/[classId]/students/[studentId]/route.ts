import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma, { isUserClassTeacher } from "@/lib/prisma";

// POST /api/classes/[classId]/students/placeholder - Create a placeholder student and enroll them
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string; studentId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { classId, studentId } = await params;

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (studentId !== "placeholder") {
      return NextResponse.json({ error: "Invalid operation" }, { status: 400 });
    }

    const hasAccess = await isUserClassTeacher(session.user.id, classId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await request.json();
    const name = body.name?.trim();
    if (!name || name.length < 1) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Create placeholder student and enroll in one transaction
    const result = await prisma.$transaction(async (tx) => {
      const student = await tx.user.create({
        data: {
          name,
          role: "STUDENT",
          isPlaceholder: true,
          createdById: session.user.id,
          credits: 0,
        },
        select: { id: true, name: true },
      });

      await tx.enrollment.create({
        data: {
          studentId: student.id,
          classId,
          role: "STUDENT",
        },
      });

      return student;
    });

    return NextResponse.json({ student: result }, { status: 201 });
  } catch (error) {
    console.error("Error creating placeholder student:", error);
    return NextResponse.json({ error: "Failed to create student" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string; studentId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { classId, studentId } = await params;

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify the user has class-admin access (owner or co-teacher)
    const hasAccess = await isUserClassTeacher(session.user.id, classId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Find and delete the enrollment
    const enrollment = await prisma.enrollment.findFirst({
      where: {
        classId,
        studentId,
      },
    });

    if (!enrollment) {
      return NextResponse.json(
        { error: "Student not enrolled in this class" },
        { status: 404 }
      );
    }

    await prisma.enrollment.delete({
      where: { id: enrollment.id },
    });

    return NextResponse.json({ message: "Student removed from class" });
  } catch (error) {
    console.error("Error removing student:", error);
    return NextResponse.json(
      { error: "Failed to remove student" },
      { status: 500 }
    );
  }
}
