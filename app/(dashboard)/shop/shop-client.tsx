"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Coins, Zap, Crown, Check, Loader2, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n/language-context";
import { cn } from "@/lib/utils";
import {
  getCurrentPlanLevel,
  getPlanLevelRank,
  getRequestedPlanLevel,
  type PlanLevel,
} from "@/lib/purchase-hierarchy";

interface SubscriptionData {
  subscription: string;
  credits: number;
  subscriptionExpiresAt?: string | null;
  currentPlanLevel?: PlanLevel;
}

interface ShopClientProps {
  initialData: SubscriptionData;
}

export default function ShopClient({ initialData }: ShopClientProps) {
  const { language, t } = useLanguage();
  const [data] = useState<SubscriptionData>(initialData);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [billing, setBilling] = useState<"monthly" | "annual">("annual");

  const handlePurchase = async (planKey: string) => {
    const id = `${planKey}_${billing}`;
    setPurchasing(id);
    try {
      const res = await fetch("/api/orders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planKey, billing }),
      });
      const json = await res.json();
      if (res.ok && json.payUrl) {
        window.location.href = json.payUrl;
      } else {
        alert(json.error || "Failed to create order");
        setPurchasing(null);
      }
    } catch {
      alert("Network error");
      setPurchasing(null);
    }
  };

  const mo = language === "uz" ? "oy" : language === "ru" ? "мес" : "mo";
  const creditsLabel =
    language === "uz" ? "kredit/oy" : language === "ru" ? "кредитов/мес" : "credits/mo";
  const unlimited =
    language === "uz" ? "Cheksiz kreditlar" : language === "ru" ? "Безлимит" : "Unlimited credits";

  const currentPlan = data?.subscription ?? "FREE";
  const currentPlanLevel =
    data?.currentPlanLevel ??
    getCurrentPlanLevel({
      subscription: currentPlan,
      subscriptionExpiresAt: data?.subscriptionExpiresAt ?? null,
    });
  const currentPlanRank = getPlanLevelRank(currentPlanLevel);

  const plans = [
    {
      key: "FREE",
      name: "Free",
      icon: Sparkles,
      color: "gray",
      border: "border-border",
      iconBg: "bg-gray-500",
      monthlyPrice: null,
      annualPrice: null,
      annualBilled: null,
      annualDiscount: null,
      monthlyOriginal: null,
      desc: `50 ${creditsLabel}`,
      features: [
        language === "uz" ? "50 AI kredit/oy" : language === "ru" ? "50 AI кредитов/мес" : "50 AI credits/month",
        language === "uz" ? "5 ta sinf" : language === "ru" ? "5 классов" : "5 classes",
        language === "uz" ? "Asosiy imtihon qoidalari" : language === "ru" ? "Базовые правила экзаменов" : "Basic exam board rules",
        language === "uz" ? "Jamoat yordam" : language === "ru" ? "Поддержка сообщества" : "Community support",
      ],
    },
    {
      key: "PLUS",
      name: "Plus",
      icon: Zap,
      color: "blue",
      border: "border-blue-500/40",
      iconBg: "bg-blue-500",
      monthlyPrice: "29,000",
      annualPrice: "228,000",
      annualMonthlyPrice: "19,000",
      annualDiscount: "-34%",
      monthlyOriginal: null,
      desc: `300 ${creditsLabel}`,
      features: [
        language === "uz" ? "300 AI kredit/oy" : language === "ru" ? "300 AI кредитов/мес" : "300 AI credits/month",
        language === "uz" ? "Cheksiz sinflar" : language === "ru" ? "Безлимит классов" : "Unlimited classes",
        language === "uz" ? "Barcha imtihon qoidalari" : language === "ru" ? "Все правила экзаменов" : "All exam board rules",
        language === "uz" ? "Email yordam" : language === "ru" ? "Email поддержка" : "Email support",
      ],
    },
    {
      key: "PRO",
      name: "Pro",
      icon: Crown,
      color: "amber",
      border: "border-amber-500/40",
      iconBg: "bg-amber-500",
      monthlyPrice: "99,000",
      annualPrice: "588,000",
      annualMonthlyPrice: "49,000",
      annualDiscount: "-51%",
      monthlyOriginal: null,
      desc: unlimited,
      features: [
        unlimited,
        language === "uz" ? "Ustuvor AI ishlov berish" : language === "ru" ? "Приоритетная обработка" : "Priority AI processing",
        language === "uz" ? "Kengaytirilgan analitika" : language === "ru" ? "Расширенная аналитика" : "Advanced analytics",
        language === "uz" ? "Ustuvor yordam" : language === "ru" ? "Приоритетная поддержка" : "Priority support",
      ],
    },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-8 p-4 md:p-6">
      <div>
        <h1 className="text-3xl font-bold">{t("shopTitle")}</h1>
        <p className="text-muted-foreground mt-1">{t("shopDescription")}</p>
      </div>

      {data && (
        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <Coins className="h-8 w-8 text-primary" />
            <div>
              <p className="font-semibold">
                {t("currentPlan")}: {data.subscription}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("credits")}: {data.credits === -1 ? "Unlimited" : data.credits}
              </p>
              {data.subscriptionExpiresAt && (() => {
                const expiresAt = new Date(data.subscriptionExpiresAt);
                const isPast = expiresAt.getTime() < Date.now();
                if (isPast) {
                  return (
                    <p className="text-sm text-destructive font-medium">
                      {t("subscriptionExpired")}
                    </p>
                  );
                }
                const formatted = expiresAt.toLocaleDateString(
                  language === "uz" ? "uz-Latn-UZ" : language === "ru" ? "ru-RU" : "en-GB",
                  { day: "numeric", month: "long", year: "numeric" }
                );
                return (
                  <p className="text-sm text-muted-foreground">
                    {t("subscriptionExpires")}: {formatted}
                  </p>
                );
              })()}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Billing toggle */}
      <div className="flex justify-center">
        <div className="inline-flex items-center bg-muted rounded-lg p-1 gap-1">
          <button
            onClick={() => setBilling("monthly")}
            className={cn(
              "px-5 py-2 rounded-md text-sm font-medium transition-all",
              billing === "monthly"
                ? "bg-background shadow text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {language === "uz" ? "Oylik" : language === "ru" ? "Ежемесячно" : "Monthly"}
          </button>
          <button
            onClick={() => setBilling("annual")}
            className={cn(
              "px-5 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2",
              billing === "annual"
                ? "bg-background shadow text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {language === "uz" ? "Yillik" : language === "ru" ? "Годовая" : "Yearly"}
            <span className="bg-green-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              -51%
            </span>
          </button>
        </div>
      </div>

      {/* Plan cards */}
      <div className="grid sm:grid-cols-3 gap-4">
        {plans.map((plan) => {
          const Icon = plan.icon;
          const isPaid = plan.key !== "FREE";
          const displayPrice =
            billing === "annual"
              ? (plan as any).annualMonthlyPrice ?? plan.annualPrice
              : plan.monthlyPrice;
          const id = `${plan.key}_${billing}`;
          const requestedLevel = isPaid ? getRequestedPlanLevel(plan.key, billing) : null;
          const requestedRank = requestedLevel ? getPlanLevelRank(requestedLevel) : -1;
          const isCurrent = !!requestedLevel && requestedRank === currentPlanRank;
          const isDowngrade = !!requestedLevel && requestedRank < currentPlanRank;

          return (
            <Card
              key={plan.key}
              className={cn(
                "relative overflow-hidden border-2 transition-all flex flex-col",
                plan.border,
                isCurrent && "ring-2 ring-primary"
              )}
            >
              {plan.key === "PRO" && (
                <motion.div
                  animate={{ opacity: [0.3, 0.65, 0.3] }}
                  transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
                  className="pointer-events-none absolute -inset-px rounded-xl bg-gradient-to-br from-amber-300/25 to-orange-400/15"
                />
              )}
              {/* Annual discount badge */}
              {billing === "annual" && plan.annualDiscount && (
                <div className="absolute top-3 right-3">
                  <span className="bg-green-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {plan.annualDiscount}
                  </span>
                </div>
              )}

              <CardHeader className="pb-3">
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white",
                      plan.iconBg
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <CardTitle className="text-lg">{plan.name}</CardTitle>
                  {isCurrent && (
                    <span className="text-[10px] bg-primary/10 text-primary font-semibold px-2 py-0.5 rounded-full">
                      {language === "uz" ? "Joriy" : language === "ru" ? "Текущий" : "Current"}
                    </span>
                  )}
                </div>

                <div className="mt-2">
                  {isPaid ? (
                    <>
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        {billing === "annual" && plan.monthlyOriginal && (
                          <span className="text-base line-through text-muted-foreground">
                            {plan.monthlyOriginal}
                          </span>
                        )}
                        <span className="text-2xl font-bold">{displayPrice}</span>
                        <span className="text-xs text-muted-foreground">UZS/{mo}</span>
                      </div>
                      {billing === "annual" && plan.annualPrice && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {plan.annualPrice}{" "}
                          {language === "uz"
                            ? "so'm yillik to'lov"
                            : language === "ru"
                            ? "сум в год"
                            : "UZS billed yearly"}
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold">0</span>
                      <span className="text-xs text-muted-foreground">UZS/{mo}</span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">{plan.desc}</p>
                </div>
              </CardHeader>

              <CardContent className="flex-1 flex flex-col justify-between gap-4">
                <ul className="space-y-1.5">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs">
                      <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                {isPaid ? (
                  <Button
                    onClick={() => handlePurchase(plan.key)}
                    disabled={!!purchasing || isCurrent || isDowngrade}
                    className="w-full"
                    variant={billing === "annual" ? "default" : "outline"}
                    size="sm"
                  >
                    {purchasing === id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isCurrent ? (
                      language === "uz" ? "Joriy reja" : language === "ru" ? "Текущий план" : "Current plan"
                    ) : isDowngrade ? (
                      language === "uz"
                        ? "Pastroq reja mavjud emas"
                        : language === "ru"
                        ? "Более низкий тариф недоступен"
                        : "Lower plan unavailable"
                    ) : (
                      t("purchaseWithClick")
                    )}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled
                  >
                    {isCurrent
                      ? language === "uz" ? "Joriy reja" : language === "ru" ? "Текущий план" : "Current plan"
                      : language === "uz" ? "Bepul" : language === "ru" ? "Бесплатно" : "Free"}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
