-- Phase 0: QuestionResult schema & structured storage
-- Adds per-question structured grading results, plus grading mode fields

-- Add gradingMode to assessments
ALTER TABLE "assessments" ADD COLUMN IF NOT EXISTS "gradingMode" VARCHAR(20) NOT NULL DEFAULT 'text';

-- Add Phase 0 fields to submissions
ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "pageMap" TEXT;
ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "gradingMode" VARCHAR(20) NOT NULL DEFAULT 'text';
ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "gradingMetadata" TEXT;

-- Create QuestionResult table
CREATE TABLE IF NOT EXISTS "question_results" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "questionNumber" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "maxScore" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "deductionReason" TEXT,
  "modelLogicCot" TEXT,
  "feedback" TEXT,
  "containsDiagram" BOOLEAN NOT NULL DEFAULT false,
  "pageNumbers" INTEGER[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "question_results_pkey" PRIMARY KEY ("id")
);

-- Add foreign key
ALTER TABLE "question_results" ADD CONSTRAINT "question_results_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON UPDATE CASCADE ON DELETE CASCADE;

-- Add index
CREATE INDEX IF NOT EXISTS "question_results_submissionId_idx" ON "question_results"("submissionId");
