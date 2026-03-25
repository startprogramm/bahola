"use client";

import { NotificationProvider } from "@/lib/notifications/notification-context";

export function DashboardProviders({ children }: { children: React.ReactNode }) {
  return <NotificationProvider>{children}</NotificationProvider>;
}
