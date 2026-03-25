import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma, { isUserClassTeacher } from "@/lib/prisma";
import { isDirectorOfSchool } from "@/lib/director/auth";
import { uploadFile, generateFilename, deleteFile } from "@/lib/storage";
import { invalidateClassDetailCache } from "@/lib/server-cache";

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

    const classData = await prisma.class.findUnique({
      where: { id: classId },
      select: { id: true, teacherId: true, schoolId: true, classAvatar: true },
    });

    if (!classData) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    const hasAccess = await isUserClassTeacher(session.user.id, classId);
    const isDirector = !hasAccess && await isDirectorOfSchool(session.user.id, classData.schoolId);
    if (!hasAccess && !isDirector) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: "Invalid file type. Only JPEG, PNG, WebP, GIF allowed." }, { status: 400 });
    }

    // Validate size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large. Max 5MB." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = generateFilename(`class-banner-${classId}`, file.name);
    const url = await uploadFile(buffer, filename, file.type);

    // Delete old avatar if it was an upload
    if (classData.classAvatar && classData.classAvatar.startsWith("/uploads/")) {
      await deleteFile(classData.classAvatar).catch(() => {});
    }

    // Update class record
    const updated = await prisma.class.update({
      where: { id: classId },
      data: { classAvatar: url },
      select: { id: true, classAvatar: true },
    });

    invalidateClassDetailCache(classId);

    return NextResponse.json({ classAvatar: updated.classAvatar });
  } catch (error) {
    console.error("Error uploading class banner:", error);
    return NextResponse.json({ error: "Failed to upload banner" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { classId } = await params;

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const classData = await prisma.class.findUnique({
      where: { id: classId },
      select: { id: true, teacherId: true, schoolId: true, classAvatar: true },
    });

    if (!classData) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    const hasAccess = await isUserClassTeacher(session.user.id, classId);
    const isDirector = !hasAccess && await isDirectorOfSchool(session.user.id, classData.schoolId);
    if (!hasAccess && !isDirector) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Delete the file
    if (classData.classAvatar && classData.classAvatar.startsWith("/uploads/")) {
      await deleteFile(classData.classAvatar).catch(() => {});
    }

    // Clear the avatar
    await prisma.class.update({
      where: { id: classId },
      data: { classAvatar: null },
    });

    invalidateClassDetailCache(classId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting class banner:", error);
    return NextResponse.json({ error: "Failed to delete banner" }, { status: 500 });
  }
}
