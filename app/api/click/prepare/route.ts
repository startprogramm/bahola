import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyPrepareSign, CLICK_ERRORS } from "@/lib/click";

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
      amount,
      action,
      sign_time,
      sign_string,
      error: clickError,
    } = body;

    // Verify signature
    if (
      !verifyPrepareSign({
        click_trans_id: String(click_trans_id),
        merchant_trans_id: String(merchant_trans_id),
        amount: String(amount),
        action: String(action),
        sign_time: String(sign_time),
        sign_string: String(sign_string),
      })
    ) {
      return NextResponse.json({
        click_trans_id,
        merchant_trans_id,
        merchant_prepare_id: 0,
        error: CLICK_ERRORS.SIGN_CHECK_FAILED,
        error_note: "Sign check failed",
      });
    }

    // If Click sent an error, cancel the order
    if (Number(clickError) < 0) {
      await prisma.order.updateMany({
        where: { numericId: Number(merchant_trans_id), status: "PENDING" },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      return NextResponse.json({
        click_trans_id,
        merchant_trans_id,
        merchant_prepare_id: 0,
        error: CLICK_ERRORS.TRANSACTION_CANCELLED,
        error_note: "Transaction cancelled by Click",
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
        merchant_prepare_id: 0,
        error: CLICK_ERRORS.TRANSACTION_NOT_FOUND,
        error_note: "Order not found",
      });
    }

    if (order.status === "CANCELLED") {
      return NextResponse.json({
        click_trans_id,
        merchant_trans_id,
        merchant_prepare_id: 0,
        error: CLICK_ERRORS.TRANSACTION_CANCELLED,
        error_note: "Order already cancelled",
      });
    }

    if (order.status === "COMPLETED") {
      return NextResponse.json({
        click_trans_id,
        merchant_trans_id,
        merchant_prepare_id: order.numericId,
        error: CLICK_ERRORS.ALREADY_PAID,
        error_note: "Already paid",
      });
    }

    // Verify amount
    if (Math.abs(Number(amount) - order.amount) > 1) {
      return NextResponse.json({
        click_trans_id,
        merchant_trans_id,
        merchant_prepare_id: 0,
        error: CLICK_ERRORS.INCORRECT_AMOUNT,
        error_note: "Incorrect amount",
      });
    }

    // Update order to PREPARING
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: "PREPARING",
        clickTransId: String(click_trans_id),
        preparedAt: new Date(),
      },
    });

    return NextResponse.json({
      click_trans_id,
      merchant_trans_id,
      merchant_prepare_id: updated.numericId,
      error: CLICK_ERRORS.SUCCESS,
      error_note: "Success",
    });
  } catch (error) {
    console.error("Click prepare error:", error);
    return NextResponse.json({
      error: CLICK_ERRORS.ERROR_IN_REQUEST,
      error_note: "Internal server error",
    });
  }
}
