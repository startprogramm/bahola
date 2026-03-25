import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdminUser } from "@/lib/subscription";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getAuthSession();
  if (!session?.user || !isAdminUser(session.user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { userId } = await params;
    const { amount } = await request.json();
    
    if (typeof amount !== "number" || isNaN(amount)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { credits: { increment: amount } },
    });

    return NextResponse.json({ success: true, newCredits: user.credits });
  } catch (error) {
    console.error("Failed to add credits:", error);
    return NextResponse.json({ error: "Failed to add credits" }, { status: 500 });
  }
}
