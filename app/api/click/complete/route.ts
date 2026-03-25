import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyCompleteSign, CLICK_ERRORS } from "@/lib/click";
import { PLAN_DETAILS } from "@/lib/subscription";
import { getSubscriptionDurationDaysForAmount } from "@/lib/purchase-hierarchy";

async function parseBody(request: NextRequest): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return await request.json();
  }
  const formData = await request.formData();
  const obj: Record<string, string> = {};
  formData.forEach((value, key) => { obj[key] = String(value); });
  return obj;
}

export async function GET() {
  return NextResponse.json({ status: "ok" });
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody(request);

    const {
      click_trans_id,
      service_id,
      merchant_trans_id,
      merchant_prepare_id,
      amount,
      action,
      sign_time,
      sign_string,
      error: clickError,
    } = body;

    // Verify signature
    if (
      !verifyCompleteSign({
        click_trans_id: String(click_trans_id),
        merchant_trans_id: String(merchant_trans_id),
        merchant_prepare_id: String(merchant_prepare_id),
        amount: String(amount),
        action: String(action),
        sign_time: String(sign_time),
        sign_string: String(sign_string),
      })
    ) {
      return NextResponse.json({
        click_trans_id,
        merchant_trans_id,
        merchant_confirm_id: merchant_prepare_id,
        error: CLICK_ERRORS.SIGN_CHECK_FAILED,
        error_note: "Sign check failed",
      });
    }

    // Find order
    const order = await prisma.order.findUnique({
      where: { numericId: Number(merchant_trans_id) },
    });

    if (!order) {
      return NextResponse.json({
        click_trans_id,
        merchant_trans_id,
        merchant_confirm_id: merchant_prepare_id,
        error: CLICK_ERRORS.TRANSACTION_NOT_FOUND,
        error_note: "Order not found",
      });
    }

    if (order.status === "COMPLETED") {
      return NextResponse.json({
        click_trans_id,
        merchant_trans_id,
        merchant_confirm_id: order.numericId,
        error: CLICK_ERRORS.ALREADY_PAID,
        error_note: "Already paid",
      });
    }

    if (order.status === "CANCELLED") {
      return NextResponse.json({
        click_trans_id,
        merchant_trans_id,
        merchant_confirm_id: merchant_prepare_id,
        error: CLICK_ERRORS.TRANSACTION_CANCELLED,
        error_note: "Order cancelled",
      });
    }

    // If Click reports an error, cancel the order
    if (Number(clickError) < 0) {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      return NextResponse.json({
        click_trans_id,
        merchant_trans_id,
        merchant_confirm_id: merchant_prepare_id,
        error: CLICK_ERRORS.TRANSACTION_CANCELLED,
        error_note: "Transaction cancelled by Click",
      });
    }

    // Verify amount
    if (Math.abs(Number(amount) - order.amount) > 1) {
      return NextResponse.json({
        click_trans_id,
        merchant_trans_id,
        merchant_confirm_id: merchant_prepare_id,
        error: CLICK_ERRORS.INCORRECT_AMOUNT,
        error_note: "Incorrect amount",
      });
    }

    // Grant plan + credits in a transaction
    const planDetails = PLAN_DETAILS[order.plan as keyof typeof PLAN_DETAILS];
    const credits = planDetails.credits;
    const durationDays = getSubscriptionDurationDaysForAmount(order.amount);
    const subscriptionExpiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    await prisma.$transaction([
      prisma.order.update({
        where: { id: order.id },
        data: {
          status: "COMPLETED",
          clickTransId: String(click_trans_id),
          clickPaydocId: body.click_paydoc_id ? String(body.click_paydoc_id) : null,
          completedAt: new Date(),
        },
      }),
      prisma.user.update({
        where: { id: order.userId },
        data: {
          subscription: order.plan,
          credits,
          subscriptionExpiresAt,
        },
      }),
      prisma.creditTransaction.create({
        data: {
          userId: order.userId,
          amount: credits,
          balanceAfter: credits,
          type: "PURCHASE",
          description: `Click payment - ${order.plan} plan`,
        },
      }),
    ]);

    return NextResponse.json({
      click_trans_id,
      merchant_trans_id,
      merchant_confirm_id: order.numericId,
      error: CLICK_ERRORS.SUCCESS,
      error_note: "Success",
    });
  } catch (error) {
    console.error("Click complete error:", error);
    return NextResponse.json({
      error: CLICK_ERRORS.ERROR_IN_REQUEST,
      error_note: "Internal server error",
    });
  }
}
