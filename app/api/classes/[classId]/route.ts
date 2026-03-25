import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma, { isSuperAdmin, isUserClassTeacher } from "@/lib/prisma";
import { isDirectorOfSchool } from "@/lib/director/auth";
import { isMaktab } from "@/lib/platform";
import { generateETag, checkNotModified, jsonWithETag } from "@/lib/etag";
import { invalidateGeneralCache, invalidateClassDetailCache as invalidateClassDetailGeneralCache } from "@/lib/server-cache";

type ClassDetailCachePayload = {
  class: unknown;
};

type ClassDetailCacheEntry = {
  payload: ClassDetailCachePayload;
  expiresAt: number;
};

const CLASS_DETAIL_CACHE_TTL_MS = 120_000;
const CLASS_DETAIL_CACHE_MAX_ENTRIES = 500;

declare global {
  // eslint-disable-next-line no-var
  var __classDetailCache: Map<string, ClassDetailCacheEntry> | undefined;
}

const classDetailCache =
  globalThis.__classDetailCache ?? new Map<string, ClassDetailCacheEntry>();

if (!globalThis.__classDetailCache) {
  globalThis.__classDetailCache = classDetailCache;
}

const getClassDetailFromCache = (
  cacheKey: string
): ClassDetailCachePayload | null => {
  const cached = classDetailCache.get(cacheKey);
  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    classDetailCache.delete(cacheKey);
    return null;
  }

  return cached.payload;
};

const setClassDetailCache = (
  cacheKey: string,
  payload: ClassDetailCachePayload
) => {
  classDetailCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + CLASS_DETAIL_CACHE_TTL_MS,
  });

  if (classDetailCache.size > CLASS_DETAIL_CACHE_MAX_ENTRIES) {
    const firstKey = classDetailCache.keys().next().value;
    if (firstKey) {
      classDetailCache.delete(firstKey);
    }
  }
};

const invalidateClassDetailCache = (classId: string) => {
  const cacheKeyFragment = `:${classId}:`;
  for (const key of classDetailCache.keys()) {
    if (key.includes(cacheKeyFragment)) {
      classDetailCache.delete(key);
    }
  }
};

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

    // Fetch enrollment and full class data in parallel (single class query for both auth and response)
    const [enrollment, classDataFull] = await Promise.all([
      prisma.enrollment.findUnique({
        where: { studentId_classId: { studentId: session.user.id, classId } },
        select: { role: true },
      }),
      prisma.class.findUnique({
      where: { id: classId },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        subject: true,
        headerColor: true,
        bannerStyle: true,
        classAvatar: true,
        createdAt: true,
        updatedAt: true,
        teacherId: true,
        schoolId: true,
        teacher: {
          select: { id: true, name: true, email: true, avatar: true },
        },
        enrollments: {
          select: {
            id: true,
            role: true,
            joinedAt: true,
            studentId: true,
            student: {
              select: {
                id: true,
                name: true,
                email: true,
                avatar: true,
              },
            },
          },
          orderBy: { joinedAt: "desc" },
        },
      },
    }),
    ]);

    if (!classDataFull) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    const isClassOwner = classDataFull.teacherId === session.user.id;
    const isCoTeacher = enrollment?.role === "TEACHER";
    const isEnrolledStudent = enrollment?.role === "STUDENT";

    // Only check director status if not already authorized as teacher/student
    let isDirector = false;
    if (!isClassOwner && !isCoTeacher && !isEnrolledStudent) {
      isDirector = await isDirectorOfSchool(session.user.id, classDataFull.schoolId);
    }

    if (!isClassOwner && !isCoTeacher && !isEnrolledStudent && !isDirector) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Superadmin: keep original role but grant teacher-level permissions
    const isSA = (isCoTeacher || isEnrolledStudent) && await isSuperAdmin(session.user.id);

    // Teachers enrolled as students can still view grades (read-only teacher data)
    const isTeacherRoleUser = isEnrolledStudent && session.user.role === "TEACHER";

    const viewerRole =
      isClassOwner
        ? "OWNER"
        : isCoTeacher
          ? "CO_TEACHER"
          : isDirector
            ? "DIRECTOR"
            : "STUDENT";
    const viewerCanManage = isClassOwner || isCoTeacher || isDirector || isSA;
    const viewerCanViewTeacherData = isClassOwner || isCoTeacher || isDirector || isSA || isTeacherRoleUser;
    const viewerCanInteractWithStream = true;

    const cacheKey = `${session.user.id}:${classId}:${viewerRole}`;
    const cachedPayload = getClassDetailFromCache(cacheKey);
    if (cachedPayload) {
      const etag = generateETag(cachedPayload);
      const notModified = checkNotModified(request, etag);
      if (notModified) return notModified;
      return jsonWithETag(cachedPayload, etag, { "X-Data-Cache": "HIT" });
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Strip schoolId from response (used only for auth above)
    const { schoolId: _schoolId, ...classDataClean } = classDataFull;

    const classData: typeof classDataClean | null = classDataClean;
    let assessments: any[] = [];

    // Shared views query — runs in parallel with assessments (saves one DB round-trip)
    const viewsPromise = prisma.assessmentView.findMany({
      where: {
        userId: session.user.id,
        assessment: { classId, createdAt: { gt: sevenDaysAgo } },
      },
      select: { assessmentId: true },
    });

    if (viewerCanViewTeacherData) {
      const [teacherAssessments, recentViews] = await Promise.all([
        prisma.assessment.findMany({
          where: { classId },
          select: {
            id: true,
            title: true,
            totalMarks: true,
            dueDate: true,
            status: true,
            createdAt: true,
            _count: { select: { submissions: true } },
            submissions: {
              where: { status: "GRADED" },
              select: { id: true }
            }
          },
          orderBy: { createdAt: "desc" },
        }),
        viewsPromise,
      ]);

      const viewedIds = new Set(recentViews.map((v) => v.assessmentId));
      assessments = teacherAssessments.map((assessment) => ({
        ...assessment,
        gradedSubmissionsCount: assessment.submissions.length,
        submissions: [],
        isNew: new Date(assessment.createdAt) > sevenDaysAgo && !viewedIds.has(assessment.id),
      }));
    } else {
      const [studentAssessments, recentViews] = await Promise.all([
        prisma.assessment.findMany({
          where: { classId },
          include: {
            _count: { select: { submissions: true } },
            submissions: {
              where: { studentId: session.user.id },
              select: {
                id: true, status: true, score: true,
                maxScore: true, createdAt: true, gradedAt: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
        viewsPromise,
      ]);

      const viewedIds = new Set(recentViews.map((v) => v.assessmentId));
      assessments = studentAssessments.map((a: any) => ({
        ...a,
        isNew: new Date(a.createdAt) > sevenDaysAgo && !viewedIds.has(a.id),
      }));
    }

    const payload = {
      class: {
        ...classData,
        viewerRole,
        viewerCanManage,
        viewerCanViewTeacherData,
        viewerCanInteractWithStream,
        assessments,
      },
    };

    setClassDetailCache(cacheKey, payload);

    const etag = generateETag(payload);
    const notModified = checkNotModified(request, etag);
    if (notModified) return notModified;
    return jsonWithETag(payload, etag, { "X-Data-Cache": "MISS" });
  } catch (error) {
    console.error("Error fetching class:", error);
    return NextResponse.json(
      { error: "Failed to fetch class" },
      { status: 500 }
    );
  }
}

export async function PATCH(
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
      select: { id: true, teacherId: true, schoolId: true },
    });

    if (!classData) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    // Class owner, co-teacher, or school director can update the class
    const isClassDirector = await isDirectorOfSchool(session.user.id, classData.schoolId);
    const hasClassAccess = await isUserClassTeacher(session.user.id, classId);
    if (!hasClassAccess && !isClassDirector) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, description, subject, archived, headerColor, bannerStyle, classAvatar } = body;

    const updateData: {
      name?: string;
      description?: string;
      subject?: string;
      archived?: boolean;
      headerColor?: string;
      bannerStyle?: string;
      classAvatar?: string | null;
    } = {};

    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (subject !== undefined) updateData.subject = subject;
    if (archived !== undefined) updateData.archived = archived;
    if (headerColor !== undefined) updateData.headerColor = headerColor;
    if (bannerStyle !== undefined) updateData.bannerStyle = bannerStyle;
    if (classAvatar !== undefined) updateData.classAvatar = classAvatar;

    const updatedClass = await prisma.class.update({
      where: { id: classId },
      data: updateData,
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        subject: true,
        headerColor: true,
        bannerStyle: true,
        classAvatar: true,
        createdAt: true,
        updatedAt: true,
        teacherId: true,
      },
    });

    invalidateClassDetailCache(classId);
    invalidateClassDetailGeneralCache(classId);
    invalidateGeneralCache(`classes:${classData.teacherId}`);

    return NextResponse.json({ class: updatedClass });
  } catch (error) {
    console.error("Error updating class:", error);
    return NextResponse.json(
      { error: "Failed to update class" },
      { status: 500 }
    );
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
      select: { id: true, teacherId: true, schoolId: true },
    });

    if (!classData) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    // Class owner or school director can delete the class
    const isClassDirector = await isDirectorOfSchool(session.user.id, classData.schoolId);

    // In maktab mode, only directors can delete classes
    if (isMaktab() && !isClassDirector) {
      return NextResponse.json({ error: "Only directors can delete classes in maktab mode" }, { status: 403 });
    }

    const hasDeleteAccess = await isUserClassTeacher(session.user.id, classId);
    if (!hasDeleteAccess && !isClassDirector) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await prisma.class.delete({
      where: { id: classId },
    });

    invalidateClassDetailCache(classId);
    invalidateClassDetailGeneralCache(classId);
    invalidateGeneralCache(`classes:${classData.teacherId}`);

    return NextResponse.json({ message: "Class deleted successfully" });
  } catch (error) {
    console.error("Error deleting class:", error);
    return NextResponse.json(
      { error: "Failed to delete class" },
      { status: 500 }
    );
  }
}
