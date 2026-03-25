import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdminUser, PLAN_DETAILS } from "@/lib/subscription";
import type { SubscriptionTier } from "@prisma/client";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getAuthSession();
  if (!session?.user || !isAdminUser(session.user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { userId } = await params;
    const { plan } = await request.json();
    
    if (!plan || !Object.keys(PLAN_DETAILS).includes(plan)) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const planDetails = PLAN_DETAILS[plan as keyof typeof PLAN_DETAILS];
    const credits = planDetails.credits;

    // Set 30-day expiry for paid plans, clear for FREE
    const subscriptionExpiresAt = plan === "FREE"
      ? null
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        subscription: plan as SubscriptionTier,
        credits,
        subscriptionExpiresAt,
      },
    });

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error("Failed to update subscription:", error);
    return NextResponse.json({ error: "Failed to update plan" }, { status: 500 });
  }
}
