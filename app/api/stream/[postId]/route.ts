import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma, { isUserClassTeacher } from "@/lib/prisma";
import { invalidateClassDetailCache } from "@/lib/server-cache";

// PATCH - Update a stream post (pin/unpin or edit content)
export async function PATCH(
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
    const { pinned, content } = body;

    // Get the post and verify access
    const post = await prisma.streamPost.findUnique({
      where: { id: postId },
      include: {
        class: true,
      },
    });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const isTeacher = await isUserClassTeacher(session.user.id, post.classId);
    const isAuthor = post.authorId === session.user.id;

    // Handle content edit - only the author can edit their own post
    if (content !== undefined) {
      if (!isAuthor) {
        return NextResponse.json({ error: "Only the author can edit this post" }, { status: 403 });
      }

      if (!content.trim()) {
        return NextResponse.json({ error: "Content cannot be empty" }, { status: 400 });
      }

      const updatedPost = await prisma.streamPost.update({
        where: { id: postId },
        data: { content: content.trim() },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
          comments: {
            include: {
              author: {
                select: {
                  id: true,
                  name: true,
                  avatar: true,
                },
              },
            },
            orderBy: { createdAt: "asc" },
          },
          _count: {
            select: { comments: true },
          },
        },
      });

      invalidateClassDetailCache(post.classId);

      return NextResponse.json({ post: updatedPost });
    }

    // Handle pin/unpin - only teacher can pin/unpin
    if (pinned !== undefined) {
      if (!isTeacher) {
        return NextResponse.json({ error: "Only teachers can pin posts" }, { status: 403 });
      }

      const updatedPost = await prisma.streamPost.update({
        where: { id: postId },
        data: { pinned },
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

      return NextResponse.json({ post: updatedPost });
    }

    return NextResponse.json({ error: "No update fields provided" }, { status: 400 });
  } catch (error) {
    console.error("Error updating post:", error);
    return NextResponse.json(
      { error: "Failed to update post" },
      { status: 500 }
    );
  }
}

// DELETE - Delete a stream post
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { postId } = await params;

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get the post and verify access
    const post = await prisma.streamPost.findUnique({
      where: { id: postId },
      include: {
        class: true,
      },
    });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const isTeacher = await isUserClassTeacher(session.user.id, post.classId);
    const isAuthor = post.authorId === session.user.id;

    // Only teacher (including co-teachers) or author can delete
    if (!isTeacher && !isAuthor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Delete the post (cascade deletes comments)
    await prisma.streamPost.delete({
      where: { id: postId },
    });

    invalidateClassDetailCache(post.classId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting post:", error);
    return NextResponse.json(
      { error: "Failed to delete post" },
      { status: 500 }
    );
  }
}
