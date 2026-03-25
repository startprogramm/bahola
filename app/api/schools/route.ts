import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { generateSchoolCode } from "@/lib/school-utils";
import { z } from "zod";
import { generateETag, checkNotModified, jsonWithETag } from "@/lib/etag";
import { getSchoolCache, setSchoolCache, invalidateSchoolServerCache } from "@/lib/server-cache";

const createSchoolSchema = z.object({
  name: z.string().min(2, "School name must be at least 2 characters"),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const data = createSchoolSchema.parse(body);

    const code = await generateSchoolCode();

    // Create school and set current user as director in one transaction
    const result = await prisma.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: {
          name: data.name,
          code,
          address: data.address || null,
          phone: data.phone || null,
          email: data.email || null,
          directorId: session.user.id,
        },
      });

      // Update user to be director of this school
      await tx.user.update({
        where: { id: session.user.id },
        data: { role: "DIRECTOR", schoolId: school.id },
      });

      // Create membership record
      await tx.schoolMembership.create({
        data: {
          userId: session.user.id,
          schoolId: school.id,
          role: "DIRECTOR",
          status: "active",
        },
      });

      return school;
    });

    invalidateSchoolServerCache(session.user.id);
    return NextResponse.json({ school: result }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
    }
    console.error("Create school error:", error);
    return NextResponse.json({ error: "Failed to create school" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Check server-side cache
    const cached = getSchoolCache(session.user.id);
    if (cached) {
      const etag = generateETag(cached);
      const notModified = checkNotModified(request, etag);
      if (notModified) return notModified;
      return jsonWithETag(cached, etag, { Vary: "Cookie" });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { schoolId: true, role: true },
    });

    if (!user?.schoolId) {
      const data = { school: null };
      setSchoolCache(session.user.id, data);
      return NextResponse.json(data);
    }

    const [school, studentCount] = await Promise.all([
      prisma.school.findUnique({
        where: { id: user.schoolId },
        select: {
          id: true,
          name: true,
          code: true,
          address: true,
          phone: true,
          email: true,
          isActive: true,
          directorId: true,
          createdAt: true,
          director: { select: { id: true, name: true, email: true } },
          _count: {
            select: {
              members: { where: { role: "TEACHER" } },
              classes: { where: { archived: false } },
            },
          },
        },
      }),
      prisma.schoolMembership.count({
        where: { schoolId: user.schoolId!, role: "STUDENT", status: "active" },
      }),
    ]);

    const data = { school, userRole: user.role, studentCount };
    setSchoolCache(session.user.id, data);

    const etag = generateETag(data);
    const notModified = checkNotModified(request, etag);
    if (notModified) return notModified;
    return jsonWithETag(data, etag, { Vary: "Cookie" });
  } catch (error) {
    console.error("Get school error:", error);
    return NextResponse.json({ error: "Failed to fetch school" }, { status: 500 });
  }
}
