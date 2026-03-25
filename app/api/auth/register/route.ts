import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { PLAN_DETAILS } from "@/lib/subscription";
import { getMaktabRegistrationBlockedError } from "@/lib/app-access";
import { isMaktab } from "@/lib/platform";
import { z } from "zod";

const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address").optional().or(z.literal("")),
  password: z.string().min(6, "Password must be at least 6 characters").optional().or(z.literal("")),
  language: z.enum(["en", "uz", "ru"]).optional(),
});

export async function POST(request: NextRequest) {
  try {
    if (isMaktab()) {
      const error = getMaktabRegistrationBlockedError();
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    const body = await request.json();

    // Validate input
    const validatedData = registerSchema.parse(body);

    // Clean up empty strings
    const email = validatedData.email?.trim().toLowerCase() || null;
    const password = validatedData.password?.trim() || null;

    // If email is provided, check for existing user
    if (email) {
      const existingUser = await prisma.user.findFirst({
        where: {
          email: {
            equals: email,
            mode: "insensitive",
          },
        },
      });

      if (existingUser) {
        return NextResponse.json(
          { error: "An account with this email already exists" },
          { status: 400 }
        );
      }
    }

    // Hash password if provided, otherwise generate a random one for security
    const rawPassword = password || crypto.randomBytes(16).toString("hex");
    const hashedPassword = await bcrypt.hash(rawPassword, 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        name: validatedData.name,
        email: email || undefined,
        password: hashedPassword,
        subscription: "FREE",
        credits: PLAN_DETAILS.FREE.credits,
        language: validatedData.language || "uz",
      },
      select: {
        id: true,
        name: true,
        email: true,
        credits: true,
      },
    });

    // Log signup credit transaction
    await prisma.creditTransaction.create({
      data: {
        userId: user.id,
        amount: PLAN_DETAILS.FREE.credits,
        type: "SIGNUP",
        description: "Free tier signup bonus",
        balanceAfter: PLAN_DETAILS.FREE.credits,
      },
    });

    // Generate a one-time auto-login token
    const autoLoginToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(autoLoginToken).digest("hex");
    const autoLoginExpires = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        verificationToken: hashedToken,
        passwordResetExpires: autoLoginExpires,
      },
    });

    return NextResponse.json(
      { message: "Account created successfully", user, autoLoginToken },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      );
    }

    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
