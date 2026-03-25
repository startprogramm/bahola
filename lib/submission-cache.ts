import prisma from "./prisma";

// In-memory cache for submission data (10s TTL)
const cache = new Map<string, { data: SubmissionWithRelations; ts: number }>();
const CACHE_TTL = 10_000; // 10 seconds

export interface SubmissionWithRelations {
  id: string;
  imageUrls: string;
  extractedText: string | null;
  score: number | null;
  maxScore: number | null;
  feedback: string | null;
  status: string;
  gradedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  originalScore: number | null;
  adjustedBy: string | null;
  adjustmentReason: string | null;
  adjustedAt: Date | null;
  reportReason: string | null;
  reportedAt: Date | null;
  studentId: string;
  assessmentId: string;
  student: { id: string; name: string; email: string };
  assessment: {
    id: string;
    classId: string;
    title: string;
    markSchemePdfUrl: string | null;
    markSchemeFileUrls: string | null;
    totalMarks: number | null;
    class: { name: string; teacherId: string };
  };
}

export async function getSubmissionById(
  submissionId: string
): Promise<SubmissionWithRelations | null> {
  // Check cache
  const cached = cache.get(submissionId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      student: {
        select: { id: true, name: true, email: true },
      },
      assessment: {
        select: {
          id: true,
          classId: true,
          title: true,
          markSchemePdfUrl: true,
          markSchemeFileUrls: true,
          totalMarks: true,
          class: {
            select: { name: true, teacherId: true },
          },
        },
      },
    },
  });

  if (submission) {
    cache.set(submissionId, {
      data: submission as SubmissionWithRelations,
      ts: Date.now(),
    });
  }

  return submission as SubmissionWithRelations | null;
}

export function invalidateSubmissionCache(submissionId: string) {
  cache.delete(submissionId);
}
