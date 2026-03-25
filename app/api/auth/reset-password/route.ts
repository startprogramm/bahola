import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";

const resetPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
  code: z.string().regex(/^\d{6}$/, "Reset code must be 6 digits"),
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, code, newPassword } = resetPasswordSchema.parse(body);
    const normalizedEmail = email.trim().toLowerCase();

    // Hash the provided code to compare with stored hash
    const hashedCode = crypto
      .createHash("sha256")
      .update(`${normalizedEmail}:${code}`)
      .digest("hex");

    const user = await prisma.user.findFirst({
      where: {
        email: {
          equals: normalizedEmail,
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        passwordResetToken: true,
        passwordResetExpires: true,
      },
    });

    if (!user || !user.passwordResetToken || !user.passwordResetExpires) {
      return NextResponse.json(
        { error: "Invalid or expired reset code" },
        { status: 400 }
      );
    }

    // Check expiry
    if (new Date() > user.passwordResetExpires) {
      // Clean up expired token
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: null,
          passwordResetExpires: null,
        },
      });

      return NextResponse.json(
        { error: "Reset code has expired. Please request a new one." },
        { status: 400 }
      );
    }

    // Constant-time comparison to prevent timing attacks
    const providedCodeBuffer = Buffer.from(hashedCode, "utf8");
    const storedCodeBuffer = Buffer.from(user.passwordResetToken, "utf8");
    const isValidCode =
      providedCodeBuffer.length === storedCodeBuffer.length &&
      crypto.timingSafeEqual(providedCodeBuffer, storedCodeBuffer);

    if (!isValidCode) {
      return NextResponse.json(
        { error: "Invalid or expired reset code" },
        { status: 400 }
      );
    }

    // Hash new password and update
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });

    // Clean up PasswordResetToken table
    await prisma.passwordResetToken
      .delete({ where: { email: normalizedEmail } })
      .catch(() => {});

    return NextResponse.json({
      message: "Password reset successfully. You can now log in.",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      );
    }

    console.error("Reset password error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
