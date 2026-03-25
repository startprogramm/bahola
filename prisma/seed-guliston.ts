/**
 * seed-guliston.ts — Populates the database with the real Guliston Presidential School.
 *
 * Run:  npx tsx prisma/seed-guliston.ts
 *
 * Creates:
 *   - 1 School "Guliston shahridagi Prezident maktabi"
 *   - 1 Director (Isoqjonov Daler Asatullayevich)
 *   - ~29 Teachers (real names from schedule)
 *   - 164 Students (real names, Blue/Green division)
 *   - Classes per grade-division-subject (with dual teacher support)
 *   - Optional subject classes for grades 10-11
 *   - SchoolMemberships, Enrollments
 *
 * Does NOT create fake assessments or submissions.
 * Does NOT touch the existing Demo Maktab #1.
 */

import { PrismaClient, Role, SubscriptionTier } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

// ── Connection setup ──
function getSeedUrl(): string {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}connection_limit=1`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: getSeedUrl() } },
});

// ── Load extracted data ──
const DATA_PATH = path.join(__dirname, "seed-guliston-data.json");
const seedData = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));

const studentsByClass: Record<string, string[]> = seedData.students_by_class;
const classTeachers: Record<string, Record<string, { name: string; source: string }[]>> = seedData.class_teachers;
const optionalGroups: { grade: number; subject: string; student_count: number; students: string[]; teachers: { name: string; source: string }[] }[] = seedData.optional_groups;
const avatarFiles: string[] = seedData.avatar_files;
const STEM_SUBJECTS_10_11: string[] = seedData.stem_subjects_10_11 || [];

// ── Constants ──
const SCHOOL_NAME = "Guliston shahridagi Prezident maktabi";
const SCHOOL_CODE = "PMGUL2025";
const HASH_ROUNDS = 10;
const EMAIL_DOMAIN = "guliston.pm.uz";

// Build avatar lookup: normalized name -> filename
const avatarMap = new Map<string, string>();
for (const f of avatarFiles) {
  // filename: grade10_Abdujalilov_Asrorbek_Abror_ogli.jpg
  const withoutExt = f.replace(/\.\w+$/, "");
  const parts = withoutExt.split("_");
  // Remove grade prefix, rejoin
  const namePart = parts.slice(1).join("_").toLowerCase();
  avatarMap.set(namePart, f);
}

function findAvatar(studentName: string, grade: string): string | null {
  // Try to match by building the same key format used in extraction
  const safe = studentName
    .replace(/\s+/g, "_")
    .replace(/[''`]/g, "")
    .replace(/[^a-zA-Z0-9_\u0400-\u04FF\u0027]/g, "");
  const safeClean = safe.replace(/[^a-zA-Z0-9_]/g, "");
  const key = `grade${grade}_${safeClean}`.toLowerCase();

  // Direct match
  for (const [k, v] of avatarMap) {
    if (`grade${grade}_${k}` === key) return `/uploads/avatars/${v}`;
  }

  // Fuzzy: check if avatar key starts with the first two name parts
  const nameParts = studentName.split(/\s+/).slice(0, 2).map(p =>
    p.replace(/[''`]/g, "").replace(/[^a-zA-Z0-9\u0400-\u04FF]/g, "").toLowerCase()
  );
  if (nameParts.length >= 2) {
    const prefix = `grade${grade}_${nameParts[0]}_${nameParts[1]}`.toLowerCase();
    for (const [k, v] of avatarMap) {
      if (`grade${grade}_${k}`.startsWith(prefix)) return `/uploads/avatars/${v}`;
    }
  }

  return null;
}

function generateEmail(name: string, index: number, role: string): string {
  // Create email from name: first letter of first name + last name
  const parts = name.split(/\s+/);
  if (parts.length >= 2) {
    const first = parts[0].toLowerCase()
      .replace(/[''`]/g, "").replace(/[^a-z]/g, "");
    const last = parts[1].toLowerCase()
      .replace(/[''`]/g, "").replace(/[^a-z]/g, "");
    return `${first}.${last}@${EMAIL_DOMAIN}`;
  }
  return `${role}${index}@${EMAIL_DOMAIN}`;
}

// Map "5 - Blue" format (from teacher file) to "5-Blue" (from student file)
function normalizeClassKey(cls: string): { grade: string; division: string } {
  // "5 - Blue" or "10 - Green"
  const match = cls.match(/(\d+)\s*-\s*(Blue|Green)/i);
  if (match) return { grade: match[1], division: match[2] };
  return { grade: "0", division: "Unknown" };
}

// ── Main ──
async function main() {
  console.log("🏫  Seeding Guliston Presidential School...\n");

  await doCleanup();

  console.log("🔒  Starting transaction...\n");
  await prisma.$transaction(async (tx) => {
    await doSeed(tx);
  }, {
    maxWait: 30000,
    timeout: 600000, // 10 min
  });

  console.log("\n✅  Seed complete!");
}

async function doCleanup() {
  // Clean up any existing data for this school
  const existing = await prisma.school.findUnique({ where: { code: SCHOOL_CODE } });
  if (!existing) {
    // Also check by email domain
    const domainUsers = await prisma.user.findMany({
      where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
      select: { id: true },
    });
    if (domainUsers.length > 0) {
      console.log(`⚠️  Cleaning up ${domainUsers.length} @${EMAIL_DOMAIN} users...`);
      const ids = domainUsers.map(u => u.id);
      await prisma.creditTransaction.deleteMany({ where: { userId: { in: ids } } });
      await prisma.submission.deleteMany({ where: { studentId: { in: ids } } });
      await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
      await prisma.schoolMembership.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    return;
  }

  console.log(`⚠️  Cleaning up existing ${SCHOOL_NAME}...`);
  const schoolId = existing.id;

  await prisma.school.update({ where: { id: schoolId }, data: { directorId: null } }).catch(() => {});
  await prisma.creditTransaction.deleteMany({ where: { user: { schoolId } } });
  await prisma.submission.deleteMany({ where: { assessment: { class: { schoolId } } } });
  await prisma.assessment.deleteMany({ where: { class: { schoolId } } });
  await prisma.enrollment.deleteMany({ where: { class: { schoolId } } });
  await prisma.class.deleteMany({ where: { schoolId } });
  await prisma.schoolMembership.deleteMany({ where: { schoolId } });
  await prisma.user.deleteMany({ where: { schoolId } });
  await prisma.school.delete({ where: { id: schoolId } }).catch(() => {});

  // Clean any remaining domain users
  const remaining = await prisma.user.findMany({
    where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
    select: { id: true },
  });
  if (remaining.length > 0) {
    const ids = remaining.map(u => u.id);
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  console.log("   Old data deleted.\n");
}

async function doSeed(prisma: Parameters<Parameters<typeof import("@prisma/client").PrismaClient.prototype.$transaction>[0]>[0]) {

  // ── 1. Hash passwords ──
  console.log("🔑  Hashing passwords...");
  const [directorHash, teacherHash, studentHash] = await Promise.all([
    bcrypt.hash("Direktor2025!", HASH_ROUNDS),
    bcrypt.hash("Teacher2025!", HASH_ROUNDS),
    bcrypt.hash("Student2025!", HASH_ROUNDS),
  ]);

  // ── 2. Create School ──
  console.log("🏫  Creating school...");
  const school = await (prisma as any).school.create({
    data: {
      name: SCHOOL_NAME,
      code: SCHOOL_CODE,
      address: "Guliston shahri, Sirdaryo viloyati",
      phone: "+998 67 225 00 00",
      email: `info@${EMAIL_DOMAIN}`,
      isActive: true,
    },
  });

  // ── 3. Create Director ──
  console.log("👤  Creating director...");
  const director = await (prisma as any).user.create({
    data: {
      name: "Isoqjonov Daler Asatullayevich",
      email: `direktor@${EMAIL_DOMAIN}`,
      password: directorHash,
      role: Role.DIRECTOR,
      schoolId: school.id,
      subscription: SubscriptionTier.PRO,
      credits: 99999,
      language: "uz",
      feedbackLanguage: "uz",
    },
  });

  await (prisma as any).school.update({
    where: { id: school.id },
    data: { directorId: director.id },
  });

  await (prisma as any).schoolMembership.create({
    data: {
      userId: director.id,
      schoolId: school.id,
      role: Role.DIRECTOR,
      status: "active",
    },
  });

  // ── 4. Create Teachers ──
  // Collect all unique teacher names across all classes
  const allTeacherNames = new Set<string>();
  for (const cls of Object.values(classTeachers)) {
    for (const teachers of Object.values(cls)) {
      for (const t of teachers) {
        allTeacherNames.add(t.name);
      }
    }
  }
  // Also from optional groups
  for (const og of optionalGroups) {
    for (const t of og.teachers) {
      allTeacherNames.add(t.name);
    }
  }

  console.log(`👨‍🏫  Creating ${allTeacherNames.size} teachers...`);
  const teacherIdMap = new Map<string, string>(); // name -> userId
  const usedEmails = new Set<string>();
  let teacherIdx = 0;

  for (const name of allTeacherNames) {
    teacherIdx++;
    let email = generateEmail(name, teacherIdx, "teacher");
    // Ensure unique
    while (usedEmails.has(email)) {
      email = `teacher${teacherIdx}x@${EMAIL_DOMAIN}`;
      teacherIdx++;
    }
    usedEmails.add(email);

    const teacher = await (prisma as any).user.create({
      data: {
        name,
        email,
        password: teacherHash,
        role: Role.TEACHER,
        schoolId: school.id,
        subscription: SubscriptionTier.PRO,
        credits: 99999,
        language: "uz",
        feedbackLanguage: "uz",
      },
    });
    teacherIdMap.set(name, teacher.id);

    await (prisma as any).schoolMembership.create({
      data: {
        userId: teacher.id,
        schoolId: school.id,
        role: Role.TEACHER,
        status: "active",
      },
    });
  }

  // ── 5. Create Students ──
  const totalStudents = Object.values(studentsByClass).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`🧑‍🎓  Creating ${totalStudents} students...`);

  const studentIdMap = new Map<string, string>(); // "grade-division-name" -> userId
  const studentIdByName = new Map<string, string>(); // name -> userId (for optional groups)
  let studentIdx = 0;
  const studentUsedEmails = new Set<string>();

  for (const [classKey, names] of Object.entries(studentsByClass)) {
    const [grade, division] = classKey.split("-");

    for (const name of names) {
      studentIdx++;
      let email = generateEmail(name, studentIdx, "student");
      while (studentUsedEmails.has(email) || usedEmails.has(email)) {
        email = `student${studentIdx}x@${EMAIL_DOMAIN}`;
        studentIdx++;
      }
      studentUsedEmails.add(email);

      const avatar = findAvatar(name, grade);

      const student = await (prisma as any).user.create({
        data: {
          name,
          email,
          password: studentHash,
          role: Role.STUDENT,
          schoolId: school.id,
          subscription: SubscriptionTier.FREE,
          credits: 50,
          language: "uz",
          feedbackLanguage: "uz",
          isPlaceholder: true,
          ...(avatar ? { avatar } : {}),
        },
      });

      const mapKey = `${grade}-${division}-${name}`;
      studentIdMap.set(mapKey, student.id);
      studentIdByName.set(name, student.id);

      await (prisma as any).schoolMembership.create({
        data: {
          userId: student.id,
          schoolId: school.id,
          role: Role.STUDENT,
          status: "active",
          grade,
          subclass: division,
        },
      });
    }
  }
  console.log(`   ✓ ${studentIdx} students created`);

  // ── 6. Create Classes & Enrollments ──
  // For each grade-division, create one class per subject
  // Each class has the first teacher as owner, additional teachers noted in description
  console.log("📚  Creating classes...");

  const SUBJECT_COLORS: Record<string, string> = {
    "Math": "#2563eb",
    "Science": "#059669",
    "English": "#7c3aed",
    "English language": "#7c3aed",
    "History": "#d97706",
    "Adabiyot": "#be185d",
    "Ona tili": "#be185d",
    "Chemistry": "#dc2626",
    "Biology": "#059669",
    "Biology/Combined Science": "#059669",
    "Physics": "#4f46e5",
    "Geography": "#0891b2",
    "Computer Science": "#6366f1",
    "ART": "#f59e0b",
    "Character education": "#14b8a6",
    "Global perspective": "#8b5cf6",
    "Russian language": "#64748b",
    "ICT": "#6366f1",
    "Economics": "#eab308",
  };

  let classCount = 0;
  let enrollmentCount = 0;
  let classCodeCounter = 2000;

  // Build lookup from optional groups: "grade-subject" -> student names
  // Used to enroll only subject-choosers into grade 10-11 STEM classes
  const optionalStudentsBySubject = new Map<string, string[]>();
  for (const og of optionalGroups) {
    const key = `${og.grade}-${og.subject}`;
    optionalStudentsBySubject.set(key, og.students);
  }

  // Helper: find student ID by name with fuzzy matching
  function findStudentId(studentName: string): string | undefined {
    // Exact match
    let id = studentIdByName.get(studentName);
    if (id) return id;

    // Fuzzy: first+last name
    const parts = studentName.split(/\s+/).slice(0, 2).map(p => p.toLowerCase());
    if (parts.length >= 2) {
      for (const [name, sid] of studentIdByName) {
        const nameParts = name.split(/\s+/).slice(0, 2).map(p => p.toLowerCase());
        if (nameParts.length >= 2 && parts[0] === nameParts[0] && parts[1] === nameParts[1]) {
          return sid;
        }
      }
    }

    // Fuzzy: just last name
    const lastName = studentName.split(/\s+/)[0]?.toLowerCase();
    if (lastName) {
      for (const [name, sid] of studentIdByName) {
        if (name.split(/\s+/)[0]?.toLowerCase() === lastName) {
          return sid;
        }
      }
    }

    return undefined;
  }

  // Track STEM classes already created for grades 10-11 (to avoid duplicates)
  // For grades 10-11, STEM subjects get ONE mixed class with ONLY the students
  // who chose that subject (from optional_groups), not all students.
  // Non-STEM subjects get separate Blue/Green classes.
  const createdStemClasses = new Set<string>(); // "grade-subject"

  // Process base classes (per division)
  for (const [teacherClassKey, subjects] of Object.entries(classTeachers)) {
    const { grade, division } = normalizeClassKey(teacherClassKey);
    if (grade === "0") continue;

    const gradeNum = parseInt(grade);
    const studentClassKey = `${grade}-${division}`;
    const classStudents = studentsByClass[studentClassKey] || [];

    for (const [subject, teachers] of Object.entries(subjects)) {
      if (teachers.length === 0) continue;

      const isStem1011 = gradeNum >= 10 && STEM_SUBJECTS_10_11.includes(subject);

      // For grade 10-11 STEM: create one mixed class, skip if already created
      if (isStem1011) {
        const stemKey = `${grade}-${subject}`;
        if (createdStemClasses.has(stemKey)) {
          continue; // Already created from the other division
        }
        createdStemClasses.add(stemKey);
      }

      const primaryTeacher = teachers[0];
      const primaryTeacherId = teacherIdMap.get(primaryTeacher.name);
      if (!primaryTeacherId) {
        console.error(`   Missing teacher: ${primaryTeacher.name}`);
        continue;
      }

      // Collect all teachers from both divisions for STEM
      let allTeachers = [...teachers];
      if (isStem1011) {
        const otherDiv = division === "Blue" ? "Green" : "Blue";
        const otherKey = `${grade} - ${otherDiv}`;
        const otherSubjects = classTeachers[otherKey];
        if (otherSubjects && otherSubjects[subject]) {
          for (const t of otherSubjects[subject]) {
            if (!allTeachers.some(at => at.name === t.name)) {
              allTeachers.push(t);
            }
          }
        }
      }

      const teacherDesc = allTeachers
        .map(t => `${t.name} (${t.source})`)
        .join(", ");

      const className = isStem1011
        ? `${grade}-sinf ${subject}`
        : `${grade}-${division} ${subject}`;
      const code = `PM${String(classCodeCounter++).padStart(4, "0")}`;

      // Determine enrollment list for STEM 10-11
      const stemOptKey = `${grade}-${subject}`;
      const stemStudentNames = isStem1011 ? optionalStudentsBySubject.get(stemOptKey) : null;

      const cls = await (prisma as any).class.create({
        data: {
          name: className,
          code,
          subject,
          description: isStem1011
            ? `${subject}, ${grade}-sinf (Blue+Green) | ${teacherDesc}`
            : `${subject}, ${grade}-sinf ${division} | ${teacherDesc}`,
          teacherId: primaryTeacherId,
          schoolId: school.id,
          headerColor: SUBJECT_COLORS[subject] || "#6b7280",
          bannerStyle: String((classCount % 7) + 1),
        },
      });
      classCount++;

      if (isStem1011 && stemStudentNames) {
        // Enroll ONLY students who chose this subject (from optional groups)
        for (const studentName of stemStudentNames) {
          const studentId = findStudentId(studentName);
          if (studentId) {
            await (prisma as any).enrollment.create({
              data: { studentId, classId: cls.id },
            }).catch(() => {});
            enrollmentCount++;
          } else {
            console.warn(`   ⚠ STEM class: could not match "${studentName}" for ${stemOptKey}`);
          }
        }
      } else if (isStem1011) {
        // No optional group data for this subject — enroll all as fallback
        console.warn(`   ⚠ No optional group data for ${stemOptKey}, enrolling all students`);
        const blueStudents = studentsByClass[`${grade}-Blue`] || [];
        const greenStudents = studentsByClass[`${grade}-Green`] || [];
        for (const studentName of [...blueStudents, ...greenStudents]) {
          const blueKey = `${grade}-Blue-${studentName}`;
          const greenKey = `${grade}-Green-${studentName}`;
          const studentId = studentIdMap.get(blueKey) || studentIdMap.get(greenKey);
          if (studentId) {
            await (prisma as any).enrollment.create({
              data: { studentId, classId: cls.id },
            }).catch(() => {});
            enrollmentCount++;
          }
        }
      } else {
        // Non-STEM: enroll only this division's students
        for (const studentName of classStudents) {
          const studentKey = `${grade}-${division}-${studentName}`;
          const studentId = studentIdMap.get(studentKey);
          if (studentId) {
            await (prisma as any).enrollment.create({
              data: { studentId, classId: cls.id },
            }).catch(() => {});
            enrollmentCount++;
          }
        }
      }
    }
  }
  console.log(`   ✓ ${classCount} base classes created`);
  console.log(`   ✓ ${enrollmentCount} enrollments created`);

  // ── 7. Create Optional Subject Classes (grades 10-11) ──
  // Only create optional classes for subjects that DON'T already have a base STEM class
  console.log("📋  Creating optional subject classes...");
  let optClassCount = 0;
  let optEnrollCount = 0;

  for (const og of optionalGroups) {
    if (og.teachers.length === 0) continue;

    // Skip if this subject already has a base STEM class
    const stemKey = `${og.grade}-${og.subject}`;
    if (createdStemClasses.has(stemKey)) {
      console.log(`   ↳ Skipping optional "${og.grade} ${og.subject}" — already a base STEM class`);
      continue;
    }

    const primaryTeacher = og.teachers[0];
    const primaryTeacherId = teacherIdMap.get(primaryTeacher.name);
    if (!primaryTeacherId) {
      console.error(`   Missing optional teacher: ${primaryTeacher.name}`);
      continue;
    }

    const teacherDesc = og.teachers
      .map(t => `${t.name} (${t.source})`)
      .join(", ");

    const className = `${og.grade} ${og.subject} (tanlov)`;
    const code = `PM${String(classCodeCounter++).padStart(4, "0")}`;

    const cls = await (prisma as any).class.create({
      data: {
        name: className,
        code,
        subject: og.subject,
        description: `${og.subject} tanlov fani, ${og.grade}-sinf | ${teacherDesc}`,
        teacherId: primaryTeacherId,
        schoolId: school.id,
        headerColor: SUBJECT_COLORS[og.subject] || "#6b7280",
        bannerStyle: String((optClassCount % 7) + 1),
      },
    });
    optClassCount++;

    for (const studentName of og.students) {
      const studentId = findStudentId(studentName);

      if (studentId) {
        await (prisma as any).enrollment.create({
          data: { studentId, classId: cls.id },
        }).catch(() => {}); // skip duplicates
        optEnrollCount++;
      } else {
        console.warn(`   ⚠ Could not match optional student: "${studentName}" (${og.grade} ${og.subject})`);
      }
    }
  }
  console.log(`   ✓ ${optClassCount} optional classes created`);
  console.log(`   ✓ ${optEnrollCount} optional enrollments created`);

  // ── Summary ──
  const totalClasses = classCount + optClassCount;
  const totalEnroll = enrollmentCount + optEnrollCount;
  console.log("\n📊  Summary:");
  console.log(`   School: ${SCHOOL_NAME} (code: ${SCHOOL_CODE})`);
  console.log(`   Director: direktor@${EMAIL_DOMAIN} / Direktor2025!`);
  console.log(`   Teachers: ${allTeacherNames.size} (password: Teacher2025!)`);
  console.log(`   Students: ${totalStudents} (password: Student2025!)`);
  console.log(`   Classes: ${totalClasses} (${classCount} base + ${optClassCount} optional)`);
  console.log(`   Enrollments: ${totalEnroll}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error("❌  Seed failed:", e);
    prisma.$disconnect();
    process.exit(1);
  });
