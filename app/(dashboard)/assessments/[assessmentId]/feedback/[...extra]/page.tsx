import { redirect } from "next/navigation";

export default async function FeedbackExtraSegmentRedirect({
  params,
}: {
  params: Promise<{ assessmentId: string; extra: string[] }>;
}) {
  const { assessmentId } = await params;
  redirect(`/assessments/${assessmentId}/feedback`);
}
