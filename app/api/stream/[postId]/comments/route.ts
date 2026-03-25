import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { invalidateClassDetailCache } from "@/lib/server-cache";

// POST - Add a comment to a stream post
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { postId } = await params;

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { content } = body;

    if (!content || content.trim().length === 0) {
      return NextResponse.json(
        { error: "Content is required" },
        { status: 400 }
      );
    }

    // Get the post and verify access
    const post = await prisma.streamPost.findUnique({
      where: { id: postId },
      include: {
        class: {
          include: {
            enrollments: {
              where: { studentId: session.user.id },
              select: { id: true },
            },
          },
        },
      },
    });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const isTeacher =
      post.class.teacherId === session.user.id;
    const isEnrolled = post.class.enrollments.length > 0;

    if (!isTeacher && !isEnrolled) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Create the comment
    const comment = await prisma.streamComment.create({
      data: {
        content: content.trim(),
        postId,
        authorId: session.user.id,
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    invalidateClassDetailCache(post.classId);

    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    console.error("Error creating comment:", error);
    return NextResponse.json(
      { error: "Failed to create comment" },
      { status: 500 }
    );
  }
}
