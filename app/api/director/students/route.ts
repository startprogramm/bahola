import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { requireDirector } from "@/lib/director/auth";
import { cached, isCacheHit, invalidateByPrefix } from "@/lib/director/server-cache";

/**
 * GET /api/director/students
 * Single SQL query: joins memberships + users + per-student submission stats.
 * No raw row loading — all counting done via SQL GROUP BY.
 * Query: ?grade=8&subclass=B&search=name&skip=0&take=500
 * (grade/subclass support comma-separated lists)
 */
export async function GET(req: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { school } = auth;
  const schoolId = school.id;

  const url = req.nextUrl;
  const gradeFilter   = url.searchParams.get("grade");
  const subclassFilter = url.searchParams.get("subclass");
  const search        = url.searchParams.get("search");
  const skip          = Math.max(0, parseInt(url.searchParams.get("skip") || "0", 10) || 0);
  const take          = Math.min(1000, Math.max(1, parseInt(url.searchParams.get("take") || "500", 10) || 500));

  const grades     = gradeFilter   ? gradeFilter.split(",").map((g) => g.trim()).filter(Boolean) : [];
  const subclasses = subclassFilter ? subclassFilter.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : [];

  const gradeClause    = grades.length     > 0 ? Prisma.sql`AND m.grade    IN (${Prisma.join(grades)})`                  : Prisma.sql``;
  const subclassClause = subclasses.length > 0 ? Prisma.sql`AND UPPER(m.subclass) IN (${Prisma.join(subclasses)})`       : Prisma.sql``;
  const searchClause   = search             ? Prisma.sql`AND u.name ILIKE ${"%" + search + "%"}`                         : Prisma.sql``;

  // Cache key includes params since SQL uses dynamic WHERE clauses
  const cacheKey = `director:students:${schoolId}:${grades.join(",")}:${subclasses.join(",")}:${search || ""}:${skip}:${take}`;

  type StudentRow = {
    id: string;
    name: string;
    email: string;
    grade: string | null;
    subclass: string | null;
    enrolled_count: number;
    graded_count: number;
    pending_count: number;
    total_count: number;
    avg_pct: number | null;
  };

  type FilterRow = { grade: string; subclass: string | null };

  // Always fetch available filters (not affected by current filter params)
  const filterCacheKey = `director:student-filters:${schoolId}`;
  const filters = await cached(filterCacheKey, async () => {
    const filterRows = await prisma.$queryRaw<FilterRow[]>`
      SELECT DISTINCT m.grade, m.subclass
      FROM school_memberships m
      WHERE m."schoolId" = ${schoolId}
        AND m.role = 'STUDENT'
        AND m.status = 'active'
        AND m.grade IS NOT NULL
      ORDER BY m.grade, m.subclass
    `;
    const gradeMap: Record<string, string[]> = {};
    for (const r of filterRows) {
      if (!gradeMap[r.grade]) gradeMap[r.grade] = [];
      if (r.subclass && !gradeMap[r.grade].includes(r.subclass)) {
        gradeMap[r.grade].push(r.subclass);
      }
    }
    return { gradeMap };
  }, 10 * 60_000); // 10 min TTL

  const data = await cached(cacheKey, async () => {
    // Count total matching students (for pagination)
    const countRows = await prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total
      FROM school_memberships m
      JOIN users u ON u.id = m."userId"
      WHERE m."schoolId" = ${schoolId}
        AND m.role       = 'STUDENT'
        AND m.status     = 'active'
        ${gradeClause}
        ${subclassClause}
        ${searchClause}
    `;
    const total = countRows[0]?.total ?? 0;

    const rows = await prisma.$queryRaw<StudentRow[]>`
      SELECT
        u.id,
        u.name,
        u.email,
        m.grade,
        m.subclass,
        (SELECT COUNT(*)::int FROM enrollments e WHERE e."studentId" = u.id) AS enrolled_count,
        COALESCE(st.graded_count, 0) AS graded_count,
        COALESCE(st.pending_count, 0) AS pending_count,
        COALESCE(st.total_count,  0)  AS total_count,
        st.avg_pct
      FROM school_memberships m
      JOIN users u ON u.id = m."userId"
      LEFT JOIN (
        SELECT
          s."studentId",
          COUNT(CASE WHEN s.status = 'GRADED' AND s."maxScore" > 0 THEN 1 END)::int AS graded_count,
          COUNT(CASE WHEN s.status = 'PENDING' THEN 1 END)::int                      AS pending_count,
          COUNT(s.id)::int                                                            AS total_count,
          AVG(CASE WHEN s.status = 'GRADED' AND s."maxScore" > 0
                   THEN s.score::float / s."maxScore" END)                            AS avg_pct
        FROM submissions s
        JOIN assessments a ON a.id = s."assessmentId"
        JOIN classes c     ON c.id = a."classId" AND c."schoolId" = ${schoolId}
        GROUP BY s."studentId"
      ) st ON st."studentId" = u.id
      WHERE m."schoolId" = ${schoolId}
        AND m.role       = 'STUDENT'
        AND m.status     = 'active'
        ${gradeClause}
        ${subclassClause}
        ${searchClause}
      ORDER BY u.name
      LIMIT ${take} OFFSET ${skip}
    `;

    return {
      students: rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        grade: r.grade,
        subclass: r.subclass,
        enrolledCount: r.enrolled_count,
        avgScore: r.avg_pct !== null ? Math.round(r.avg_pct * 100) : null,
        missingRate: r.total_count > 0 ? Math.round((r.pending_count / r.total_count) * 100) : 0,
      })),
      total,
      filters: filters.gradeMap,
    };
  }, 2 * 60_000); // 2 min TTL

  const response = NextResponse.json(data);
  response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=120");
  response.headers.set("X-Data-Cache", isCacheHit(cacheKey) ? "HIT" : "MISS");
  return response;
}

/**
 * POST /api/director/students
 * Create a new student with auto-generated credentials.
 * Body: { name, grade?, subclass?, classIds?: string[] }
 */
export async function POST(req: NextRequest) {
  const auth = await requireDirector();
  if ("error" in auth) return auth.error;
  const { school } = auth;

  const body = await req.json();
  const { name, grade, subclass, classIds } = body;

  if (!name || !name.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // Generate email: firstname.lastname.grade@school-code.maktab.uz
  const cleanName = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, ".");
  const schoolCode = school.code?.toLowerCase() || "school";
  const suffix = Math.floor(Math.random() * 900 + 100); // 3-digit random
  const email = `${cleanName}.${suffix}@${schoolCode}.maktab.uz`;

  // Generate random password (8 chars)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const rawPassword = Array.from({ length: 8 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
  const hashedPassword = await bcrypt.hash(rawPassword, 10);

  // Check if email already exists
  const existingUser = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });

  if (existingUser) {
    return NextResponse.json(
      { error: "Bu email allaqachon mavjud. Qayta urinib ko'ring." },
      { status: 409 }
    );
  }

  // Create user
  const student = await prisma.user.create({
    data: {
      name: name.trim(),
      email,
      password: hashedPassword,
      role: "STUDENT",
      schoolId: school.id,
      credits: 0,
    },
  });

  // Create school membership
  await prisma.schoolMembership.create({
    data: {
      userId: student.id,
      schoolId: school.id,
      role: "STUDENT",
      status: "active",
      grade: grade || null,
      subclass: subclass || null,
    },
  });

  // Enroll in specified classes
  if (classIds && classIds.length > 0) {
    for (const classId of classIds) {
      try {
        await prisma.enrollment.create({
          data: { studentId: student.id, classId },
        });
      } catch {
        // Already enrolled or class doesn't exist — skip
      }
    }
  }

  // Invalidate caches affected by new student
  invalidateByPrefix(`director:students:${school.id}`);
  invalidateByPrefix(`director:kpis:${school.id}`);

  return NextResponse.json(
    {
      student: {
        id: student.id,
        name: student.name,
        email: student.email,
      },
      credentials: {
        email,
        password: rawPassword,
      },
    },
    { status: 201 }
  );
}
