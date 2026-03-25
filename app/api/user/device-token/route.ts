import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { z } from "zod";

const deviceTokenSchema = z.object({
  token: z.string().min(1, "Token is required"),
  platform: z.enum(["android", "ios"], {
    errorMap: () => ({ message: "Platform must be 'android' or 'ios'" }),
  }),
});

/**
 * Register or update a device push token for the current user.
 * Mobile apps should call this after login and whenever the token refreshes.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { token, platform } = deviceTokenSchema.parse(body);

    // Upsert: if this user+token combo exists, update it; otherwise create
    const deviceToken = await prisma.deviceToken.upsert({
      where: {
        userId_token: {
          userId: session.user.id,
          token,
        },
      },
      update: {
        platform,
        updatedAt: new Date(),
      },
      create: {
        userId: session.user.id,
        token,
        platform,
      },
    });

    return NextResponse.json({
      message: "Device token registered",
      deviceToken: {
        id: deviceToken.id,
        platform: deviceToken.platform,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      );
    }

    console.error("Error registering device token:", error);
    return NextResponse.json(
      { error: "Failed to register device token" },
      { status: 500 }
    );
  }
}

/**
 * Remove a device token (e.g., on logout).
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getAuthSession();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { token } = z.object({ token: z.string().min(1) }).parse(body);

    await prisma.deviceToken
      .delete({
        where: {
          userId_token: {
            userId: session.user.id,
            token,
          },
        },
      })
      .catch(() => {
        // Token may not exist, that's fine
      });

    return NextResponse.json({ message: "Device token removed" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      );
    }

    console.error("Error removing device token:", error);
    return NextResponse.json(
      { error: "Failed to remove device token" },
      { status: 500 }
    );
  }
}
