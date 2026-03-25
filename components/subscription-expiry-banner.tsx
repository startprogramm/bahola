"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/lib/i18n/language-context";
import { AlertTriangle, X } from "lucide-react";
import Link from "next/link";
import { useSubscriptionData } from "@/hooks/use-subscription";

const DISMISS_KEY = "subscription-expiry-banner-dismissed";

export function SubscriptionExpiryBanner() {
  const { language } = useLanguage();
  const [visible, setVisible] = useState(false);
  const [daysLeft, setDaysLeft] = useState(0);
  const [mounted, setMounted] = useState(false);
  const { data: subData } = useSubscriptionData();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!subData) return;

    // Check if already dismissed today
    if (typeof window !== "undefined") {
      const dismissed = localStorage.getItem(DISMISS_KEY);
      if (dismissed) {
        const dismissedDate = new Date(dismissed);
        const now = new Date();
        if (
          dismissedDate.getFullYear() === now.getFullYear() &&
          dismissedDate.getMonth() === now.getMonth() &&
          dismissedDate.getDate() === now.getDate()
        ) {
          return;
        }
      }
    }

    const { subscription, subscriptionExpiresAt } = subData;
    if (subscription === "FREE" || !subscriptionExpiresAt) return;

    const expiresAt = new Date(subscriptionExpiresAt);
    const now = new Date();
    const diffMs = expiresAt.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays > 0 && diffDays <= 3) {
      setDaysLeft(diffDays);
      setVisible(true);
    }
  }, [subData]);

  function handleDismiss() {
    setVisible(false);
    if (typeof window !== "undefined") {
      localStorage.setItem(DISMISS_KEY, new Date().toISOString());
    }
  }

  if (!mounted || !visible) return null;

  const messages: Record<string, { title: string; body: string; cta: string }> = {
    en: {
      title: "Subscription expiring soon",
      body: daysLeft === 1
        ? "Your subscription expires tomorrow. Renew now to keep your plan."
        : `Your subscription expires in ${daysLeft} days. Renew now to keep your plan.`,
      cta: "Renew",
    },
    uz: {
      title: "Obuna muddati tugamoqda",
      body: daysLeft === 1
        ? "Obunangiz ertaga tugaydi. Rejangizni saqlab qolish uchun hozir yangilang."
        : `Obunangiz ${daysLeft} kun ichida tugaydi. Rejangizni saqlab qolish uchun hozir yangilang.`,
      cta: "Yangilash",
    },
    ru: {
      title: "Подписка скоро истекает",
      body: daysLeft === 1
        ? "Ваша подписка истекает завтра. Продлите сейчас, чтобы сохранить ваш план."
        : `Ваша подписка истекает через ${daysLeft} дн. Продлите сейчас, чтобы сохранить ваш план.`,
      cta: "Продлить",
    },
  };

  const msg = messages[language] || messages.en;

  return (
    <div className="bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800 px-4 py-2.5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 shrink-0" />
        <div className="text-sm min-w-0">
          <span className="font-medium text-amber-800 dark:text-amber-500">
            {msg.title}:
          </span>{" "}
          <span className="text-amber-700 dark:text-amber-500">
            {msg.body}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href="/shop"
          className="text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white px-3 py-1 rounded-md transition-colors"
        >
          {msg.cta}
        </Link>
        <button
          onClick={handleDismiss}
          className="text-amber-600 dark:text-amber-500 hover:text-amber-800 dark:hover:text-amber-200 transition-colors cursor-pointer"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
