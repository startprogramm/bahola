import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { invalidateClassDetailCache, invalidateGeneralCache } from "@/lib/server-cache";

const joinClassSchema = z.object({
  code: z.string().length(6, "Class code must be 6 characters"),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    console.log("[JOIN] session:", session?.user?.id, session?.user?.email);

    if (!session) {
      console.log("[JOIN] No session - returning 401");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    console.log("[JOIN] body:", JSON.stringify(body));
    const validatedData = joinClassSchema.parse(body);

    // Find the class by code
    const classToJoin = await prisma.class.findUnique({
      where: { code: validatedData.code },
      select: {
        id: true,
        name: true,
        teacherId: true,
        teacher: {
          select: { name: true },
        },
      },
    });

    if (!classToJoin) {
      return NextResponse.json(
        { error: "Class not found. Please check the code and try again." },
        { status: 404 }
      );
    }

    // Resolve the actual DB user — handle stale JWT tokens gracefully
    let userId = session.user.id;
    console.log("[JOIN] userId from session:", userId, "email:", session.user.email);
    let userExists = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    console.log("[JOIN] userExists by ID:", !!userExists);

    // If user not found by ID, try by email (handles stale JWT tokens from Google OAuth)
    if (!userExists && session.user.email) {
      const userByEmail = await prisma.user.findFirst({
        where: { email: { equals: session.user.email, mode: "insensitive" } },
        select: { id: true },
      });
      console.log("[JOIN] userByEmail:", userByEmail?.id);
      if (userByEmail) {
        userId = userByEmail.id;
        userExists = userByEmail;
      }
    }

    if (!userExists) {
      console.log("[JOIN] User not found - returning 403");
      return NextResponse.json(
        { error: "Your account was not found. Please log out and log back in." },
        { status: 403 }
      );
    }

    // Cannot join your own class as a student
    if (classToJoin.teacherId === userId) {
      return NextResponse.json(
        { error: "You cannot join your own class" },
        { status: 400 }
      );
    }

    // Check if user is already enrolled
    const existingEnrollment = await prisma.enrollment.findUnique({
      where: {
        studentId_classId: {
          studentId: userId,
          classId: classToJoin.id,
        },
      },
    });

    if (existingEnrollment) {
      console.log("[JOIN] Already enrolled - returning 400");
      return NextResponse.json(
        { error: "You are already enrolled in this class" },
        { status: 400 }
      );
    }

    // Create enrollment
    await prisma.enrollment.create({
      data: {
        studentId: userId,
        classId: classToJoin.id,
      },
    });

    invalidateClassDetailCache(classToJoin.id);
    invalidateGeneralCache(`classes:${userId}`);
    invalidateGeneralCache(`sidebar-classes:${userId}`);

    return NextResponse.json({
      message: "Joined class successfully",
      class: {
        id: classToJoin.id,
        name: classToJoin.name,
        teacher: classToJoin.teacher.name,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      );
    }

    console.error("Error joining class:", error);
    return NextResponse.json(
      { error: "Failed to join class" },
      { status: 500 }
    );
  }
}
