import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAdminUser } from "@/lib/subscription";

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user || !isAdminUser(session.user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        subscription: true,
        credits: true,
        subscriptionExpiresAt: true,
        createdAt: true,
        _count: { select: { submissions: true, orders: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const usersWithPlan = users.map(user => ({
      ...user,
      plan: user.subscription,
    }));
    return NextResponse.json(usersWithPlan);
  } catch (error) {
    console.error("Failed to fetch users:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}
