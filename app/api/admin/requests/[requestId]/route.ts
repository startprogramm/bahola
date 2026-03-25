import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdminUser, PLAN_DETAILS } from "@/lib/subscription";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const session = await getAuthSession();
  if (!session?.user || !isAdminUser(session.user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { requestId } = await params;
    const { approve, adminNotes } = await request.json();

    const subRequest = await prisma.subscriptionRequest.findUnique({
      where: { id: requestId },
    });

    if (!subRequest) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    if (subRequest.status !== "PENDING") {
      return NextResponse.json({ error: "Request already processed" }, { status: 400 });
    }

    if (approve) {
      const planDetails = PLAN_DETAILS[subRequest.requestedTier as keyof typeof PLAN_DETAILS];
      const credits = planDetails.credits;

      const subscriptionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

      await prisma.$transaction([
        prisma.subscriptionRequest.update({
          where: { id: requestId },
          data: { status: "APPROVED", reviewNote: adminNotes, reviewedAt: new Date() },
        }),
        prisma.user.update({
          where: { id: subRequest.userId },
          data: {
            subscription: subRequest.requestedTier,
            credits,
            subscriptionExpiresAt,
          },
        }),
      ]);
    } else {
      await prisma.subscriptionRequest.update({
        where: { id: requestId },
        data: { status: "REJECTED", reviewNote: adminNotes, reviewedAt: new Date() },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to process request:", error);
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
  }
}
