import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getCurrentPlanLevel } from "@/lib/purchase-hierarchy";
import ShopClient from "./shop-client";

export default async function ShopPage() {
  const session = await getAuthSession();
  if (!session?.user?.id) redirect("/login");

  let user = null as {
    subscription: "FREE" | "PLUS" | "PRO" | "MAX";
    credits: number;
    subscriptionExpiresAt: Date | null;
  } | null;
  let latestCompletedOrderAmount: number | null = null;

  try {
    const [fetchedUser, latestCompletedOrder] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: {
          subscription: true,
          credits: true,
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
    user = fetchedUser;
    latestCompletedOrderAmount = latestCompletedOrder?.amount ?? null;
  } catch (error) {
    const isSchemaMismatch =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2021" || error.code === "P2022");
    if (!isSchemaMismatch) throw error;
  }

  if (!user) redirect("/login");

  const currentPlanLevel = getCurrentPlanLevel({
    subscription: user.subscription,
    subscriptionExpiresAt: user.subscriptionExpiresAt,
    latestCompletedOrderAmount,
  });

  const initialData = JSON.parse(JSON.stringify({
    subscription: user.subscription,
    credits: user.credits,
    subscriptionExpiresAt: user.subscriptionExpiresAt,
    currentPlanLevel,
  }));

  return <ShopClient initialData={initialData} />;
}
