import { Suspense } from "react";
import { cookies } from "next/headers";
import { ThemeBackground } from "@/components/theme-background";
import { DashboardShell } from "@/components/dashboard-shell";
import { AIAssistantLazy } from "@/components/ai-assistant-lazy";
import { LanguageSync } from "@/components/language-sync";
import { SubmissionWatcherWrapper } from "@/components/submission-watcher-wrapper";
import { DashboardProviders } from "@/components/dashboard-providers";
import DashboardLoading from "./loading";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const sidebarPinned = cookieStore.get("sidebar-pinned")?.value === "true";

  return (
    <DashboardProviders>
      <div className="min-h-screen bg-muted relative overflow-x-clip">
        <ThemeBackground />
        <LanguageSync />
        <SubmissionWatcherWrapper />
        <DashboardShell initialSidebarPinned={sidebarPinned}>
          <Suspense fallback={<DashboardLoading />}>
            {children}
          </Suspense>
        </DashboardShell>
        <AIAssistantLazy />
      </div>
    </DashboardProviders>
  );
}
