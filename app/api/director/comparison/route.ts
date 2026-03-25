import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireDirector } from "@/lib/director/auth";

/**
 * GET /api/director/comparison?grade=9&subject=Matematika&threads=A,B,C&from=2025-01-01&to=2025-12-31
 * Returns assessment comparison across class threads using ordinal positions
 */
export async function GET(req: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { school } = auth;

  const grade = req.nextUrl.searchParams.get("grade");
  const subject = req.nextUrl.searchParams.get("subject");
  const threadsParam = req.nextUrl.searchParams.get("threads");
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");

  if (!grade || !subject) {
    return NextResponse.json({ error: "grade and subject required" }, { status: 400 });
  }

  const threadList = threadsParam ? threadsParam.split(",").filter(Boolean) : [];

  // Find all classes matching the grade and subject
  const allSubjectClasses = await prisma.class.findMany({
    where: {
      schoolId: school.id,
      subject,
      archived: false,
    },
    select: { id: true, name: true },
  });
  const classes = allSubjectClasses.filter((c) => {
    const m = c.name.match(/^(\d+)/);
    return m && m[1] === grade;
  });

  const classIds = classes.map((c) => c.id);

  // Build date filter for assessments
  const dateFilter: Record<string, Date> = {};
  if (from) dateFilter.gte = new Date(from);
  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    dateFilter.lte = toDate;
  }

  // Get all assessments for these classes, optionally filtered by date
  const assessments = await prisma.assessment.findMany({
    where: {
      classId: { in: classIds },
      ...(Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, classId: true, createdAt: true },
  });

  // Group assessments by classId and assign ordinal positions
  const classBuckets: Record<string, typeof assessments> = {};
  for (const a of assessments) {
    if (!classBuckets[a.classId]) classBuckets[a.classId] = [];
    classBuckets[a.classId].push(a);
  }

  // Find max position count across all classes
  let maxPositions = 0;
  for (const bucket of Object.values(classBuckets)) {
    if (bucket.length > maxPositions) maxPositions = bucket.length;
  }

  // Build positions array and positionTitles map
  const positions: { position: number; label: string }[] = [];
  const positionTitles: Record<number, string[]> = {};
  for (let i = 0; i < maxPositions; i++) {
    const pos = i + 1;
    positions.push({ position: pos, label: `${pos}` });
    // Collect all assessment titles at this position across classes
    const titles: string[] = [];
    for (const bucket of Object.values(classBuckets)) {
      if (bucket[i]) titles.push(bucket[i].title);
    }
    positionTitles[pos] = [...new Set(titles)];
  }

  // Map assessmentId → position (per class)
  const assessmentPosition: Record<string, number> = {};
  for (const bucket of Object.values(classBuckets)) {
    bucket.forEach((a, idx) => {
      assessmentPosition[a.id] = idx + 1;
    });
  }

  // Get student subclass mappings
  const studentMemberships = await prisma.schoolMembership.findMany({
    where: { schoolId: school.id, grade, role: "STUDENT", status: "active" },
    select: { userId: true, subclass: true },
  });
  const studentSubclass: Record<string, string> = {};
  for (const m of studentMemberships) {
    if (m.subclass) studentSubclass[m.userId] = m.subclass;
  }

  // Get all graded submissions for these assessments
  const submissions = await prisma.submission.findMany({
    where: {
      assessmentId: { in: assessments.map((a) => a.id) },
      status: "GRADED",
      maxScore: { gt: 0 },
    },
    select: { assessmentId: true, studentId: true, score: true, maxScore: true },
  });

  // Group submissions by thread (subclass) and position
  const threadData: Record<string, Record<number, number[]>> = {};
  for (const s of submissions) {
    if (s.score === null || !s.maxScore || s.maxScore <= 0) continue;
    const thread = studentSubclass[s.studentId] || "?";
    if (threadList.length > 0 && !threadList.includes(thread)) continue;

    const position = assessmentPosition[s.assessmentId];
    if (!position) continue;

    if (!threadData[thread]) threadData[thread] = {};
    if (!threadData[thread][position]) threadData[thread][position] = [];
    threadData[thread][position].push((s.score / s.maxScore) * 100);
  }

  const threads = Object.entries(threadData)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([thread, posScores]) => ({
      thread,
      scores: Object.entries(posScores).map(([pos, scores]) => ({
        position: parseInt(pos),
        avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      })),
    }));

  // Only show threads that have actual graded submissions
  const availableThreads = Array.from(
    new Set(submissions.map((s) => studentSubclass[s.studentId]).filter(Boolean))
  ).sort() as string[];

  const allGradeClasses = await prisma.class.findMany({
    where: { schoolId: school.id, archived: false },
    select: { subject: true, name: true },
  });
  const availableSubjects = allGradeClasses
    .filter((c) => { const m = c.name.match(/^(\d+)/); return m && m[1] === grade; })
    .map((c) => c.subject)
    .filter((s, i, arr) => s && arr.indexOf(s) === i)
    .sort();

  const response = NextResponse.json({
    positions,
    positionTitles,
    threads,
    availableThreads,
    availableSubjects,
  });
  response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=120");
  return response;
}
