"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { AppHeader } from "@/components/app-header";
import { SubscriptionExpiryBanner } from "@/components/subscription-expiry-banner";

interface DashboardShellProps {
  children: React.ReactNode;
  initialSidebarPinned?: boolean;
}

export function DashboardShell({ children, initialSidebarPinned = false }: DashboardShellProps) {
  const [mounted, setMounted] = useState(false);
  const [isPinned, setIsPinned] = useState(initialSidebarPinned);
  const [isMobile, setIsMobile] = useState(false);
  const pathname = usePathname();

  // Check if on split-screen submission view
  const isSubmissionDetailPage = /\/assessments\/[^/]+\/(submissions\/[^/]+|feedback)/.test(pathname);

  useEffect(() => {
    setMounted(true);

    // Check if mobile using matchMedia (fires only at breakpoint, not every pixel)
    const mql = window.matchMedia("(max-width: 767px)");
    setIsMobile(mql.matches);
    const handleMediaChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handleMediaChange);

    // Listen for pin changes
    const handlePinChange = (e: any) => {
      setIsPinned(e.detail);
    };

    window.addEventListener("sidebar-pin-change", handlePinChange);
    return () => {
      window.removeEventListener("sidebar-pin-change", handlePinChange);
      mql.removeEventListener("change", handleMediaChange);
    };
  }, []);

  // For split-screen pages, render without sidebar/header
  if (isSubmissionDetailPage) {
    return <>{children}</>;
  }

  if (!mounted) {
    return (
      <div className="flex">
        <div className={`w-0 ${initialSidebarPinned ? "md:w-[280px]" : "md:w-[72px]"}`} />
        <div className="flex-1 min-w-0">
          <div className="h-16" />
          <main className="p-4 sm:p-6">{children}</main>
        </div>
      </div>
    );
  }

  const cornerSize = 28;
  const contentLeft = isMobile ? "0px" : (isPinned ? "280px" : "72px");
  return (
    <>
      <AppHeader />
      <Sidebar />
      <div
        className="min-h-screen pt-16 transition-all duration-300 bg-muted relative overflow-x-clip"
        style={{ marginLeft: contentLeft }}
      >
        {/* Curved connector between top bar and left nav area */}
        <div
          className="hidden md:block fixed top-16 pointer-events-none z-20 transition-[left] duration-300"
          style={{ left: contentLeft, width: `${cornerSize}px`, height: `${cornerSize}px` }}
        >
          <svg
            aria-hidden
            className="h-full w-full"
            viewBox={`0 0 ${cornerSize} ${cornerSize}`}
            fill="none"
          >
            <path
              d={`M${cornerSize} 0 A${cornerSize} ${cornerSize} 0 0 0 0 ${cornerSize} L0 0 Z`}
              fill="hsl(var(--muted))"
            />
          </svg>
        </div>
        <main
          className="relative z-10 max-w-full overflow-x-clip bg-background min-h-[calc(100vh-64px)]"
          style={{ borderTopLeftRadius: isMobile ? 0 : `${cornerSize}px` }}
        >
          <SubscriptionExpiryBanner />
          <div className="px-4 py-3 sm:p-4 md:p-6">
            {children}
          </div>
        </main>
      </div>
    </>
  );
}
