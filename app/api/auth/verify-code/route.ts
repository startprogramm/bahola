import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import crypto from "crypto";
import { z } from "zod";
import { consumeRateLimit } from "@/lib/rate-limit";

const verifyCodeSchema = z.object({
  email: z.string().email("Invalid email address"),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits"),
});

const VERIFY_IP_WINDOW_MS = 15 * 60 * 1000;
const VERIFY_EMAIL_WINDOW_MS = 15 * 60 * 1000;
const VERIFY_IP_LIMIT = Number(process.env.VERIFY_CODE_IP_LIMIT ?? 40);
const VERIFY_EMAIL_LIMIT = Number(process.env.VERIFY_CODE_EMAIL_LIMIT ?? 10);

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || "unknown";
}

/**
 * Verifies a one-time login code sent via email.
 * Returns a one-time auto-login token that the client can use
 * with the "auto-login" NextAuth credentials provider.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const body = await request.json();
    const { email, code } = verifyCodeSchema.parse(body);
    const normalizedEmail = email.trim().toLowerCase();

    const ipRate = consumeRateLimit(
      `verify-code:ip:${ip}`,
      VERIFY_IP_LIMIT,
      VERIFY_IP_WINDOW_MS
    );
    if (ipRate.limited) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(ipRate.retryAfterSeconds) },
        }
      );
    }

    const emailRate = consumeRateLimit(
      `verify-code:email:${normalizedEmail}`,
      VERIFY_EMAIL_LIMIT,
      VERIFY_EMAIL_WINDOW_MS
    );
    if (emailRate.limited) {
      return NextResponse.json(
        { error: "Too many attempts. Please request a new code later." },
        {
          status: 429,
          headers: { "Retry-After": String(emailRate.retryAfterSeconds) },
        }
      );
    }

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
        { error: "Invalid or expired code" },
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
        { error: "Code has expired. Please request a new one." },
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
        { error: "Invalid or expired code" },
        { status: 400 }
      );
    }

    // Code is valid — generate a one-time auto-login token
    const autoLoginToken = crypto.randomBytes(32).toString("hex");
    const hashedAutoLoginToken = crypto
      .createHash("sha256")
      .update(autoLoginToken)
      .digest("hex");
    const autoLoginExpires = new Date(Date.now() + 10 * 60 * 1000);

    // Clear the reset code and set the auto-login token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: null,
        passwordResetExpires: autoLoginExpires,
        verificationToken: hashedAutoLoginToken,
      },
    });

    // Clean up PasswordResetToken table
    await prisma.passwordResetToken
      .delete({ where: { email: normalizedEmail } })
      .catch(() => {});

    return NextResponse.json({
      userId: user.id,
      token: autoLoginToken,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      );
    }

    console.error("Verify code error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
