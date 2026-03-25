import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireDirector } from "@/lib/director/auth";
import { injectCharts, colLetter, type ChartDef } from "@/lib/director/excel-chart-inject";

/**
 * GET /api/director/export
 * Generates and streams an Excel workbook with all director data.
 * Runs server-side so ExcelJS is fully available.
 */
export async function GET(req: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { school } = auth;
  const schoolName = school.name || "Maktab";
  const date = new Date().toISOString().slice(0, 10);

  const exportType = req.nextUrl.searchParams.get("type") || "full";

  // Call existing API routes internally (server-to-server with session cookie)
  const origin = req.nextUrl.origin;
  const cookie = req.headers.get("cookie") || "";
  const headers = { cookie };

  // ── Charts export: native Excel charts with data sheet ──────────────────
  if (exportType === "charts") {
    const [perfRes2, distRes2, studRes2] = await Promise.allSettled([
      fetch(`${origin}/api/director/performance`, { headers }).then(r => r.ok ? r.json() : null),
      fetch(`${origin}/api/director/score-distribution?perGrade=1`, { headers }).then(r => r.ok ? r.json() : null),
      fetch(`${origin}/api/director/students?limit=50`, { headers }).then(r => r.ok ? r.json() : null),
    ]);

    const perf2: any = perfRes2.status === "fulfilled" ? perfRes2.value : null;
    const dist2: any = distRes2.status === "fulfilled" ? distRes2.value : null;
    const studs2: any[] = studRes2.status === "fulfilled" ? studRes2.value?.students ?? [] : [];

    const MONTH_LBL: Record<string, string> = {
      "01": "Yan", "02": "Fev", "03": "Mar", "04": "Apr",
      "05": "May", "06": "Iyun", "07": "Iyul", "08": "Avg",
      "09": "Sen", "10": "Okt", "11": "Noy", "12": "Dek",
    };

    const wb2 = new ExcelJS.Workbook();
    wb2.creator = "Maktab Director";
    wb2.created = new Date();

    const dataWs = wb2.addWorksheet("Data");
    wb2.addWorksheet("Hisobot");

    const chartDefs: ChartDef[] = [];
    let row = 1;

    // ── Section 1: Performance line chart ─────────────────────────────────
    if (perf2?.series?.length && perf2?.months?.length) {
      const months: string[] = perf2.months;
      const pSeries: any[] = perf2.series;

      dataWs.getCell(row, 1).value = "Oy";
      pSeries.forEach((s: any, i: number) => {
        dataWs.getCell(row, i + 2).value = s.label;
      });

      months.forEach((m: string, mi: number) => {
        const r = row + 1 + mi;
        const [yr, mo] = m.split("-");
        dataWs.getCell(r, 1).value = `${MONTH_LBL[mo] || mo} ${yr}`;
        pSeries.forEach((s: any, si: number) => {
          const pt = s.data.find((d: any) => d.month === m);
          dataWs.getCell(r, si + 2).value = pt?.avgScore ?? null;
        });
      });

      const endRow = row + months.length;
      chartDefs.push({
        type: "line",
        title: "O'quvchilar dinamikasi",
        catRange: `Data!$A$${row + 1}:$A$${endRow}`,
        series: pSeries.map((_: any, i: number) => ({
          nameRef: `Data!$${colLetter(i + 2)}$${row}`,
          valRef: `Data!$${colLetter(i + 2)}$${row + 1}:$${colLetter(i + 2)}$${endRow}`,
        })),
        fromRow: 0, toRow: 18, fromCol: 0, toCol: 10,
      });

      row = endRow + 2;
    }

    // ── Section 2: Distribution bar chart ─────────────────────────────────
    if (dist2?.series?.length) {
      const dSeries: any[] = dist2.series;
      const labels = ["0-10%", "10-20%", "20-30%", "30-40%", "40-50%", "50-60%", "60-70%", "70-80%", "80-90%", "90-100%"];

      dataWs.getCell(row, 1).value = "Ball diapazoni";
      dSeries.forEach((s: any, i: number) => {
        dataWs.getCell(row, i + 2).value = s.label;
      });

      for (let bi = 0; bi < 10; bi++) {
        const r = row + 1 + bi;
        dataWs.getCell(r, 1).value = labels[bi];
        dSeries.forEach((s: any, si: number) => {
          dataWs.getCell(r, si + 2).value = s.buckets?.[bi]?.count ?? 0;
        });
      }

      const startRow = row;
      const endRow = row + 10;
      chartDefs.push({
        type: "col",
        title: "Baholar taqsimoti",
        catRange: `Data!$A$${startRow + 1}:$A$${endRow}`,
        series: dSeries.map((_: any, i: number) => ({
          nameRef: `Data!$${colLetter(i + 2)}$${startRow}`,
          valRef: `Data!$${colLetter(i + 2)}$${startRow + 1}:$${colLetter(i + 2)}$${endRow}`,
        })),
        fromRow: 20, toRow: 38, fromCol: 0, toCol: 10,
      });

      row = endRow + 2;
    }

    // ── Section 3: Student ranking column chart ───────────────────────────
    const topStuds = studs2
      .filter((s: any) => s.avgScore != null)
      .sort((a: any, b: any) => (b.avgScore ?? 0) - (a.avgScore ?? 0))
      .slice(0, 30);

    if (topStuds.length > 0) {
      dataWs.getCell(row, 1).value = "O'quvchi";
      dataWs.getCell(row, 2).value = "O'rtacha ball (%)";

      topStuds.forEach((s: any, i: number) => {
        dataWs.getCell(row + 1 + i, 1).value = s.name;
        dataWs.getCell(row + 1 + i, 2).value = s.avgScore;
      });

      const startRow = row;
      const endRow = row + topStuds.length;
      chartDefs.push({
        type: "bar",
        title: "O'quvchilar reytingi",
        catRange: `Data!$A$${startRow + 1}:$A$${endRow}`,
        series: [{
          nameRef: `Data!$B$${startRow}`,
          valRef: `Data!$B$${startRow + 1}:$B$${endRow}`,
        }],
        fromRow: 40, toRow: 58, fromCol: 0, toCol: 10,
      });
    }

    // Auto-width data columns
    dataWs.columns.forEach((col) => {
      if (!col.eachCell) return;
      let max = 10;
      col.eachCell({ includeEmpty: false }, (cell) => {
        max = Math.max(max, String(cell.value ?? "").length + 2);
      });
      col.width = Math.min(max, 35);
    });

    // Hide data sheet
    dataWs.state = "hidden";

    // Serialize and inject charts
    const buf = await wb2.xlsx.writeBuffer();
    const finalBuf = await injectCharts(Buffer.from(buf as ArrayBufferLike), chartDefs, 2);

    const fname = `${schoolName.replace(/\s+/g, "-")}-grafiklar-${date}.xlsx`;
    return new NextResponse(Buffer.from(finalBuf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fname)}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // Fetch only what's needed for the requested type
  const needsKpis = exportType === "full" || exportType === "overview";
  const needsStudents = exportType === "full" || exportType === "students";
  const needsTeachers = exportType === "full" || exportType === "teachers";
  const needsClasses = exportType === "full" || exportType === "heatmap";
  const needsIssues = exportType === "full" || exportType === "issues";
  const needsPerf = exportType === "full";

  const [kpisRes, studentsRes, teachersRes, classesRes, issuesRes, perfRes] =
    await Promise.allSettled([
      needsKpis ? fetch(`${origin}/api/director/kpis`, { headers }).then((r) => r.ok ? r.json() : null) : Promise.resolve(null),
      needsStudents ? fetch(`${origin}/api/director/students`, { headers }).then((r) => r.ok ? r.json() : null) : Promise.resolve(null),
      needsTeachers ? fetch(`${origin}/api/director/teachers/usage`, { headers }).then((r) => r.ok ? r.json() : null) : Promise.resolve(null),
      needsClasses ? fetch(`${origin}/api/director/classes`, { headers }).then((r) => r.ok ? r.json() : null) : Promise.resolve(null),
      needsIssues ? fetch(`${origin}/api/director/issues`, { headers }).then((r) => r.ok ? r.json() : null) : Promise.resolve(null),
      needsPerf ? fetch(`${origin}/api/director/performance`, { headers }).then((r) => r.ok ? r.json() : null) : Promise.resolve(null),
    ]);

  const kpis = kpisRes.status === "fulfilled" ? kpisRes.value : null;
  const students: any[] = studentsRes.status === "fulfilled" ? studentsRes.value?.students ?? [] : [];
  const teachers: any[] = teachersRes.status === "fulfilled" ? teachersRes.value?.teachers ?? [] : [];
  const classes: any[] = classesRes.status === "fulfilled" ? classesRes.value?.classes ?? [] : [];
  const issues: any[] = issuesRes.status === "fulfilled" ? issuesRes.value?.issues ?? [] : [];
  const perf: any = perfRes.status === "fulfilled" ? perfRes.value : null;

  // For single-type exports, generate a focused workbook
  if (exportType !== "full") {
    const wb2 = new ExcelJS.Workbook();
    wb2.creator = "Maktab Director";
    wb2.created = new Date();

    const HEADER_FILL2: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD6E4FA" } };
    const HEADER_FONT2: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FF1A3A5C" } };
    const HEADER_BORDER2: Partial<ExcelJS.Borders> = { bottom: { style: "medium", color: { argb: "FF4472C4" } } };

    function styleHeader2(ws: ExcelJS.Worksheet, colCount: number) {
      const row = ws.getRow(1);
      row.height = 20;
      for (let i = 1; i <= colCount; i++) {
        const cell = row.getCell(i);
        cell.fill = HEADER_FILL2;
        cell.font = HEADER_FONT2;
        cell.border = HEADER_BORDER2;
        cell.alignment = { vertical: "middle" };
      }
    }

    function autoWidth2(ws: ExcelJS.Worksheet, hdrs: string[], rows: any[][]) {
      ws.columns.forEach((col, i) => {
        let max = String(hdrs[i] ?? "").length;
        rows.forEach((r) => { max = Math.max(max, String(r[i] ?? "").length); });
        col.width = Math.min(Math.max(max + 2, 10), 50);
      });
    }

    function addSheet2(name: string, hdrs: string[], rows: (string | number | null)[][]) {
      const ws = wb2.addWorksheet(name);
      ws.addRow(hdrs);
      styleHeader2(ws, hdrs.length);
      for (const row of rows) ws.addRow(row.map((v) => v ?? "—"));
      autoWidth2(ws, hdrs, rows);
      return ws;
    }

    let sheetName = exportType;
    if (exportType === "students" && students.length > 0) {
      const hdrs = ["Ism", "Email", "Sinf", "Guruh", "O'rtacha ball (%)", "Topshirmagan (%)", "Yozilgan sinflar"];
      const rows = students.map((s: any) => [s.name, s.email, s.grade, s.subclass, s.avgScore ?? "—", s.missingRate, s.enrolledCount]);
      addSheet2("O'quvchilar", hdrs, rows);
      sheetName = "oqvuchillar";
    } else if (exportType === "teachers" && teachers.length > 0) {
      const hdrs = ["Ism", "Email", "Fanlar", "Sinflar soni", "Testlar", "Tekshirilgan", "Kreditlar", "Ishlatilgan kredit"];
      const rows = teachers.map((t: any) => [t.name, t.email, (t.subjects ?? []).join(", "), t.classCount, t.assessmentsCreated, t.submissionsGraded, t.credits, t.creditsUsed]);
      addSheet2("O'qituvchilar", hdrs, rows);
      sheetName = "oqituvchilar";
    } else if (exportType === "issues" && issues.length > 0) {
      const sevMap: Record<string, string> = { critical: "Jiddiy", warning: "Ogohlantirish", info: "Ma'lumot" };
      const hdrs = ["Daraja", "Sarlavha", "Tavsif", "Sinf", "O'qituvchi", "Qiymat"];
      const rows = issues.map((i: any) => [sevMap[i.severity] ?? i.severity, i.title, i.description, i.className ?? "—", i.teacherName ?? "—", i.value]);
      const ws = addSheet2("Muammolar", hdrs, rows);
      const sevColors: Record<string, string> = { "Jiddiy": "FFFFE0E0", "Ogohlantirish": "FFFFF3CD", "Ma'lumot": "FFE8F4FD" };
      ws.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const sevCell = row.getCell(1);
        const bg = sevColors[String(sevCell.value)] || "FFFFFFFF";
        sevCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      });
      sheetName = "muammolar";
    } else if (exportType === "overview" && kpis) {
      const hdrs = ["Ko'rsatkich", "Qiymat"];
      const rows: [string, string | number][] = [
        ["O'tish darajasi (%)", kpis?.passRate ?? "—"],
        ["Topshirmagan darajasi (%)", kpis?.missingRate ?? "—"],
        ["Xavf ostidagi o'quvchilar", kpis?.atRiskCount ?? "—"],
        ["Jami o'quvchilar", kpis?.studentCount ?? "—"],
        ["Jami o'qituvchilar", kpis?.teacherCount ?? "—"],
        ["Jami sinflar", kpis?.classCount ?? "—"],
        ["Jami tekshirilgan ishlar", kpis?.totalGraded ?? "—"],
        ["Jami topshiriqlar", kpis?.totalSubmissions ?? "—"],
      ];
      addSheet2("Umumiy", hdrs, rows);
      sheetName = "umumiy";
    } else if (exportType === "heatmap" && classes.length > 0) {
      // Build grade × subject matrix
      const gradeSet = new Set<number>();
      const subjectSet = new Set<string>();
      const cellAgg = new Map<string, { totalAvg: number; count: number }>();
      for (const cls of classes) {
        if (!cls.subject || cls.avgScore === null) continue;
        const match = (cls.name as string).match(/^(\d+)/);
        const grade = match ? parseInt(match[1]) : null;
        if (!grade) continue;
        gradeSet.add(grade);
        subjectSet.add(cls.subject);
        const key = `${grade}-${cls.subject}`;
        const existing = cellAgg.get(key);
        if (existing) { existing.totalAvg += cls.avgScore; existing.count++; }
        else cellAgg.set(key, { totalAvg: cls.avgScore, count: 1 });
      }
      const sortedGrades = Array.from(gradeSet).sort((a, b) => a - b);
      const sortedSubjects = Array.from(subjectSet).sort();
      const hdrs = ["Sinf", ...sortedSubjects];
      const rows = sortedGrades.map((grade) => [
        `${grade}-sinf` as string | number | null,
        ...sortedSubjects.map((subj) => {
          const cell = cellAgg.get(`${grade}-${subj}`);
          return cell ? Math.round(cell.totalAvg / cell.count) : null;
        }),
      ]);
      const ws = addSheet2("Fan-Sinf", hdrs, rows);
      // Color-code cells
      ws.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        for (let ci = 2; ci <= hdrs.length; ci++) {
          const cell = row.getCell(ci);
          const val = typeof cell.value === "number" ? cell.value : null;
          if (val === null) continue;
          const color = val >= 85 ? "FFD1FAE5" : val >= 70 ? "FFFEF3C7" : "FFFEE2E2";
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
        }
      });
      sheetName = "fan-sinf";
    }

    const buffer2 = await wb2.xlsx.writeBuffer();
    const filename2 = `${schoolName.replace(/\s+/g, "-")}-${sheetName}-${date}.xlsx`;
    return new NextResponse(Buffer.from(buffer2), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename2)}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Maktab Director";
  wb.created = new Date();

  const HEADER_FILL: ExcelJS.Fill = {
    type: "pattern", pattern: "solid", fgColor: { argb: "FFD6E4FA" },
  };
  const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FF1A3A5C" } };
  const HEADER_BORDER: Partial<ExcelJS.Borders> = {
    bottom: { style: "medium", color: { argb: "FF4472C4" } },
  };

  function styleHeader(ws: ExcelJS.Worksheet, colCount: number) {
    const row = ws.getRow(1);
    row.height = 20;
    for (let i = 1; i <= colCount; i++) {
      const cell = row.getCell(i);
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.border = HEADER_BORDER;
      cell.alignment = { vertical: "middle" };
    }
  }

  function autoWidth(ws: ExcelJS.Worksheet, headers: string[], rows: any[][]) {
    ws.columns.forEach((col, i) => {
      let max = String(headers[i] ?? "").length;
      rows.forEach((r) => { max = Math.max(max, String(r[i] ?? "").length); });
      col.width = Math.min(Math.max(max + 2, 10), 50);
    });
  }

  function addSheet(name: string, headers: string[], rows: (string | number | null)[][]) {
    const ws = wb.addWorksheet(name);
    ws.addRow(headers);
    styleHeader(ws, headers.length);
    for (const row of rows) {
      ws.addRow(row.map((v) => v ?? "—"));
    }
    autoWidth(ws, headers, rows);
    return ws;
  }

  // ── Sheet 1: Umumiy (KPI summary) ────────────────────────────────────────
  {
    const ws = wb.addWorksheet("Umumiy");
    const titleRow = ws.addRow([`${schoolName} — Hisobot — ${date}`]);
    titleRow.font = { bold: true, size: 14, color: { argb: "FF1A3A5C" } };
    ws.addRow([]);

    const kpiData: [string, string | number][] = [
      ["O'tish darajasi (%)", kpis?.passRate ?? "—"],
      ["Topshirmagan darajasi (%)", kpis?.missingRate ?? "—"],
      ["Xavf ostidagi o'quvchilar", kpis?.atRiskCount ?? "—"],
      ["Jami o'quvchilar", kpis?.studentCount ?? "—"],
      ["Jami o'qituvchilar", kpis?.teacherCount ?? "—"],
      ["Jami sinflar", kpis?.classCount ?? "—"],
      ["Jami tekshirilgan ishlar", kpis?.totalGraded ?? "—"],
      ["Jami topshiriqlar", kpis?.totalSubmissions ?? "—"],
    ];
    for (const [label, val] of kpiData) {
      const row = ws.addRow([label, val]);
      row.getCell(1).font = { bold: false };
    }

    // Top classes table
    if (kpis?.topImproved?.length > 0) {
      ws.addRow([]);
      const hdr = ws.addRow(["Eng yuqori sinflar", "O'rtacha (%)"]);
      hdr.font = HEADER_FONT;
      hdr.getCell(1).fill = HEADER_FILL;
      hdr.getCell(2).fill = HEADER_FILL;
      for (const c of kpis.topImproved) {
        ws.addRow([c.name, c.avg]);
      }
    }

    ws.getColumn(1).width = 34;
    ws.getColumn(2).width = 40;
  }

  // ── Sheet 2: O'quvchilar ─────────────────────────────────────────────────
  if (students.length > 0) {
    const headers = ["Ism", "Email", "Sinf", "Guruh", "O'rtacha ball (%)", "Topshirmagan (%)", "Yozilgan sinflar"];
    const rows = students.map((s: any) => [
      s.name, s.email, s.grade, s.subclass,
      s.avgScore ?? "—", s.missingRate, s.enrolledCount,
    ]);
    addSheet("O'quvchilar", headers, rows);
  }

  // ── Sheet 3: O'qituvchilar ───────────────────────────────────────────────
  if (teachers.length > 0) {
    const headers = ["Ism", "Email", "Fanlar", "Sinflar soni", "Testlar", "Tekshirilgan", "Kreditlar", "Ishlatilgan kredit"];
    const rows = teachers.map((t: any) => [
      t.name, t.email,
      (t.subjects ?? []).join(", "),
      t.classCount, t.assessmentsCreated, t.submissionsGraded,
      t.credits, t.creditsUsed,
    ]);
    addSheet("O'qituvchilar", headers, rows);
  }

  // ── Sheet 4: Sinflar ─────────────────────────────────────────────────────
  if (classes.length > 0) {
    const headers = ["Sinf nomi", "Fan", "O'qituvchi", "O'quvchilar", "Testlar", "O'rtacha (%)", "Topshirmagan (%)"];
    const rows = classes.map((c: any) => [
      c.name, c.subject ?? "—", c.teacher?.name ?? "—",
      c.studentCount, c.assessmentCount,
      c.avgScore ?? "—", c.missingRate,
    ]);
    addSheet("Sinflar", headers, rows);
  }

  // ── Sheet 5: Muammolar ───────────────────────────────────────────────────
  if (issues.length > 0) {
    const sevMap: Record<string, string> = {
      critical: "Jiddiy",
      warning: "Ogohlantirish",
      info: "Ma'lumot",
    };
    const headers = ["Daraja", "Sarlavha", "Tavsif", "Sinf", "O'qituvchi", "Qiymat"];
    const rows = issues.map((i: any) => [
      sevMap[i.severity] ?? i.severity,
      i.title, i.description,
      i.className ?? "—", i.teacherName ?? "—",
      i.value,
    ]);
    const ws = addSheet("Muammolar", headers, rows);

    // Color-code severity column
    const sevColors: Record<string, string> = {
      "Jiddiy": "FFFFE0E0",
      "Ogohlantirish": "FFFFF3CD",
      "Ma'lumot": "FFE8F4FD",
    };
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const sevCell = row.getCell(1);
      const bg = sevColors[String(sevCell.value)] || "FFFFFFFF";
      sevCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    });
  }

  // ── Sheet 6: Dinamika (monthly performance) ──────────────────────────────
  if (perf?.series?.length > 0 && perf.months?.length > 0) {
    const MONTH_LABELS: Record<string, string> = {
      "01": "Yan", "02": "Fev", "03": "Mar", "04": "Apr",
      "05": "May", "06": "Iyun", "07": "Iyul", "08": "Avg",
      "09": "Sen", "10": "Okt", "11": "Noy", "12": "Dek",
    };
    const monthLabels = perf.months.map((m: string) => {
      const [year, month] = m.split("-");
      return `${MONTH_LABELS[month] || month} ${year}`;
    });

    const ws = wb.addWorksheet("Dinamika");
    ws.addRow(["Sinf / Fan", ...monthLabels]);
    styleHeader(ws, monthLabels.length + 1);
    for (const s of perf.series) {
      ws.addRow([
        s.label,
        ...perf.months.map((m: string) => {
          const pt = s.data.find((d: any) => d.month === m);
          return pt?.avgScore ?? null;
        }),
      ]);
    }
    ws.getColumn(1).width = 30;
    for (let i = 2; i <= perf.months.length + 1; i++) {
      ws.getColumn(i).width = 14;
    }
  }

  // ── Generate buffer ───────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const filename = `${schoolName.replace(/\s+/g, "-")}-hisobot-${date}.xlsx`;

  return new NextResponse(Buffer.from(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      "Cache-Control": "no-store",
    },
  });
}
