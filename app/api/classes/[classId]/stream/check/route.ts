import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import crypto from "crypto";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ classId: string }> }
) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { classId } = await params;

    // Lightweight query — only IDs, comment counts, and latest timestamp
    const posts = await prisma.streamPost.findMany({
      where: { classId },
      take: 30,
      select: { id: true, createdAt: true, _count: { select: { comments: true } } },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    });

    const fingerprint = posts
      .map((p) => `${p.id}:${p._count.comments}`)
      .sort()
      .join(",");
    const hash = crypto
      .createHash("md5")
      .update(fingerprint)
      .digest("hex")
      .slice(0, 12);

    // Latest post time for delta fetching
    const latestPostTime = posts.length > 0
      ? posts.reduce((latest, p) => p.createdAt > latest ? p.createdAt : latest, posts[0].createdAt).toISOString()
      : null;

    return NextResponse.json(
      { hash, postCount: posts.length, latestPostTime },
      {
        headers: {
          "Cache-Control": "private, max-age=5, stale-while-revalidate=10",
        },
      }
    );
  } catch (error) {
    console.error("Error checking stream:", error);
    return NextResponse.json(
      { error: "Failed to check stream" },
      { status: 500 }
    );
  }
}
