import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { uploadFile, generateFilename } from "@/lib/storage";
import { isDirectorOfSchool } from "@/lib/director/auth";
import { invalidateClassDetailCache } from "@/lib/server-cache";

// GET - Fetch stream posts for a class
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { classId } = await params;

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Lightweight parallel auth check
    const [classBasic, enrollment] = await Promise.all([
      prisma.class.findUnique({
        where: { id: classId },
        select: { id: true, teacherId: true, schoolId: true, teacher: { select: { name: true, avatar: true } } },
      }),
      prisma.enrollment.findUnique({
        where: { studentId_classId: { studentId: session.user.id, classId } },
        select: { id: true },
      })
    ]);

    if (!classBasic) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    const isTeacher = classBasic.teacherId === session.user.id;
    const isEnrolled = !!enrollment;

    let isDirector = false;
    if (!isTeacher && !isEnrolled) {
      isDirector = await isDirectorOfSchool(session.user.id, classBasic.schoolId);
    }

    if (!isTeacher && !isDirector && !isEnrolled) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch stream posts and assessments in parallel
    const [streamPosts, assessments] = await Promise.all([
      prisma.streamPost.findMany({
        where: { classId },
        take: 30,
        include: {
          author: {
            select: { id: true, name: true, avatar: true, role: true },
          },
          comments: {
            include: {
              author: {
                select: { id: true, name: true, avatar: true, role: true },
              },
            },
            orderBy: { createdAt: "asc" },
          },
          _count: {
            select: { comments: true },
          },
        },
        orderBy: [
          { pinned: "desc" },
          { createdAt: "desc" },
        ],
      }),
      prisma.assessment.findMany({
        where: { classId, status: "ACTIVE" },
        select: { id: true, title: true, createdAt: true, dueDate: true },
      }),
    ]);

    // Find assessment IDs already linked in stream posts
    const linkedAssessmentIds = new Set<string>();
    for (const post of streamPosts) {
      if (post.attachments) {
        try {
          const atts = JSON.parse(post.attachments) as any[];
          for (const att of atts) {
            if (att.type === "assessment") linkedAssessmentIds.add(att.id);
          }
        } catch {}
      }
    }

    // Create virtual posts for assessments not already in stream
    const virtualPosts = assessments
      .filter((a) => !linkedAssessmentIds.has(a.id))
      .map((a) => ({
        id: `assessment-${a.id}`,
        content: "",
        attachments: JSON.stringify([{ type: "assessment", id: a.id, title: a.title }]),
        classId,
        authorId: classBasic.teacherId,
        author: { id: classBasic.teacherId, name: classBasic.teacher.name, avatar: classBasic.teacher.avatar },
        pinned: false,
        createdAt: a.createdAt,
        updatedAt: a.createdAt,
        comments: [],
        _count: { comments: 0 },
        _virtual: true,
      }));

    // Merge and sort: pinned first, then by date descending
    const posts = [...streamPosts, ...virtualPosts]
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
      .slice(0, 30);

    return NextResponse.json({ posts }, {
      headers: {
        'Cache-Control': 'private, max-age=10, stale-while-revalidate=30',
      },
    });
  } catch (error) {
    console.error("Error fetching stream:", error);
    return NextResponse.json(
      { error: "Failed to fetch stream" },
      { status: 500 }
    );
  }
}

// POST - Create a new stream post (supports file attachments via FormData)
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

    // Parse form data
    const formData = await request.formData();
    const content = formData.get("content") as string || "";
    const attachmentFiles = formData.getAll("attachments") as File[];

    // Allow empty content if there are attachments
    if (!content.trim() && attachmentFiles.length === 0) {
      return NextResponse.json(
        { error: "Content or attachments required" },
        { status: 400 }
      );
    }

    // Verify user has access to this class
    const classData = await prisma.class.findUnique({
      where: { id: classId },
      select: {
        id: true,
        teacherId: true,
        schoolId: true,
        enrollments: {
          where: { studentId: session.user.id },
          select: { id: true },
        },
      },
    });

    if (!classData) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    const isPostTeacher = classData.teacherId === session.user.id;
    const isEnrolled = classData.enrollments.length > 0;
    const isPostDirector = !isPostTeacher && await isDirectorOfSchool(session.user.id, classData.schoolId);

    if (!isPostTeacher && !isEnrolled && !isPostDirector) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Upload attachments
    const attachmentUrls: { name: string; url: string; type: string; size: number }[] = [];
    for (let i = 0; i < attachmentFiles.length; i++) {
      const file = attachmentFiles[i];
      if (file && file.size > 0) {
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const filename = generateFilename(`stream/${classId}`, file.name, i);
        const url = await uploadFile(buffer, filename, file.type);
        attachmentUrls.push({
          name: file.name,
          url,
          type: file.type,
          size: file.size,
        });
      }
    }

    // Create the post
    const post = await prisma.streamPost.create({
      data: {
        content: content.trim(),
        attachments: attachmentUrls.length > 0 ? JSON.stringify(attachmentUrls) : null,
        classId,
        authorId: session.user.id,
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            avatar: true,
            role: true,
          },
        },
        comments: true,
        _count: {
          select: { comments: true },
        },
      },
    });

    invalidateClassDetailCache(classId);

    return NextResponse.json({ post }, { status: 201 });
  } catch (error) {
    console.error("Error creating post:", error);
    return NextResponse.json(
      { error: "Failed to create post" },
      { status: 500 }
    );
  }
}
