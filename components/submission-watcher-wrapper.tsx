"use client";

import dynamic from "next/dynamic";

const DynamicSubmissionWatcher = dynamic(
  () => import("@/components/submission-watcher").then((mod) => ({ default: mod.SubmissionWatcher })),
  { ssr: false }
);

export function SubmissionWatcherWrapper() {
  return <DynamicSubmissionWatcher />;
}
