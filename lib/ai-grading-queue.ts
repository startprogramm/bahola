import prisma from "@/lib/prisma";

type GradingTask = {
  submissionId: string;
  run: () => Promise<void>;
};

type EnqueueResult =
  | { accepted: true }
  | { accepted: false; reason: "already-queued" | "queue-full" };

const DEFAULT_CONCURRENCY = 8;
const DEFAULT_QUEUE_SIZE = 1000;
const DEFAULT_STALE_PROCESSING_MS = 5 * 60 * 1000;
const DEFAULT_MAINTENANCE_INTERVAL_MS = 2 * 60 * 1000;

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const MAX_CONCURRENCY = parsePositiveInt(
  process.env.AI_GRADING_CONCURRENCY,
  DEFAULT_CONCURRENCY
);
const MAX_QUEUE_SIZE = parsePositiveInt(
  process.env.AI_GRADING_QUEUE_SIZE,
  DEFAULT_QUEUE_SIZE
);
const STALE_PROCESSING_MS = parsePositiveInt(
  process.env.AI_GRADING_STALE_PROCESSING_MS,
  DEFAULT_STALE_PROCESSING_MS
);
const MAINTENANCE_INTERVAL_MS = parsePositiveInt(
  process.env.AI_GRADING_QUEUE_MAINTENANCE_MS,
  DEFAULT_MAINTENANCE_INTERVAL_MS
);

const queue: GradingTask[] = [];
const queuedOrRunningIds = new Set<string>();
let runningCount = 0;
let drainScheduled = false;
let maintenanceStarted = false;
let recoveryInFlight = false;

async function recoverStaleProcessingSubmissions() {
  if (recoveryInFlight) return;
  recoveryInFlight = true;

  try {
    const cutoff = new Date(Date.now() - STALE_PROCESSING_MS);

    // Find stale submissions so we can attempt to re-enqueue them
    const staleSubmissions = await prisma.submission.findMany({
      where: {
        status: "PROCESSING",
        gradedAt: null,
        updatedAt: { lt: cutoff },
      },
      select: {
        id: true,
        retryCount: true,
      },
    });

    if (staleSubmissions.length === 0) return;

    const MAX_AUTO_RETRIES = 2;
    const toRetry: string[] = [];
    const toFail: string[] = [];

    for (const s of staleSubmissions) {
      const retries = s.retryCount ?? 0;
      if (retries < MAX_AUTO_RETRIES) {
        toRetry.push(s.id);
      } else {
        toFail.push(s.id);
      }
    }

    // Reset retryable submissions back to PENDING so the teacher can retry
    if (toRetry.length > 0) {
      await prisma.submission.updateMany({
        where: { id: { in: toRetry } },
        data: {
          status: "PENDING",
          gradingProgress: 0,
          feedback: null,
          retryCount: { increment: 1 },
        },
      });
      console.warn(`[AI Queue] Reset ${toRetry.length} stale submission(s) to PENDING for retry.`);
    }

    // Mark permanently failed ones as ERROR
    if (toFail.length > 0) {
      await prisma.submission.updateMany({
        where: { id: { in: toFail } },
        data: {
          status: "ERROR",
          gradingProgress: 0,
          feedback: "Grading was interrupted multiple times. Please retry manually.",
        },
      });
      console.warn(`[AI Queue] Marked ${toFail.length} stale submission(s) as ERROR after max retries.`);
    }
  } catch (error) {
    console.error("[AI Queue] Failed to recover stale submissions:", error);
  } finally {
    recoveryInFlight = false;
  }
}

function ensureMaintenanceLoop() {
  if (maintenanceStarted) return;
  maintenanceStarted = true;

  void recoverStaleProcessingSubmissions();

  const timer = setInterval(() => {
    void recoverStaleProcessingSubmissions();
  }, MAINTENANCE_INTERVAL_MS);

  if (typeof timer.unref === "function") {
    timer.unref();
  }
}

function scheduleDrain() {
  ensureMaintenanceLoop();
  if (drainScheduled) return;
  drainScheduled = true;

  setImmediate(() => {
    drainScheduled = false;
    drainQueue();
  });
}

function drainQueue() {
  while (runningCount < MAX_CONCURRENCY && queue.length > 0) {
    const task = queue.shift();
    if (!task) return;

    runningCount += 1;

    Promise.resolve(task.run())
      .catch((error) => {
        console.error(`[AI Queue] Task failed for ${task.submissionId}:`, error);
      })
      .finally(() => {
        runningCount -= 1;
        queuedOrRunningIds.delete(task.submissionId);
        scheduleDrain();
      });
  }
}

export function enqueueGradingTask(
  submissionId: string,
  run: () => Promise<void>
): EnqueueResult {
  ensureMaintenanceLoop();

  if (queuedOrRunningIds.has(submissionId)) {
    return { accepted: false, reason: "already-queued" };
  }

  if (queue.length >= MAX_QUEUE_SIZE) {
    return { accepted: false, reason: "queue-full" };
  }

  queuedOrRunningIds.add(submissionId);
  queue.push({ submissionId, run });
  scheduleDrain();
  return { accepted: true };
}

export function getGradingQueueStats() {
  ensureMaintenanceLoop();

  return {
    queued: queue.length,
    running: runningCount,
    maxConcurrency: MAX_CONCURRENCY,
    maxQueueSize: MAX_QUEUE_SIZE,
    staleProcessingMs: STALE_PROCESSING_MS,
    maintenanceIntervalMs: MAINTENANCE_INTERVAL_MS,
  };
}
