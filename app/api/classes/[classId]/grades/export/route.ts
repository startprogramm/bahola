import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import prisma, { isUserClassTeacher } from "@/lib/prisma";
import ExcelJS from "exceljs";

function startOfDay(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day, 0, 0, 0, 0);
}

function endOfDay(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day, 23, 59, 59, 999);
}

function getDateRange(
  filterType: string,
  quarter: number | null,
  semester: number | null,
  academicYear: number | null,
  month: number | null,
  year: number | null,
): { from: Date; to: Date } | null {
  if (filterType === "all") return null;

  if (filterType === "month") {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 30);
    return { from, to };
  }

  if (academicYear == null) return null;

  if (filterType === "quarter" && quarter != null) {
    switch (quarter) {
      case 1: return { from: startOfDay(academicYear, 8, 1), to: endOfDay(academicYear, 9, 31) };
      case 2: return { from: startOfDay(academicYear, 10, 1), to: endOfDay(academicYear, 11, 31) };
      case 3: return { from: startOfDay(academicYear + 1, 0, 1), to: endOfDay(academicYear + 1, 2, 20) };
      case 4: return { from: startOfDay(academicYear + 1, 2, 21), to: endOfDay(academicYear + 1, 5, 25) };
    }
  }

  if (filterType === "semester" && semester != null) {
    if (semester === 1) return { from: startOfDay(academicYear, 8, 1), to: endOfDay(academicYear, 11, 31) };
    return { from: startOfDay(academicYear + 1, 0, 1), to: endOfDay(academicYear + 1, 5, 25) };
  }

  if (filterType === "year") {
    return { from: startOfDay(academicYear, 8, 1), to: endOfDay(academicYear + 1, 5, 25) };
  }

  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  try {
    const session = await getAuthSession();
    const { classId } = await params;

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Auth check
    const classData = await prisma.class.findUnique({
      where: { id: classId },
      select: { teacherId: true, name: true },
    });

    if (!classData) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    if (classData.teacherId !== session.user.id) {
      const hasAccess = await isUserClassTeacher(session.user.id, classId);
      if (!hasAccess) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
    }

    // Parse filter params
    const sp = request.nextUrl.searchParams;
    const filterType = sp.get("filterType") ?? "all";
    const quarter = sp.has("quarter") ? Number(sp.get("quarter")) : null;
    const semester = sp.has("semester") ? Number(sp.get("semester")) : null;
    const academicYear = sp.has("academicYear") ? Number(sp.get("academicYear")) : null;
    const month = sp.has("month") ? Number(sp.get("month")) : null;
    const year = sp.has("year") ? Number(sp.get("year")) : null;

    const dateRange = getDateRange(filterType, quarter, semester, academicYear, month, year);

    // Fetch assessments
    let assessments = await prisma.assessment.findMany({
      where: { classId, status: { not: "DRAFT" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, totalMarks: true, createdAt: true },
    });

    // Apply date filter
    if (dateRange) {
      assessments = assessments.filter((a) => {
        const d = new Date(a.createdAt);
        return d >= dateRange.from && d <= dateRange.to;
      });
    }

    // Fetch students
    const enrollments = await prisma.enrollment.findMany({
      where: { classId, role: "STUDENT" },
      include: { student: { select: { id: true, name: true, email: true } } },
      orderBy: { student: { name: "asc" } },
    });
    const students = enrollments.map((e) => e.student);

    // Fetch submissions
    const assessmentIds = assessments.map((a) => a.id);
    const submissions = await prisma.submission.findMany({
      where: { assessmentId: { in: assessmentIds } },
      select: { studentId: true, assessmentId: true, score: true, maxScore: true, status: true, createdAt: true },
    });

    // Build submission map
    const submissionMap: Record<string, { score: number | null; maxScore: number | null; status: string; createdAt: Date }> = {};
    for (const sub of submissions) {
      const key = `${sub.studentId}-${sub.assessmentId}`;
      const existing = submissionMap[key];
      if (!existing || sub.createdAt.getTime() > existing.createdAt.getTime()) {
        submissionMap[key] = { score: sub.score, maxScore: sub.maxScore, status: sub.status, createdAt: sub.createdAt };
      }
    }

    // Compute actual max per assessment
    const submissionMaxMap: Record<string, number> = {};
    for (const sub of submissions) {
      if (sub.status === "GRADED" && sub.maxScore && sub.maxScore > 0) {
        const ex = submissionMaxMap[sub.assessmentId];
        if (!ex || sub.maxScore > ex) submissionMaxMap[sub.assessmentId] = sub.maxScore;
      }
    }
    const enrichedAssessments = assessments.map((a) => ({
      ...a,
      actualMaxScore: submissionMaxMap[a.id] ?? (a.totalMarks > 0 ? a.totalMarks : null),
    }));

    // Build Excel
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Bahola";
    const sheet = workbook.addWorksheet("Grades");

    // Header row
    const headerRow: (string | number)[] = ["Student", ...enrichedAssessments.map((a) => a.title), "Average %"];
    sheet.addRow(headerRow);

    // Style header
    const headerRowObj = sheet.getRow(1);
    headerRowObj.font = { bold: true };
    headerRowObj.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    headerRowObj.alignment = { horizontal: "center" };
    // Student column left-aligned
    sheet.getCell(1, 1).alignment = { horizontal: "left" };

    // Add max score sub-header row
    const maxRow: (string | number | null)[] = [
      "Max Score",
      ...enrichedAssessments.map((a) => a.actualMaxScore ?? "?"),
      "",
    ];
    sheet.addRow(maxRow);
    const maxRowObj = sheet.getRow(2);
    maxRowObj.font = { italic: true, color: { argb: "FF64748B" } };
    maxRowObj.alignment = { horizontal: "center" };
    sheet.getCell(2, 1).alignment = { horizontal: "left" };

    // Data rows
    for (const student of students) {
      const scores: number[] = [];
      const maxScores: number[] = [];

      const rowData: (string | number | null)[] = [student.name];

      for (const assessment of enrichedAssessments) {
        const key = `${student.id}-${assessment.id}`;
        const sub = submissionMap[key];
        const effectiveMax = assessment.actualMaxScore ?? sub?.maxScore ?? null;

        if (sub?.status === "GRADED" && sub.score != null) {
          rowData.push(sub.score);
          scores.push(sub.score);
          if (effectiveMax) maxScores.push(effectiveMax);
        } else {
          rowData.push(null);
        }
      }

      // Average %
      if (scores.length > 0 && maxScores.length === scores.length) {
        const validPairs = scores.map((s, i) => ({ s, m: maxScores[i]! })).filter(p => p.m > 0);
        const avgPct = validPairs.length > 0
          ? Math.round(validPairs.reduce((sum, p) => sum + (p.s / p.m) * 100, 0) / validPairs.length)
          : 0;
        rowData.push(avgPct);
      } else {
        rowData.push(null);
      }

      sheet.addRow(rowData);
    }

    // Color-code score cells
    for (let rowIdx = 3; rowIdx <= students.length + 2; rowIdx++) {
      for (let colIdx = 2; colIdx <= enrichedAssessments.length + 1; colIdx++) {
        const cell = sheet.getCell(rowIdx, colIdx);
        const val = cell.value;
        if (typeof val !== "number") continue;
        const maxHeaderCell = sheet.getCell(2, colIdx);
        const maxVal = typeof maxHeaderCell.value === "number" ? maxHeaderCell.value : null;
        if (!maxVal) continue;
        const pct = (val / maxVal) * 100;
        if (pct >= 80) cell.font = { color: { argb: "FF16A34A" } };
        else if (pct >= 60) cell.font = { color: { argb: "FFCA8A04" } };
        else if (pct >= 40) cell.font = { color: { argb: "FFF97316" } };
        else cell.font = { color: { argb: "FFDC2626" } };
      }
      // Average % column
      const avgCell = sheet.getCell(rowIdx, enrichedAssessments.length + 2);
      const avgVal = avgCell.value;
      if (typeof avgVal === "number") {
        if (avgVal >= 80) avgCell.font = { bold: true, color: { argb: "FF16A34A" } };
        else if (avgVal >= 60) avgCell.font = { bold: true, color: { argb: "FFCA8A04" } };
        else if (avgVal >= 40) avgCell.font = { bold: true, color: { argb: "FFF97316" } };
        else avgCell.font = { bold: true, color: { argb: "FFDC2626" } };
        avgCell.value = `${avgVal}%`;
      }
    }

    // Column widths
    sheet.getColumn(1).width = 24;
    for (let i = 2; i <= enrichedAssessments.length + 1; i++) {
      sheet.getColumn(i).width = Math.max(12, Math.min(24, (enrichedAssessments[i - 2]?.title?.length ?? 10) + 4));
    }
    sheet.getColumn(enrichedAssessments.length + 2).width = 12;

    // Center score cells
    for (let rowIdx = 1; rowIdx <= students.length + 2; rowIdx++) {
      for (let colIdx = 2; colIdx <= enrichedAssessments.length + 2; colIdx++) {
        sheet.getCell(rowIdx, colIdx).alignment = { horizontal: "center" };
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const className = (classData.name ?? "grades").replace(/[^a-zA-Z0-9\s-]/g, "").trim();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="grades-${className}.xlsx"`,
      },
    });
  } catch (error) {
    console.error("Grades export error:", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
