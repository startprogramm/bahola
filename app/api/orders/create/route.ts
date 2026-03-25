import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { buildClickPayUrl } from "@/lib/click";
import { SubscriptionTier } from "@prisma/client";
import {
  PLAN_PRICES,
  getCurrentPlanLevel,
  getPlanLevelRank,
  getRequestedPlanLevel,
} from "@/lib/purchase-hierarchy";

const TEST_MODE = false;
const TEST_AMOUNT = 1000;

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { plan, billing } = await request.json();

    const requestedLevel = getRequestedPlanLevel(String(plan), String(billing));
    if (!requestedLevel) {
      return NextResponse.json({ error: "Invalid plan or billing period" }, { status: 400 });
    }

    const [user, latestCompletedOrder] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: {
          subscription: true,
          subscriptionExpiresAt: true,
        },
      }),
      prisma.order.findFirst({
        where: {
          userId: session.user.id,
          status: "COMPLETED",
        },
        orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
        select: { amount: true },
      }),
    ]);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const currentLevel = getCurrentPlanLevel({
      subscription: user.subscription,
      subscriptionExpiresAt: user.subscriptionExpiresAt,
      latestCompletedOrderAmount: latestCompletedOrder?.amount ?? null,
    });

    if (getPlanLevelRank(requestedLevel) < getPlanLevelRank(currentLevel)) {
      return NextResponse.json(
        { error: "Cannot purchase a lower plan while a higher plan is active" },
        { status: 400 }
      );
    }

    const realPrice = PLAN_PRICES[plan as "PLUS" | "PRO"]?.[billing as "monthly" | "annual"];
    if (!realPrice) {
      return NextResponse.json({ error: "Invalid plan or billing period" }, { status: 400 });
    }
    const chargeAmount = TEST_MODE ? TEST_AMOUNT : realPrice;

    const order = await prisma.order.create({
      data: {
        userId: session.user.id,
        plan: plan as SubscriptionTier,
        amount: chargeAmount,
        status: "PENDING",
      },
    });

    const returnUrl = `${process.env.NEXTAUTH_URL}/shop/return?order_id=${order.id}`;
    const payUrl = buildClickPayUrl({
      orderId: String(order.numericId),
      amount: chargeAmount,
      returnUrl,
    });

    return NextResponse.json({ orderId: order.id, payUrl });
  } catch (error) {
    console.error("Failed to create order:", error);
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }
}
