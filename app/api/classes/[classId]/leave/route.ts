import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isMaktab } from "@/lib/platform";
import { invalidateClassDetailCache } from "@/lib/server-cache";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  try {
    if (isMaktab()) {
      return NextResponse.json({ error: "Leaving classes is not allowed in maktab mode" }, { status: 403 });
    }

    const session = await getAuthSession();
    const { classId } = await params;

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Find the enrollment
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        studentId_classId: {
          studentId: session.user.id,
          classId,
        },
      },
    });

    if (!enrollment) {
      return NextResponse.json({ error: "Not enrolled in this class" }, { status: 404 });
    }

    // Delete the enrollment
    await prisma.enrollment.delete({
      where: { id: enrollment.id },
    });

    invalidateClassDetailCache(classId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error leaving class:", error);
    return NextResponse.json({ error: "Failed to leave class" }, { status: 500 });
  }
}
