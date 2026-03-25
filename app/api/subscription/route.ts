import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { SubscriptionTier } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { PLAN_DETAILS } from "@/lib/subscription";
import { getCurrentPlanLevel } from "@/lib/purchase-hierarchy";
import { generateETag, checkNotModified, jsonWithETag } from "@/lib/etag";
import { getSubscriptionCache, setSubscriptionCache } from "@/lib/server-cache";

// GET - Get user subscription info
export async function GET(request: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check server-side cache first (avoids DB round-trip to Supabase)
    const cached = getSubscriptionCache(session.user.id);
    if (cached) {
      const etag = generateETag(cached);
      const notModified = checkNotModified(request, etag);
      if (notModified) return notModified;
      return jsonWithETag(cached, etag);
    }

    // Run user + order queries in parallel
    const [userResult, orderResult] = await Promise.allSettled([
      (async () => {
        try {
          return await prisma.user.findUnique({
            where: { id: session.user.id },
            select: {
              subscription: true,
              credits: true,
              subscriptionExpiresAt: true,
              subscriptionRequests: {
                where: { status: "PENDING" },
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { id: true },
              },
            },
          });
        } catch (error) {
          const isSchemaMismatch =
            error instanceof Prisma.PrismaClientKnownRequestError &&
            (error.code === "P2021" || error.code === "P2022");
          if (!isSchemaMismatch) throw error;
          return await prisma.user.findUnique({
            where: { id: session.user.id },
            select: {
              subscription: true,
              credits: true,
              subscriptionExpiresAt: true,
            },
          });
        }
      })(),
      (async () => {
        try {
          const latestCompletedOrder = await prisma.order.findFirst({
            where: { userId: session.user.id, status: "COMPLETED" },
            orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
            select: { amount: true },
          });
          return latestCompletedOrder?.amount ?? null;
        } catch (error) {
          const isSchemaMismatch =
            error instanceof Prisma.PrismaClientKnownRequestError &&
            (error.code === "P2021" || error.code === "P2022");
          if (!isSchemaMismatch) throw error;
          return null;
        }
      })(),
    ]);

    const user = userResult.status === "fulfilled" ? userResult.value as {
      subscription: "FREE" | "PLUS" | "PRO" | "MAX";
      credits: number;
      subscriptionExpiresAt: Date | null;
      subscriptionRequests?: Array<{ id: string }>;
    } | null : null;

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const latestCompletedOrderAmount: number | null =
      orderResult.status === "fulfilled" ? orderResult.value as number | null : null;

    const currentPlanLevel = getCurrentPlanLevel({
      subscription: user.subscription,
      subscriptionExpiresAt: user.subscriptionExpiresAt,
      latestCompletedOrderAmount,
    });

    // PRO/MAX users see unlimited credits (∞ on frontend)
    const isUnlimited = (user.subscription === "PRO" || user.subscription === "MAX") &&
      (!user.subscriptionExpiresAt || user.subscriptionExpiresAt >= new Date());

    const payload = {
      subscription: user.subscription,
      credits: isUnlimited ? -1 : user.credits,
      subscriptionExpiresAt: user.subscriptionExpiresAt,
      pendingRequest: user.subscriptionRequests?.[0] || null,
      planDetails: PLAN_DETAILS[user.subscription],
      currentPlanLevel,
    };

    // Cache the result server-side
    setSubscriptionCache(session.user.id, payload);

    const etag = generateETag(payload);
    const notModified = checkNotModified(request, etag);
    if (notModified) return notModified;
    return jsonWithETag(payload, etag);
  } catch (error) {
    console.error("Error fetching subscription:", error);
    return NextResponse.json({ error: "Failed to fetch subscription" }, { status: 500 });
  }
}

// POST - Request plan upgrade
export async function POST(request: NextRequest) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { plan } = await request.json();
    
    if (!plan || !Object.keys(PLAN_DETAILS).includes(plan)) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { subscription: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check if already on this plan
    if (user.subscription === plan) {
      return NextResponse.json({ error: "Already on this plan" }, { status: 400 });
    }

    // Check for existing pending request
    const existingRequest = await prisma.subscriptionRequest.findFirst({
      where: {
        userId: session.user.id,
        status: "PENDING",
      },
    });

    if (existingRequest) {
      return NextResponse.json(
        { error: "You already have a pending upgrade request" },
        { status: 400 }
      );
    }

    // Create the subscription request
    const subscriptionRequest = await prisma.subscriptionRequest.create({
      data: {
        userId: session.user.id,
        requestedTier: plan as SubscriptionTier,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Upgrade request submitted successfully",
      request: subscriptionRequest,
    });
  } catch (error) {
    console.error("Error creating subscription request:", error);
    return NextResponse.json({ error: "Failed to submit upgrade request" }, { status: 500 });
  }
}
