import prisma from "./prisma";
import { SubscriptionTier } from "@prisma/client";

export const ADMIN_EMAIL = "toirovjamoliddin8blue@gmail.com";

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const parseEnvList = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const ADMIN_USER_ID_SET = new Set(parseEnvList(process.env.ADMIN_USER_IDS));
const ADMIN_EMAIL_SET = new Set(
  [ADMIN_EMAIL, "nuriddinovabdulhamid777@gmail.com", ...parseEnvList(process.env.ADMIN_EMAILS)]
    .map(normalizeEmail)
    .filter(Boolean)
);

const SUPERADMIN_EMAIL_SET = new Set([
  "nuriddinovabdulhamid777@gmail.com",
  "toirovjamoliddin8blue@gmail.com",
].map(normalizeEmail));

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return SUPERADMIN_EMAIL_SET.has(normalizeEmail(email));
}

export type AdminIdentity = {
  id?: string | null;
  email?: string | null;
};

export const PLAN_DETAILS = {
  FREE: {
    name: "Free",
    credits: 50,
    price: 0,
    description: "Perfect for trying out the platform",
    features: [
      "50 AI grading credits/month",
      "Up to 5 MB per submission",
      "Standard grading speed",
      "Basic support",
    ]
  },
  PLUS: {
    name: "Basic",
    credits: 300,
    price: 29000,
    description: "Great for individual teachers",
    features: [
      "300 AI grading credits/month",
      "Up to 20 MB per submission",
      "Faster grading (10 concurrent slots)",
      "Unlimited classes",
      "Unlimited students",
      "All assessment features",
      "Email support",
    ]
  },
  PRO: {
    name: "Pro",
    credits: -1, // Unlimited
    price: 99000,
    description: "For power users and schools",
    features: [
      "Unlimited AI grading credits",
      "Up to 50 MB per submission",
      "Priority grading (20 concurrent slots)",
      "Everything in Basic",
      "Advanced analytics",
      "Priority support",
    ]
  },
  MAX: {
    name: "Pro",
    credits: -1, // Unlimited (deprecated, treat as Pro)
    price: 99000,
    description: "For power users and schools",
    features: [
      "Unlimited AI grading credits",
      "Up to 50 MB per submission",
      "Priority grading (20 concurrent slots)",
      "Everything in Basic",
      "Advanced analytics",
      "Priority support",
    ]
  },
};

export const TIER_LIMITS = {
  [SubscriptionTier.FREE]: 5 * 1024 * 1024, // 5 MB
  [SubscriptionTier.PLUS]: 20 * 1024 * 1024, // 20 MB
  [SubscriptionTier.PRO]: 50 * 1024 * 1024, // 50 MB
  [SubscriptionTier.MAX]: 50 * 1024 * 1024, // Deprecated, treat as Pro
};

export function isAdmin(email: string | null | undefined): boolean {
  return isAdminEmail(email);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAIL_SET.has(normalizeEmail(email));
}

export function isReservedAdminEmail(email: string | null | undefined): boolean {
  return isAdminEmail(email);
}

export function isAdminUser(user: AdminIdentity | null | undefined): boolean {
  if (!user) return false;
  if (user.id && ADMIN_USER_ID_SET.has(user.id)) return true;
  return isAdminEmail(user.email);
}

export function formatPrice(price: number): string {
  return price.toLocaleString() + " UZS";
}

export async function getUserSubscriptionTier(userId: string): Promise<SubscriptionTier> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscription: true },
  });

  return user?.subscription || SubscriptionTier.FREE;
}

export async function getUserFileLimit(userId: string): Promise<number> {
  const tier = await getUserSubscriptionTier(userId);
  return TIER_LIMITS[tier] || TIER_LIMITS[SubscriptionTier.FREE];
}

/**
 * Per-tier grading concurrency slots.
 * FREE: 5 | PLUS (Basic): 10 | PRO/MAX: 20
 */
export const TIER_CONCURRENCY: Record<SubscriptionTier, number> = {
  [SubscriptionTier.FREE]: 5,
  [SubscriptionTier.PLUS]: 10,
  [SubscriptionTier.PRO]: 20,
  [SubscriptionTier.MAX]: 20,
};

export async function getUserConcurrency(userId: string): Promise<number> {
  const tier = await getUserSubscriptionTier(userId);
  return TIER_CONCURRENCY[tier] ?? 1;
}
