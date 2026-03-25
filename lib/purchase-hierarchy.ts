export type BillingCycle = "monthly" | "annual";
export type PurchasablePlan = "PLUS" | "PRO";
export type PlanLevel =
  | "FREE"
  | "PLUS_MONTHLY"
  | "PLUS_ANNUAL"
  | "PRO_MONTHLY"
  | "PRO_ANNUAL";

export const PLAN_PRICES: Record<PurchasablePlan, Record<BillingCycle, number>> = {
  PLUS: { monthly: 29000, annual: 228000 },
  PRO: { monthly: 99000, annual: 588000 },
};

const LEVEL_RANK: Record<PlanLevel, number> = {
  FREE: 0,
  PLUS_MONTHLY: 1,
  PLUS_ANNUAL: 2,
  PRO_MONTHLY: 3,
  PRO_ANNUAL: 4,
};

const AMOUNT_TO_LEVEL: Record<number, PlanLevel> = {
  [PLAN_PRICES.PLUS.monthly]: "PLUS_MONTHLY",
  [PLAN_PRICES.PLUS.annual]: "PLUS_ANNUAL",
  [PLAN_PRICES.PRO.monthly]: "PRO_MONTHLY",
  [PLAN_PRICES.PRO.annual]: "PRO_ANNUAL",
};

function isValidDate(value: Date | string | null | undefined): value is Date | string {
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime());
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function isPlanLevelForSubscription(level: PlanLevel, subscription: string): boolean {
  if (subscription === "PLUS") return level === "PLUS_MONTHLY" || level === "PLUS_ANNUAL";
  if (subscription === "PRO" || subscription === "MAX") return level === "PRO_MONTHLY" || level === "PRO_ANNUAL";
  return level === "FREE";
}

export function getPlanLevelRank(level: PlanLevel): number {
  return LEVEL_RANK[level];
}

export function getRequestedPlanLevel(plan: string, billing: string): PlanLevel | null {
  if (plan !== "PLUS" && plan !== "PRO") return null;
  if (billing !== "monthly" && billing !== "annual") return null;
  if (plan === "PLUS" && billing === "monthly") return "PLUS_MONTHLY";
  if (plan === "PLUS" && billing === "annual") return "PLUS_ANNUAL";
  if (plan === "PRO" && billing === "monthly") return "PRO_MONTHLY";
  return "PRO_ANNUAL";
}

export function getFallbackLevelFromSubscription(subscription: string): PlanLevel {
  if (subscription === "PLUS") return "PLUS_MONTHLY";
  if (subscription === "PRO") return "PRO_MONTHLY";
  if (subscription === "MAX") return "PRO_ANNUAL";
  return "FREE";
}

export function getCurrentPlanLevel(args: {
  subscription: string;
  subscriptionExpiresAt: Date | string | null | undefined;
  latestCompletedOrderAmount?: number | null;
  now?: Date;
}): PlanLevel {
  const now = args.now ?? new Date();
  const fallbackLevel = getFallbackLevelFromSubscription(args.subscription);

  if (args.subscription === "FREE") return "FREE";
  if (
    isValidDate(args.subscriptionExpiresAt) &&
    toDate(args.subscriptionExpiresAt).getTime() <= now.getTime()
  ) {
    return "FREE";
  }

  if (typeof args.latestCompletedOrderAmount === "number") {
    const level = AMOUNT_TO_LEVEL[args.latestCompletedOrderAmount];
    if (level && isPlanLevelForSubscription(level, args.subscription)) {
      return level;
    }
  }

  return fallbackLevel;
}

export function getSubscriptionDurationDaysForAmount(amount: number): number {
  if (amount === PLAN_PRICES.PLUS.annual || amount === PLAN_PRICES.PRO.annual) {
    return 365;
  }
  return 30;
}
