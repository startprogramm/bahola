import { redirect } from "next/navigation";

export default async function SubmissionExtraSegmentRedirect({
  params,
}: {
  params: Promise<{ assessmentId: string; submissionId: string; extra: string[] }>;
}) {
  const { assessmentId, submissionId } = await params;
  redirect(`/assessments/${assessmentId}/submissions/${submissionId}`);
}
