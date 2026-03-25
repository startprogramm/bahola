"use client";

import { useLanguage } from "@/lib/i18n/language-context";

interface DashboardHeaderProps {
  userName: string;
  isTeacher: boolean;
}

export function DashboardHeader({ userName, isTeacher }: DashboardHeaderProps) {
  const { t } = useLanguage();
  const firstName = userName.split(" ")[0];

  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
        {t("welcomeBack")}, {firstName}!
      </h1>
    </div>
  );
}
