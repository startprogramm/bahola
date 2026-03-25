import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { PLAN_DETAILS } from "@/lib/subscription";

/**
 * Cron endpoint to downgrade expired subscriptions.
 *
 * When a PLUS/PRO/MAX subscription expires:
 * - Subscription tier is set to FREE
 * - Credits are set to remaining FREE plan credits (keep current if lower than 50)
 * - subscriptionExpiresAt is kept for historical reference
 *
 * Can be called via: curl -X POST http://localhost:3000/api/cron/expire-subscriptions
 * Should be scheduled to run daily via cron or a similar scheduler.
 */
export async function POST(request: NextRequest) {
  try {
    // Optional: verify a secret token for security
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();

    // Find all users with expired paid subscriptions
    const expiredUsers = await prisma.user.findMany({
      where: {
        subscription: { in: ["PLUS", "PRO", "MAX"] },
        subscriptionExpiresAt: {
          not: null,
          lt: now,
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        subscription: true,
        credits: true,
        subscriptionExpiresAt: true,
      },
    });

    if (expiredUsers.length === 0) {
      return NextResponse.json({ message: "No expired subscriptions found", count: 0 });
    }

    const freeCredits = PLAN_DETAILS.FREE.credits; // 50

    const results = [];

    for (const user of expiredUsers) {
      try {
        // Downgrade to FREE. For unlimited plans (credits = -1), give full free allotment.
        // For others, keep current credits if fewer than free allotment.
        const newCredits = user.credits < 0 ? freeCredits : Math.min(user.credits, freeCredits);

        await prisma.$transaction([
          prisma.user.update({
            where: { id: user.id },
            data: {
              subscription: "FREE",
              credits: newCredits < 0 ? 0 : newCredits, // Reset unlimited (-1) to 0
            },
          }),
          prisma.creditTransaction.create({
            data: {
              userId: user.id,
              amount: 0,
              type: "USAGE",
              description: `Subscription expired (was ${user.subscription}). Downgraded to FREE.`,
              balanceAfter: newCredits < 0 ? 0 : newCredits,
            },
          }),
        ]);

        results.push({
          userId: user.id,
          email: user.email,
          from: user.subscription,
          to: "FREE",
          expiredAt: user.subscriptionExpiresAt,
        });

        console.log(`Subscription expired: ${user.email} (${user.subscription} -> FREE)`);
      } catch (err) {
        console.error(`Failed to downgrade user ${user.id}:`, err);
        results.push({ userId: user.id, error: "Failed to downgrade" });
      }
    }

    return NextResponse.json({
      message: `Processed ${results.length} expired subscriptions`,
      count: results.length,
      results,
    });
  } catch (error) {
    console.error("Cron expire-subscriptions error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Allow GET for simple health/status check
export async function GET() {
  return NextResponse.json({ status: "ok", endpoint: "expire-subscriptions" });
}
