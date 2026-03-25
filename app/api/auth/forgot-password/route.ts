import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import crypto from "crypto";
import { z } from "zod";
import { sendLoginCode } from "@/lib/email";
import { consumeRateLimit } from "@/lib/rate-limit";

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const FORGOT_IP_WINDOW_MS = 15 * 60 * 1000;
const FORGOT_EMAIL_WINDOW_MS = 15 * 60 * 1000;
const FORGOT_IP_LIMIT = Number(process.env.FORGOT_PASSWORD_IP_LIMIT ?? 30);
const FORGOT_EMAIL_LIMIT = Number(process.env.FORGOT_PASSWORD_EMAIL_LIMIT ?? 5);

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || "unknown";
}

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const ipRate = consumeRateLimit(
      `forgot-password:ip:${ip}`,
      FORGOT_IP_LIMIT,
      FORGOT_IP_WINDOW_MS
    );
    if (ipRate.limited) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(ipRate.retryAfterSeconds) },
        }
      );
    }

    const body = await request.json();
    const { email } = forgotPasswordSchema.parse(body);
    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findFirst({
      where: {
        email: {
          equals: normalizedEmail,
          mode: "insensitive",
        },
      },
      select: { id: true, email: true },
    });

    // Always return success to prevent email enumeration
    const successResponse = NextResponse.json({
      message: "If an account with that email exists, a login code has been sent.",
    });

    const emailRate = consumeRateLimit(
      `forgot-password:email:${normalizedEmail}`,
      FORGOT_EMAIL_LIMIT,
      FORGOT_EMAIL_WINDOW_MS
    );
    if (emailRate.limited) {
      return successResponse;
    }

    // No user found — still return success (security: no email enumeration)
    if (!user || !user.email) {
      return successResponse;
    }

    // Generate a 6-digit code (easy to type on mobile)
    const code = crypto.randomInt(100000, 1_000_000).toString();

    // Hash the code before storing (so DB leak doesn't expose codes)
    const hashedCode = crypto
      .createHash("sha256")
      .update(`${normalizedEmail}:${code}`)
      .digest("hex");

    // Store hashed code with 15-minute expiry
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: hashedCode,
        passwordResetExpires: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    // Also upsert into PasswordResetToken table for compatibility
    await prisma.passwordResetToken.upsert({
      where: { email: normalizedEmail },
      update: {
        token: hashedCode,
        expires: new Date(Date.now() + 15 * 60 * 1000),
      },
      create: {
        id: crypto.randomUUID(),
        email: normalizedEmail,
        token: hashedCode,
        expires: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    // Send the code via email
    await sendLoginCode(user.email, code);

    return successResponse;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      );
    }

    console.error("Forgot password error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
