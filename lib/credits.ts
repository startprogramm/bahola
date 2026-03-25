import prisma from "@/lib/prisma";

/**
 * Check if a user has enough credits
 * PRO/MAX users always have credits (unlimited)
 */
export async function hasCredits(userId: string, amount: number = 1): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { credits: true, subscription: true, subscriptionExpiresAt: true },
  });
  if (!user) return false;
  // PRO and MAX have unlimited credits, but check if subscription has expired
  if (user.subscription === "PRO" || user.subscription === "MAX") {
    if (user.subscriptionExpiresAt && user.subscriptionExpiresAt < new Date()) {
      // Subscription expired — treat as FREE (cron will downgrade soon)
      return user.credits >= amount;
    }
    return true;
  }
  return user.credits >= amount;
}

/**
 * Deduct credits from a user and log the transaction
 * PRO/MAX users are not deducted (unlimited)
 * Returns true if successful, false if insufficient credits
 */
export async function deductCredit(
  userId: string,
  description: string = "Grading submission",
  amount: number = 1
): Promise<{ success: boolean; remainingCredits: number }> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, remainingCredits: 0 };
  }

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { credits: true, subscription: true, subscriptionExpiresAt: true },
    });

    if (!user) return { success: false, remainingCredits: 0 };

    // PRO and MAX have unlimited credits - log but don't deduct (unless expired)
    const isExpired = user.subscriptionExpiresAt && user.subscriptionExpiresAt < new Date();
    if ((user.subscription === "PRO" || user.subscription === "MAX") && !isExpired) {
      await tx.creditTransaction.create({
        data: {
          userId,
          amount: 0,
          type: "USAGE",
          description: `${description} (unlimited plan)`,
          balanceAfter: user.credits,
        },
      });
      return { success: true, remainingCredits: user.credits };
    }

    // Atomic decrement guarded by current balance.
    const decremented = await tx.user.updateMany({
      where: {
        id: userId,
        credits: { gte: amount },
      },
      data: {
        credits: { decrement: amount },
      },
    });

    if (decremented.count === 0) {
      const latest = await tx.user.findUnique({
        where: { id: userId },
        select: { credits: true },
      });
      return {
        success: false,
        remainingCredits: latest?.credits ?? 0,
      };
    }

    const updated = await tx.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });
    const remainingCredits = updated?.credits ?? 0;

    await tx.creditTransaction.create({
      data: {
        userId,
        amount: -amount,
        type: "USAGE",
        description,
        balanceAfter: remainingCredits,
      },
    });

    return { success: true, remainingCredits };
  });
}

/**
 * Get user's current credits
 */
export async function getUserCredits(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { credits: true },
  });
  return user?.credits ?? 0;
}
