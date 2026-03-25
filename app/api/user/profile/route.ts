import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";
import { getUserFileLimit, isReservedAdminEmail } from "@/lib/subscription";
import { isMaktab } from "@/lib/platform";

const updateProfileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
  email: z.string().email("Invalid email address").optional(),
});

export async function PATCH(request: NextRequest) {
  try {
    const session = await getAuthSession();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validatedData = updateProfileSchema.parse(body);
    const normalizedName = validatedData.name?.trim();
    const normalizedEmail = validatedData.email?.trim().toLowerCase();
    const currentSessionEmail = session.user.email?.trim().toLowerCase() ?? null;

    if (validatedData.name !== undefined) {
      if (!normalizedName || normalizedName.length < 2) {
        return NextResponse.json(
          { error: "Name must be at least 2 characters" },
          { status: 400 }
        );
      }
    }

    // Check if email is being changed and if it's already taken
    if (normalizedEmail && normalizedEmail !== currentSessionEmail) {
      if (isReservedAdminEmail(normalizedEmail)) {
        return NextResponse.json(
          { error: "This email address is reserved and cannot be used." },
          { status: 403 }
        );
      }

      const existingUser = await prisma.user.findFirst({
        where: {
          email: {
            equals: normalizedEmail,
            mode: "insensitive",
          },
        },
        select: { id: true },
      });
      if (existingUser) {
        return NextResponse.json(
          { error: "Email is already in use" },
          { status: 400 }
        );
      }
    }

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        ...(normalizedName && { name: normalizedName }),
        ...(normalizedEmail && { email: normalizedEmail }),
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      );
    }

    console.error("Error updating profile:", error);
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const session = await getAuthSession();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [user, fileLimit] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
          role: true,
          credits: true,
          createdAt: true,
          subscription: true,
          subscriptionExpiresAt: true,
        },
      }),
      getUserFileLimit(session.user.id),
    ]);

    return NextResponse.json({ user: { ...user, fileLimit } });
  } catch (error) {
    console.error("Error fetching profile:", error);
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    if (isMaktab()) {
      return NextResponse.json({ error: "Account deletion is not allowed in maktab mode" }, { status: 403 });
    }

    const session = await getAuthSession();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Delete all related data and the user account
    // Prisma will handle cascading deletes based on schema relations
    await prisma.user.delete({
      where: { id: session.user.id },
    });

    return NextResponse.json({ message: "Account deleted successfully" });
  } catch (error) {
    console.error("Error deleting account:", error);
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 }
    );
  }
}
