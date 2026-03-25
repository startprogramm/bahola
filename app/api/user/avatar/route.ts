import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { deleteFile } from "@/lib/storage";
import sharp from "sharp";

const MAX_AVATAR_SIZE = 10 * 1024 * 1024; // 10MB input limit
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

async function compressAvatar(buffer: Buffer): Promise<string> {
  const compressed = await sharp(buffer)
    .rotate() // fix EXIF orientation
    .resize(200, 200, { fit: "cover", position: "centre" })
    .jpeg({ quality: 75, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${compressed.toString("base64")}`;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("avatar") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No avatar file provided" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF" }, { status: 400 });
    }
    if (file.size > MAX_AVATAR_SIZE) {
      return NextResponse.json({ error: "File too large. Maximum size is 10MB." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const avatarDataUrl = await compressAvatar(buffer);

    // Clean up old filesystem avatar if present
    const current = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { avatar: true },
    });
    if (current?.avatar?.startsWith("/uploads/")) {
      await deleteFile(current.avatar).catch(() => {});
    }

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: { avatar: avatarDataUrl },
      select: { id: true, avatar: true },
    });

    return NextResponse.json({ avatar: user.avatar });
  } catch (error) {
    console.error("Error uploading avatar:", error);
    return NextResponse.json({ error: "Failed to upload avatar" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await getAuthSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const current = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { avatar: true },
    });
    if (current?.avatar?.startsWith("/uploads/")) {
      await deleteFile(current.avatar).catch(() => {});
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { avatar: null },
    });

    return NextResponse.json({ avatar: null });
  } catch (error) {
    console.error("Error removing avatar:", error);
    return NextResponse.json({ error: "Failed to remove avatar" }, { status: 500 });
  }
}
