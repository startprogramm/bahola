"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useSubmissionWatcher } from "@/hooks/use-submission-watcher";

/**
 * Component that watches for submission status changes and triggers notifications
 * Must be placed inside NotificationProvider
 */
export function SubmissionWatcher() {
  const { data: session, status } = useSession();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Store user email for onboarding checks
  useEffect(() => {
    if (mounted && session?.user?.email) {
      localStorage.setItem("user-email", session.user.email);
    }
  }, [mounted, session?.user?.email]);

  // Only run the watcher when mounted and user is authenticated
  const shouldWatch = mounted && status === "authenticated" && !!session;
  useSubmissionWatcher(shouldWatch);

  // This component doesn't render anything
  return null;
}
