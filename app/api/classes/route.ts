import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { generateClassCode } from "@/lib/utils";
import { getRandomBannerId } from "@/lib/class-banners";
import { enrollSchoolStudentsInClass } from "@/lib/school-utils";
import { isMaktab } from "@/lib/platform";
import { invalidateGeneralCache } from "@/lib/server-cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";

const createClassSchema = z.object({
  name: z.string().min(2, "Class name must be at least 2 characters"),
  description: z.string().optional(),
  subject: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "50");
    const archivedParam = searchParams.get("archived");
    const archived = archivedParam === "true";

    const classSelect = {
      id: true,
      name: true,
      code: true,
      subject: true,
      description: true,
      headerColor: true,
      bannerStyle: true,
      classAvatar: true,
      createdAt: true,
      updatedAt: true,
      teacherId: true,
      _count: {
        select: {
          enrollments: true,
          assessments: true,
        },
      },
      assessments: {
        where: {
          status: "ACTIVE" as const,
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
        },
        orderBy: { createdAt: "desc" as const },
        take: 5,
      },
    };

    // Maktab: directors see all school classes; bahola: everyone sees own classes
    let isDirectorView = false;
    let directorSchoolId: string | null = null;
    if (isMaktab()) {
      const currentUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { role: true, schoolId: true },
      });
      if (currentUser?.role === "DIRECTOR" && currentUser.schoolId) {
        isDirectorView = true;
        directorSchoolId = currentUser.schoolId;
      }
    }

    let teachingClasses: any[] = [];
    try {
      const whereClause = isDirectorView
        ? { schoolId: directorSchoolId, archived: archived }
        : { teacherId: session.user.id, archived: archived };

      teachingClasses = await prisma.class.findMany({
        where: whereClause,
        select: classSelect,
        orderBy: { createdAt: "desc" },
        take: limit,
      });
    } catch (error) {
      const isSchemaMismatch =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2021" || error.code === "P2022");

      if (!isSchemaMismatch) throw error;

      // Fallback for older databases that don't have classes.archived.
      const whereClauseFallback = isDirectorView
        ? { schoolId: directorSchoolId }
        : { teacherId: session.user.id };

      teachingClasses = await prisma.class.findMany({
        where: whereClauseFallback,
        select: classSelect,
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      if (archived) {
        teachingClasses = [];
      }
    }

    // For archived endpoint, return array directly
    if (archivedParam !== null) {
      return NextResponse.json(teachingClasses, {
        headers: {
          'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
        },
      });
    }

    // Return teaching classes (classes user created)
    return NextResponse.json({ classes: teachingClasses }, {
      headers: {
        'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error("Error fetching classes:", error);
    return NextResponse.json(
      { error: "Failed to fetch classes" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Look up creator for school auto-enrollment and role check
    const creator = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true, schoolId: true },
    });

    // Maktab: only directors can create classes
    if (isMaktab() && creator?.role !== "DIRECTOR") {
      return NextResponse.json(
        { error: "Only directors can create classes" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validatedData = createClassSchema.parse(body);

    // Generate unique class code
    let code = generateClassCode();
    let existingClass = await prisma.class.findUnique({
      where: { code },
      select: { id: true }
    });

    while (existingClass) {
      code = generateClassCode();
      existingClass = await prisma.class.findUnique({
        where: { code },
        select: { id: true }
      });
    }

    // Only directors can assign a different teacher; default to self
    let assignedTeacherId = session.user.id;
    if (body.teacherId && body.teacherId !== session.user.id) {
      const requestingUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { role: true },
      });
      if (requestingUser?.role === "DIRECTOR") {
        assignedTeacherId = body.teacherId;
      }
      // Non-directors silently get themselves as teacher (no error, just ignore the param)
    }

    const newClass = await prisma.class.create({
      data: {
        name: validatedData.name,
        description: validatedData.description,
        subject: validatedData.subject,
        code,
        teacherId: assignedTeacherId,
        bannerStyle: getRandomBannerId(),
        ...(creator?.schoolId ? { schoolId: creator.schoolId } : {}),
      },
      select: {
        id: true,
        name: true,
        description: true,
        subject: true,
        code: true,
        teacherId: true,
        headerColor: true,
        bannerStyle: true,
        classAvatar: true,
        createdAt: true,
        updatedAt: true,
        schoolId: true,
      },
    });

    // Invalidate server-side class caches so the new class appears immediately
    invalidateGeneralCache(`classes:${session.user.id}`);
    invalidateGeneralCache(`sidebar-classes:${session.user.id}`);

    // Auto-enroll all school students into new class
    if (creator?.schoolId) {
      enrollSchoolStudentsInClass(newClass.id, creator.schoolId).catch(() => {});
    }

    return NextResponse.json(
      { message: "Class created successfully", class: newClass },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      );
    }

    console.error("Error creating class:", error);
    return NextResponse.json(
      { error: "Failed to create class" },
      { status: 500 }
    );
  }
}
