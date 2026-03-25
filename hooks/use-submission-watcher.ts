"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useNotifications } from "@/lib/notifications/notification-context";

interface WatchedSubmission {
  id: string;
  assessmentId: string;
  assessmentTitle: string;
  status: string;
}

const POLL_INTERVAL = 45000; // 45 seconds (grading takes minutes)
const WATCHED_SUBMISSIONS_KEY = "watched-submissions";

/**
 * Hook to watch submission status and trigger notifications when grading completes
 * @param enabled - Whether to enable the watcher (default: true)
 */
export function useSubmissionWatcher(enabled: boolean = true) {
  const { addNotification } = useNotifications();
  const watchedRef = useRef<Map<string, WatchedSubmission>>(new Map());
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  // Track count so the polling effect can react to additions/removals
  const [watchedCount, setWatchedCount] = useState(0);

  // Load watched submissions from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const saved = localStorage.getItem(WATCHED_SUBMISSIONS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as WatchedSubmission[];
        watchedRef.current = new Map(parsed.map(s => [s.id, s]));
        setWatchedCount(watchedRef.current.size);
      }
    } catch {
      // Ignore parse errors or localStorage access errors
    }
  }, []);

  // Save watched submissions to localStorage
  const saveWatched = useCallback(() => {
    if (typeof window === "undefined") return;

    try {
      const submissions = Array.from(watchedRef.current.values());
      localStorage.setItem(WATCHED_SUBMISSIONS_KEY, JSON.stringify(submissions));
    } catch {
      // Ignore localStorage access errors
    }
  }, []);

  // Add a submission to watch
  const watchSubmission = useCallback((submission: WatchedSubmission) => {
    if (submission.status === "PROCESSING") {
      watchedRef.current.set(submission.id, submission);
      setWatchedCount(watchedRef.current.size);
      saveWatched();
    }
  }, [saveWatched]);

  // Remove a submission from watch
  const unwatchSubmission = useCallback((submissionId: string) => {
    watchedRef.current.delete(submissionId);
    setWatchedCount(watchedRef.current.size);
    saveWatched();
  }, [saveWatched]);

  // Check status of watched submissions (batched into a single API call)
  const checkStatuses = useCallback(async () => {
    const watchedIds = Array.from(watchedRef.current.keys());
    if (watchedIds.length === 0) return;

    try {
      const response = await fetch("/api/submissions/batch-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: watchedIds }),
      });

      if (!response.ok) return;

      const data = await response.json();
      const submissions: { id: string; status: string; score: number | null; maxScore: number | null }[] = data.submissions;

      for (const submission of submissions) {
        const watched = watchedRef.current.get(submission.id);
        if (!watched) continue;

        // Check if status changed from PROCESSING to GRADED or ERROR
        if (watched.status === "PROCESSING" && submission.status !== "PROCESSING") {
          if (submission.status === "GRADED") {
            addNotification({
              type: "grading_complete",
              title: "Grading Complete",
              message: `Your submission for "${watched.assessmentTitle}" has been graded: ${submission.score}/${submission.maxScore}`,
              submissionId: submission.id,
              assessmentId: watched.assessmentId,
            });
          } else if (submission.status === "ERROR") {
            addNotification({
              type: "error",
              title: "Grading Error",
              message: `There was an error grading your submission for "${watched.assessmentTitle}"`,
              submissionId: submission.id,
              assessmentId: watched.assessmentId,
            });
          }

          // Remove from watch list
          unwatchSubmission(submission.id);
        }
      }

      // Remove any IDs that weren't returned (deleted submissions)
      for (const id of watchedIds) {
        if (!submissions.find((s: { id: string }) => s.id === id)) {
          unwatchSubmission(id);
        }
      }
    } catch (error) {
      console.error("Error checking submission statuses:", error);
    }
  }, [addNotification, unwatchSubmission]);

  // Only poll when enabled AND there are watched submissions
  useEffect(() => {
    if (!enabled || watchedCount === 0) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Initial check
    checkStatuses();

    // Set up interval only when there are items to watch
    intervalRef.current = setInterval(checkStatuses, POLL_INTERVAL);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [checkStatuses, enabled, watchedCount]);

  return { watchSubmission, unwatchSubmission };
}

// Global function to add a submission to watch (for use outside React components)
export function watchSubmissionGlobal(submission: WatchedSubmission) {
  if (typeof window === "undefined") return;

  const saved = localStorage.getItem(WATCHED_SUBMISSIONS_KEY);
  let submissions: WatchedSubmission[] = [];

  if (saved) {
    try {
      submissions = JSON.parse(saved);
    } catch {
      // Ignore
    }
  }

  // Add if not already watching
  if (!submissions.find(s => s.id === submission.id)) {
    submissions.push(submission);
    localStorage.setItem(WATCHED_SUBMISSIONS_KEY, JSON.stringify(submissions));
  }
}
