import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireDirector } from "@/lib/director/auth";

/**
 * GET /api/director/group-stats?grade=9&subclasses=A,B,C
 * Returns per-subject averages for each requested group vs. the whole grade.
 *
 * Also accepts legacy ?subclass=A (single) for backwards compat.
 */
export async function GET(req: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { school } = auth;

  const grade = req.nextUrl.searchParams.get("grade");
  const subclassesParam = req.nextUrl.searchParams.get("subclasses"); // "A,B,C"
  const subclassParam = req.nextUrl.searchParams.get("subclass");     // legacy single

  const subclasses = subclassesParam
    ? subclassesParam.split(",").map((s) => s.trim()).filter(Boolean)
    : subclassParam
    ? [subclassParam.trim()]
    : [];

  if (!grade || subclasses.length === 0) {
    return NextResponse.json({ error: "grade and subclasses required" }, { status: 400 });
  }

  // Members for requested groups
  const groupMembers = await prisma.schoolMembership.findMany({
    where: { schoolId: school.id, grade, subclass: { in: subclasses }, role: "STUDENT", status: "active" },
    select: { userId: true, subclass: true },
  });

  // All members for the grade (for grade-level averages)
  const gradeMembers = await prisma.schoolMembership.findMany({
    where: { schoolId: school.id, grade, role: "STUDENT", status: "active" },
    select: { userId: true },
  });

  const allStudentIds = [
    ...new Set([...groupMembers.map((m) => m.userId), ...gradeMembers.map((m) => m.userId)]),
  ];

  // Fetch all submissions in one query
  const allSubs = await prisma.submission.findMany({
    where: {
      status: "GRADED",
      maxScore: { gt: 0 },
      studentId: { in: allStudentIds },
      assessment: { class: { schoolId: school.id } },
    },
    select: {
      score: true,
      maxScore: true,
      studentId: true,
      assessment: { select: { class: { select: { subject: true, name: true } } } },
    },
  });

  // Filter to this grade only
  const gradeSubs = allSubs.filter((s) => {
    const m = s.assessment.class.name?.match(/^(\d+)/);
    return m && m[1] === grade;
  });

  const aggregate = (subs: typeof gradeSubs) => {
    const map: Record<string, number[]> = {};
    for (const s of subs) {
      const subj = s.assessment.class.subject || "Other";
      if (!map[subj]) map[subj] = [];
      if (s.score !== null && s.maxScore && s.maxScore > 0) {
        map[subj].push((s.score / s.maxScore) * 100);
      }
    }
    return map;
  };

  const gradeBySubject = aggregate(gradeSubs);
  const allSubjectNames = new Set(Object.keys(gradeBySubject));

  // Per-subclass aggregation
  const tempGroups: Record<string, Record<string, number[]>> = {};
  for (const sc of subclasses) {
    const scIds = new Set(groupMembers.filter((m) => m.subclass === sc).map((m) => m.userId));
    const scSubs = gradeSubs.filter((s) => scIds.has(s.studentId));
    tempGroups[sc] = aggregate(scSubs);
    for (const k of Object.keys(tempGroups[sc])) allSubjectNames.add(k);
  }

  const subjectList = Array.from(allSubjectNames).sort();

  const groups: Record<string, { name: string; avg: number }[]> = {};
  for (const sc of subclasses) {
    groups[sc] = subjectList.map((name) => ({
      name,
      avg: tempGroups[sc][name]
        ? Math.round(tempGroups[sc][name].reduce((a, b) => a + b, 0) / tempGroups[sc][name].length)
        : 0,
    }));
  }

  const gradeAvg = subjectList.map((name) => ({
    name,
    avg: gradeBySubject[name]
      ? Math.round(gradeBySubject[name].reduce((a, b) => a + b, 0) / gradeBySubject[name].length)
      : 0,
  }));

  const response = NextResponse.json({ groups, gradeAvg });
  response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=120");
  return response;
}
