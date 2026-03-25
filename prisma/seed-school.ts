/**
 * seed-school.ts — Populates the database with a complete demo school.
 *
 * Run:  npx tsx prisma/seed-school.ts
 *
 * Creates:
 *   - 1 School "Demo Maktab #1"
 *   - 1 Director + 16 Teachers (1 per subject × 2 grade bands) + 440 Students
 *   - 88 Classes (11 grades × 8 subjects)
 *   - ~1,056 Assessments (12 per class: 4/year × 3 years: 2023-2025)
 *   - ~42,000 Submissions with realistic score distributions
 *   - SchoolMemberships with grade/subclass, Enrollments, CreditTransactions
 *
 * Score philosophy:
 *   - Most classes perform well (avg 75-95%), matching 85% pass threshold
 *   - Grade 8 has intentionally lower scores to create realistic issues
 *   - Other grades are mostly seamless
 */

import { PrismaClient, Role, SubscriptionTier, AssessmentStatus, SubmissionStatus, TransactionType } from "@prisma/client";
import bcrypt from "bcryptjs";

// Use DIRECT_URL (session-mode pooler, port 5432) with connection_limit=1
// to force all queries through a single connection. This prevents Supavisor
// from routing queries to different backend connections, which was causing
// FK constraint violations during long-running seed operations.
function getSeedUrl(): string {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}connection_limit=1`;
}

const databaseUrl = getSeedUrl();
const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
});

// ---------------------------------------------------------------------------
// Deterministic PRNG (Mulberry32) so re-runs produce the same data
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20250220);
function randInt(min: number, max: number) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SCHOOL_NAME = "Demo Maktab #1";
const SCHOOL_CODE = "DEMO2025";
const HASH_ROUNDS = 10;

const SUBJECTS = [
  "Matematika",
  "Fizika",
  "Kimyo",
  "Biologiya",
  "Ona tili",
  "Adabiyot",
  "Geografiya",
  "Tarix",
] as const;

const SUBCLASSES = ["A", "B", "C", "D"] as const;
const GRADES = Array.from({ length: 11 }, (_, i) => i + 1) as unknown as readonly number[];
const STUDENTS_PER_SUBCLASS = 10;

// 16 teachers — each teaches exactly ONE subject
// teacher1-8: grades 1-6
// teacher9-16: grades 7-11
const TEACHER_DATA = [
  // Lower grades (1-6)
  { name: "Anvar Toshmatov", email: "teacher1@maktab.uz", subject: "Matematika", grades: "1-6" },
  { name: "Barno Rahimova", email: "teacher2@maktab.uz", subject: "Fizika", grades: "1-6" },
  { name: "Charos Aliyeva", email: "teacher3@maktab.uz", subject: "Kimyo", grades: "1-6" },
  { name: "Dilshod Yusupov", email: "teacher4@maktab.uz", subject: "Biologiya", grades: "1-6" },
  { name: "Eldor Ergashev", email: "teacher5@maktab.uz", subject: "Ona tili", grades: "1-6" },
  { name: "Farangiz Mirzayeva", email: "teacher6@maktab.uz", subject: "Adabiyot", grades: "1-6" },
  { name: "Gayrat Nazarov", email: "teacher7@maktab.uz", subject: "Geografiya", grades: "1-6" },
  { name: "Hayot Sobirov", email: "teacher8@maktab.uz", subject: "Tarix", grades: "1-6" },
  // Upper grades (7-11)
  { name: "Islom Umarov", email: "teacher9@maktab.uz", subject: "Matematika", grades: "7-11" },
  { name: "Jasur Xolmatov", email: "teacher10@maktab.uz", subject: "Fizika", grades: "7-11" },
  { name: "Kamol Abdullayev", email: "teacher11@maktab.uz", subject: "Kimyo", grades: "7-11" },
  { name: "Laziz Botirov", email: "teacher12@maktab.uz", subject: "Biologiya", grades: "7-11" },
  { name: "Mansur Davlatov", email: "teacher13@maktab.uz", subject: "Ona tili", grades: "7-11" },
  { name: "Nilufar Eshmatova", email: "teacher14@maktab.uz", subject: "Adabiyot", grades: "7-11" },
  { name: "Ozoda Fayzullayeva", email: "teacher15@maktab.uz", subject: "Geografiya", grades: "7-11" },
  { name: "Parizod Gafurova", email: "teacher16@maktab.uz", subject: "Tarix", grades: "7-11" },
];

function getTeacherIndex(subject: string, grade: number): number {
  const subjectIndex = SUBJECTS.indexOf(subject as any);
  if (subjectIndex === -1) return 0;
  return grade <= 6 ? subjectIndex : subjectIndex + 8;
}

// Uzbek first/last names
const FIRST_NAMES = [
  "Aziz", "Bekzod", "Doniyor", "Firdavs", "Jamshid",
  "Khusan", "Mirzo", "Nodir", "Otabek", "Sardor",
  "Ulugbek", "Vohid", "Xurshid", "Zafar", "Bobur",
  "Anvar", "Dilshod", "Eldor", "Gayrat", "Hayot",
  "Islom", "Jasur", "Kamol", "Laziz", "Mansur",
  "Nilufar", "Ozoda", "Parizod", "Qizlarhon", "Robiya",
  "Sabohat", "Tabassum", "Umida", "Venera", "Xilola",
  "Yulduz", "Zulfiya", "Barno", "Charos", "Dilorom",
];
const LAST_NAMES = [
  "Karimov", "Toshmatov", "Rahimov", "Aliyev", "Yusupov",
  "Ergashev", "Mirzayev", "Nazarov", "Sobirov", "Umarov",
  "Xolmatov", "Abdullayev", "Botirov", "Davlatov", "Eshmatov",
  "Fayzullayev", "Gafurov", "Hamidov", "Ismoilov", "Jurayev",
];

function randomName(index: number): string {
  const first = FIRST_NAMES[index % FIRST_NAMES.length];
  const last = LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length];
  return `${first} ${last}`;
}

// ---------------------------------------------------------------------------
// Mark scheme templates for demo assessments
// ---------------------------------------------------------------------------
const MARK_SCHEMES: Record<string, string[]> = {
  Matematika: [
    "1. 2x + 3 = 11, x = 4 (2 marks)\n2. Area of triangle = 1/2 × base × height = 1/2 × 6 × 4 = 12 cm² (3 marks)\n3. Solve: 3x² - 12 = 0, x = ±2 (3 marks)",
    "1. 15 + 27 = 42 (1 mark)\n2. 3/4 + 1/2 = 5/4 (2 marks)\n3. Find perimeter of rectangle 5cm × 3cm = 16cm (2 marks)",
  ],
  Fizika: [
    "1. F = ma, F = 5 × 2 = 10N (2 marks)\n2. v = s/t, v = 100/10 = 10 m/s (2 marks)\n3. KE = 1/2mv² = 1/2 × 2 × 5² = 25J (3 marks)",
    "1. Ohm's law: V = IR (1 mark)\n2. Calculate resistance: R = V/I = 12/3 = 4Ω (2 marks)",
  ],
  Kimyo: [
    "1. H2O - water molecule, 2 hydrogen + 1 oxygen (2 marks)\n2. Balance: 2Na + Cl2 → 2NaCl (2 marks)\n3. pH < 7 is acidic, pH > 7 is basic (2 marks)",
    "1. Atomic number of Carbon = 6 (1 mark)\n2. Electron configuration of Na: 2,8,1 (2 marks)",
  ],
  Biologiya: [
    "1. Photosynthesis equation: 6CO2 + 6H2O → C6H12O6 + 6O2 (3 marks)\n2. Mitosis produces 2 identical cells (2 marks)\n3. DNA structure: double helix (2 marks)",
    "1. Parts of a cell: nucleus, cytoplasm, membrane (3 marks)\n2. Function of mitochondria: energy production / ATP (2 marks)",
  ],
  "Ona tili": [
    "1. Gap tarkibi: ega, kesim, to'ldiruvchi (3 marks)\n2. Fe'l zamonlari: o'tgan, hozirgi, kelasi (3 marks)",
    "1. Imlo qoidalari: bosh harf qoidasi (2 marks)\n2. So'z turkumlari: ot, sifat, fe'l, ravish (4 marks)",
  ],
  Adabiyot: [
    "1. Alisher Navoiy - 'Xamsa' asarining muallifi (2 marks)\n2. She'r vaznlari: aruz, barmoq (2 marks)\n3. Badiiy tasvir vositalari: o'xshatish, mubolag'a (3 marks)",
    "1. Abdulla Qahhor hikoyalari (2 marks)\n2. Adabiy tur va janrlar (3 marks)",
  ],
  Geografiya: [
    "1. O'zbekiston poytaxti - Toshkent (1 mark)\n2. Amudaryo va Sirdaryo - asosiy daryolar (2 marks)\n3. Iqlim zonalari: tropik, mo'tadil, arktik (3 marks)",
    "1. Materiklar soni - 7 (1 mark)\n2. Eng baland cho'qqi - Everest 8848m (2 marks)",
  ],
  Tarix: [
    "1. Amir Temur - 1336-1405 yillar (2 marks)\n2. Mustaqillik kuni - 1991-yil 1-sentabr (2 marks)\n3. Buyuk Ipak yo'li - Sharq va G'arbni bog'lagan savdo yo'li (3 marks)",
    "1. Ikkinchi jahon urushi - 1939-1945 (2 marks)\n2. O'zbekiston Respublikasi Konstitutsiyasi - 1992-yil 8-dekabr (2 marks)",
  ],
};

// 8 assessments per year: 4 homework + 4 tests, spread across school months
// Years: 2023, 2024, 2025
const ACADEMIC_YEARS = [2023, 2024, 2025] as const;
const ASSESSMENTS_PER_YEAR = 4; // 2 homework + 2 tests
// School months (approximate)
const SCHOOL_MONTHS = [10, 12, 3, 5];

function getAssessmentTitle(subject: string, grade: number, yearIdx: number, aIdxInYear: number): string {
  const hwNum = Math.floor(aIdxInYear / 2) + 1;
  const isHomework = aIdxInYear % 2 === 0;
  return `${grade}-sinf ${subject} — ${isHomework ? "Uy ishi" : "Test"} #${hwNum}`;
}

function getAssessmentDate(year: number, monthIdx: number): Date {
  const month = SCHOOL_MONTHS[monthIdx];
  // For months Jan-May, use the next calendar year (school year spans Sep-May)
  const calendarYear = month <= 6 ? year + 1 : year;
  const day = 10 + randInt(0, 15); // between 10th and 25th
  return new Date(calendarYear, month - 1, day);
}

// ---------------------------------------------------------------------------
// Score distribution per grade
// Grade 8 is the "problem" grade — lower scores, more missing, more issues
// All other grades are high-performing (seamless)
// ---------------------------------------------------------------------------
function getScoreRange(grade: number, subclass: string): { min: number; max: number } {
  if (grade === 8) {
    // Grade 8: intentionally lower
    switch (subclass) {
      case "A": return { min: 55, max: 85 };
      case "B": return { min: 40, max: 70 };
      case "C": return { min: 25, max: 55 };
      case "D": return { min: 15, max: 45 };
      default: return { min: 30, max: 60 };
    }
  }

  // All other grades: high performing
  switch (subclass) {
    case "A": return { min: 85, max: 100 };
    case "B": return { min: 75, max: 95 };
    case "C": return { min: 65, max: 90 };
    case "D": return { min: 60, max: 85 };
    default: return { min: 70, max: 90 };
  }
}

function getMissingRate(grade: number): number {
  // Grade 8: ~20% missing submissions
  if (grade === 8) return 0.20;
  // Others: only ~3% missing
  return 0.03;
}

// ---------------------------------------------------------------------------
// Main seed function
// ---------------------------------------------------------------------------
async function main() {
  console.log("🏫  Seeding Demo Maktab #1...\n");

  // Run cleanup OUTSIDE the transaction (so it's committed before seeding)
  await doCleanup();

  // Run ALL seed operations inside a single transaction.
  // This prevents Supabase's Supavisor pooler from recycling the backend
  // connection mid-seed, which was causing FK constraint violations.
  console.log("🔒  Starting transaction...\n");
  await prisma.$transaction(async (tx) => {
    await doSeed(tx);
  }, {
    maxWait: 30000,    // 30s to acquire a connection
    timeout: 3600000,  // 60 minutes for the entire transaction
  });

  console.log("\n✅  Seed complete!");
}

async function doCleanup() {
  // ── Clean up ALL existing demo data ──────────────────────────────────
  // Step 1: Find all @maktab.uz users and the DEMO2025 school
  const maktabUsers = await prisma.user.findMany({
    where: { email: { endsWith: "@maktab.uz" } },
    select: { id: true, schoolId: true },
  });
  const schoolIds = new Set<string>();
  for (const u of maktabUsers) { if (u.schoolId) schoolIds.add(u.schoolId); }
  const existing = await prisma.school.findUnique({ where: { code: SCHOOL_CODE } });
  if (existing) schoolIds.add(existing.id);

  if (schoolIds.size > 0 || maktabUsers.length > 0) {
    console.log(`⚠️  Cleaning up: ${maktabUsers.length} @maktab.uz users, ${schoolIds.size} schools...`);

    // Unlink directors first
    for (const sid of schoolIds) {
      await prisma.school.update({ where: { id: sid }, data: { directorId: null } }).catch(() => {});
    }

    // Delete school-linked data
    for (const sid of schoolIds) {
      await prisma.creditTransaction.deleteMany({ where: { user: { schoolId: sid } } });
      await prisma.submission.deleteMany({ where: { assessment: { class: { schoolId: sid } } } });
      await prisma.assessment.deleteMany({ where: { class: { schoolId: sid } } });
      await prisma.enrollment.deleteMany({ where: { class: { schoolId: sid } } });
      await prisma.class.deleteMany({ where: { schoolId: sid } });
      await prisma.schoolMembership.deleteMany({ where: { schoolId: sid } });
      await prisma.user.deleteMany({ where: { schoolId: sid } });
      await prisma.school.delete({ where: { id: sid } }).catch(() => {});
    }

    // Delete any remaining @maktab.uz users (orphaned, no schoolId)
    const remaining = await prisma.user.findMany({
      where: { email: { endsWith: "@maktab.uz" } },
      select: { id: true },
    });
    if (remaining.length > 0) {
      const ids = remaining.map((u) => u.id);
      await prisma.creditTransaction.deleteMany({ where: { userId: { in: ids } } });
      await prisma.submission.deleteMany({ where: { studentId: { in: ids } } });
      await prisma.enrollment.deleteMany({ where: { studentId: { in: ids } } });
      await prisma.schoolMembership.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    console.log("   Old data deleted.\n");
  }

  // Also clean up orphan placeholders with null schoolId
  const orphans = await prisma.user.findMany({ where: { isPlaceholder: true, schoolId: null }, select: { id: true } });
  if (orphans.length > 0) {
    const ids = orphans.map(u => u.id);
    await prisma.schoolMembership.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    console.log(`   Cleaned ${orphans.length} orphan placeholders`);
  }
}

async function doSeed(_tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
  // Shadow module-level prisma with transaction client so ALL queries
  // in this function use the same database connection/transaction.
  const prisma = _tx;

  // ── 1. Hash passwords ────────────────────────────────────────────────
  console.log("🔑  Hashing passwords...");
  const [directorHash, teacherHash, studentHash] = await Promise.all([
    bcrypt.hash("Direktor2025!", HASH_ROUNDS),
    bcrypt.hash("Teacher2025!", HASH_ROUNDS),
    bcrypt.hash("Student2025!", HASH_ROUNDS),
  ]);

  // ── 2. Create School ─────────────────────────────────────────────────
  console.log("🏫  Creating school...");
  const school = await prisma.school.create({
    data: {
      name: SCHOOL_NAME,
      code: SCHOOL_CODE,
      address: "Toshkent sh., Mirzo Ulug'bek tumani, Universitet ko'chasi 4",
      phone: "+998 71 234 56 78",
      email: "info@demo-maktab.uz",
      isActive: true,
    },
  });

  // ── 3. Create Director ────────────────────────────────────────────────
  console.log("👤  Creating director...");
  const director = await prisma.user.create({
    data: {
      name: "Rustam Qodirov",
      email: "direktor@maktab.uz",
      password: directorHash,
      role: Role.DIRECTOR,
      schoolId: school.id,
      subscription: SubscriptionTier.PRO,
      credits: 99999,
      language: "uz",
      feedbackLanguage: "uz",
    },
  });

  await prisma.school.update({
    where: { id: school.id },
    data: { directorId: director.id },
  });

  await prisma.schoolMembership.create({
    data: {
      userId: director.id,
      schoolId: school.id,
      role: Role.DIRECTOR,
      status: "active",
    },
  });

  // ── 4. Create 16 Teachers (1 subject each) ─────────────────────────
  console.log("👨‍🏫  Creating 16 teachers (1 subject each)...");
  const teachers: { id: string; name: string; email: string; subject: string }[] = [];
  for (const td of TEACHER_DATA) {
    const teacher = await prisma.user.create({
      data: {
        name: td.name,
        email: td.email,
        password: teacherHash,
        role: Role.TEACHER,
        schoolId: school.id,
        subscription: SubscriptionTier.PRO,
        credits: 99999,
        language: "uz",
        feedbackLanguage: "uz",
      },
    });
    teachers.push({ id: teacher.id, name: teacher.name, email: td.email, subject: td.subject });

    await prisma.schoolMembership.create({
      data: {
        userId: teacher.id,
        schoolId: school.id,
        role: Role.TEACHER,
        status: "active",
      },
    });
  }

  // ── 5. Create Students ────────────────────────────────────────────────
  const totalStudents = GRADES.length * SUBCLASSES.length * STUDENTS_PER_SUBCLASS;
  console.log(`🧑‍🎓  Creating ${totalStudents + 1} students (${GRADES.length} grades × ${SUBCLASSES.length} subclasses × ${STUDENTS_PER_SUBCLASS})...`);
  const studentsByGradeSub: Record<string, { id: string; name: string }[]> = {};
  let studentIndex = 0;

  // Create real student #1 first (grade 8-B)
  const student1 = await prisma.user.create({
    data: {
      name: "Aziz Karimov",
      email: "student1@maktab.uz",
      password: studentHash,
      role: Role.STUDENT,
      schoolId: school.id,
      subscription: SubscriptionTier.FREE,
      credits: 50,
      language: "uz",
      feedbackLanguage: "uz",
      isPlaceholder: false,
    },
  });
  await prisma.schoolMembership.create({
    data: {
      userId: student1.id,
      schoolId: school.id,
      role: Role.STUDENT,
      status: "active",
      grade: "8",
      subclass: "B",
    },
  });

  const key8B = "8-B";
  studentsByGradeSub[key8B] = [{ id: student1.id, name: student1.name }];
  studentIndex = 1;

  // Create remaining placeholder students
  const studentCreateData: any[] = [];

  for (const grade of GRADES) {
    for (const sub of SUBCLASSES) {
      const key = `${grade}-${sub}`;
      if (!studentsByGradeSub[key]) {
        studentsByGradeSub[key] = [];
      }

      const needed = STUDENTS_PER_SUBCLASS - studentsByGradeSub[key].length;
      for (let i = 0; i < needed; i++) {
        studentIndex++;
        const name = randomName(studentIndex);
        studentCreateData.push({
          name,
          role: Role.STUDENT,
          schoolId: school.id,
          subscription: SubscriptionTier.FREE,
          credits: 0,
          language: "uz",
          feedbackLanguage: "uz",
          isPlaceholder: true,
          _grade: String(grade),
          _sub: sub,
          _key: key,
        });
      }
    }
  }

  // Batch create students using createManyAndReturn for speed
  console.log(`   Creating ${studentCreateData.length} placeholder students...`);
  const BATCH_SIZE = 50;
  const membershipCreateData: any[] = [];

  for (let i = 0; i < studentCreateData.length; i += BATCH_SIZE) {
    const batch = studentCreateData.slice(i, i + BATCH_SIZE);
    const results = await prisma.user.createManyAndReturn({
      data: batch.map((sd: any) => ({
        name: sd.name,
        role: sd.role,
        schoolId: sd.schoolId,
        subscription: sd.subscription,
        credits: sd.credits,
        language: sd.language,
        feedbackLanguage: sd.feedbackLanguage,
        isPlaceholder: sd.isPlaceholder,
      })),
      select: { id: true, name: true },
    });
    for (let j = 0; j < results.length; j++) {
      const user = results[j];
      const sd = batch[j];
      studentsByGradeSub[sd._key].push({ id: user.id, name: user.name });
      membershipCreateData.push({
        userId: user.id,
        schoolId: school.id,
        role: Role.STUDENT,
        status: "active",
        grade: sd._grade,
        subclass: sd._sub,
      });
    }
    process.stdout.write(`   ${Math.min(i + BATCH_SIZE, studentCreateData.length)}/${studentCreateData.length}\r`);
  }
  console.log(`   ✓ ${studentCreateData.length} students created`);

  // Batch create memberships (with grade/subclass)
  for (let i = 0; i < membershipCreateData.length; i += 500) {
    const batch = membershipCreateData.slice(i, i + 500);
    await prisma.schoolMembership.createMany({ data: batch });
  }

  // ── 6. Create Classes ─────────────────────────────────────────────────
  const totalClasses = GRADES.length * SUBJECTS.length;
  console.log(`📚  Creating ${totalClasses} classes (${GRADES.length} grades × ${SUBJECTS.length} subjects)...`);
  // Verify teachers exist in DB first
  const verifiedTeachers = await prisma.user.findMany({
    where: { id: { in: teachers.map(t => t.id) } },
    select: { id: true },
  });
  console.log(`   Verified ${verifiedTeachers.length}/${teachers.length} teachers in DB`);
  const validTeacherIds = new Set(verifiedTeachers.map(t => t.id));

  const classMap: Record<string, { id: string; teacherId: string; grade: number; subject: string }> = {};
  let classCodeCounter = 1000;

  for (const grade of GRADES) {
    for (const subject of SUBJECTS) {
      const teacherIdx = getTeacherIndex(subject, grade);
      const teacher = teachers[teacherIdx];
      const className = `${grade}-sinf ${subject}`;
      const code = `DM${String(classCodeCounter++).padStart(4, "0")}`;

      if (!teacher || !validTeacherIds.has(teacher.id)) {
        console.error(`Missing/invalid teacher for idx=${teacherIdx}, grade=${grade}, subject=${subject}, id=${teacher?.id}`);
        continue;
      }
      const cls = await prisma.class.create({
        data: {
          name: className,
          code,
          subject,
          description: `${subject} fani, ${grade}-sinf uchun`,
          teacherId: teacher.id,
          schoolId: school.id,
          headerColor: ["#2563eb", "#7c3aed", "#059669", "#d97706", "#dc2626", "#0891b2", "#4f46e5", "#be185d"][
            SUBJECTS.indexOf(subject as any)
          ],
          bannerStyle: String(randInt(1, 7)),
        },
      });

      const classKey = `${grade}-${subject}`;
      classMap[classKey] = { id: cls.id, teacherId: teacher.id, grade, subject };
    }
  }

  // Verify classes were created
  const classCount = Object.keys(classMap).length;
  const dbClassCount = await prisma.class.count({ where: { schoolId: school.id } });
  console.log(`   ✓ ${classCount} classes in memory, ${dbClassCount} in DB`);
  if (dbClassCount !== classCount) {
    throw new Error(`Class count mismatch! Memory: ${classCount}, DB: ${dbClassCount}`);
  }

  // ── 7. Create Enrollments ─────────────────────────────────────────────
  console.log("📝  Creating enrollments...");
  let enrollmentCount = 0;
  const enrollmentData: { studentId: string; classId: string }[] = [];

  for (const grade of GRADES) {
    const gradeStudents: { id: string; name: string }[] = [];
    for (const sub of SUBCLASSES) {
      const key = `${grade}-${sub}`;
      gradeStudents.push(...(studentsByGradeSub[key] || []));
    }

    for (const subject of SUBJECTS) {
      const classKey = `${grade}-${subject}`;
      const cls = classMap[classKey];
      if (!cls) continue;

      for (const student of gradeStudents) {
        enrollmentData.push({ studentId: student.id, classId: cls.id });
      }
    }
  }

  for (let i = 0; i < enrollmentData.length; i += 500) {
    const batch = enrollmentData.slice(i, i + 500);
    await prisma.enrollment.createMany({ data: batch, skipDuplicates: true });
    enrollmentCount += batch.length;
  }
  console.log(`   ✓ ${enrollmentCount} enrollments created`);

  // Verify classes still exist before creating assessments
  const dbClassCount2 = await prisma.class.count({ where: { schoolId: school.id } });
  console.log(`   Verify: ${dbClassCount2} classes still in DB`);
  if (dbClassCount2 === 0) {
    throw new Error("Classes disappeared from DB before assessment creation!");
  }

  // ── 8. Create Assessments ──────────────────────────────────────────
  const assessPerClass = ACADEMIC_YEARS.length * ASSESSMENTS_PER_YEAR;
  console.log(`📋  Creating assessments (${assessPerClass} per class, ${ACADEMIC_YEARS.length} years)...`);
  const assessmentList: {
    id: string;
    classId: string;
    teacherId: string;
    grade: number;
    subject: string;
    totalMarks: number;
    type: string;
    createdAt: Date;
  }[] = [];

  const now = new Date();

  // Build all assessment data first, then batch insert
  const assessmentCreateData: any[] = [];
  const assessmentMeta: { classKey: string; classId: string; teacherId: string; grade: number; subject: string; totalMarks: number; type: string; createdAt: Date }[] = [];

  for (const [classKey, cls] of Object.entries(classMap)) {
    const [gradeStr, subject] = classKey.split("-");
    const grade = parseInt(gradeStr);
    const markSchemes = MARK_SCHEMES[subject] || MARK_SCHEMES["Matematika"];

    for (let yearIdx = 0; yearIdx < ACADEMIC_YEARS.length; yearIdx++) {
      const year = ACADEMIC_YEARS[yearIdx];
      for (let aIdx = 0; aIdx < ASSESSMENTS_PER_YEAR; aIdx++) {
        const title = getAssessmentTitle(subject, grade, yearIdx, aIdx);
        const isHomework = aIdx % 2 === 0;
        const totalMarks = isHomework ? randInt(20, 50) : randInt(30, 100);
        const assessmentType = isHomework ? "homework" : "test";
        const createdAt = getAssessmentDate(year, aIdx);
        const dueDate = new Date(createdAt.getTime() + randInt(5, 14) * 24 * 60 * 60 * 1000);

        assessmentCreateData.push({
          title,
          markScheme: markSchemes[aIdx % markSchemes.length],
          totalMarks,
          status: AssessmentStatus.ACTIVE,
          classId: cls.id,
          ocrType: "handwritten",
          feedbackLanguage: "uzbek",
          assessmentType,
          dueDate,
          createdAt,
        });
        assessmentMeta.push({ classKey, classId: cls.id, teacherId: cls.teacherId, grade, subject, totalMarks, type: assessmentType, createdAt });
      }
    }
  }

  // Batch create assessments in chunks of 100
  const ASSESSMENT_BATCH = 100;
  for (let i = 0; i < assessmentCreateData.length; i += ASSESSMENT_BATCH) {
    const batch = assessmentCreateData.slice(i, i + ASSESSMENT_BATCH);
    await prisma.assessment.createMany({ data: batch });
    if (i % 500 === 0) process.stdout.write(`   ${Math.min(i + ASSESSMENT_BATCH, assessmentCreateData.length)}/${assessmentCreateData.length}\r`);
  }

  // Query back all assessments to get their IDs
  const allAssessments = await prisma.assessment.findMany({
    where: { class: { schoolId: school.id } },
    select: { id: true, classId: true, createdAt: true, title: true },
    orderBy: [{ classId: "asc" }, { createdAt: "asc" }],
  });

  // Match assessments back to meta by classId + title
  const assessmentByKey = new Map<string, string>();
  for (const a of allAssessments) {
    assessmentByKey.set(`${a.classId}|${a.title}`, a.id);
  }

  for (let i = 0; i < assessmentMeta.length; i++) {
    const meta = assessmentMeta[i];
    const title = assessmentCreateData[i].title;
    const key = `${meta.classId}|${title}`;
    const id = assessmentByKey.get(key);
    if (id) {
      assessmentList.push({ id, ...meta });
    }
  }

  console.log(`   ✓ ${assessmentList.length} assessments created (${allAssessments.length} in DB)`);

  // ── 9. Create Submissions ─────────────────────────────────────────────
  console.log("📊  Creating submissions...");
  let submissionCount = 0;
  let missingCount = 0;
  const teacherCreditUsage: Record<string, number> = {};

  // Pre-fetch all enrollments grouped by classId
  const allEnrollments = await prisma.enrollment.findMany({
    where: { class: { schoolId: school.id } },
    select: { studentId: true, classId: true },
  });
  const enrollmentsByClass = new Map<string, string[]>();
  for (const e of allEnrollments) {
    if (!enrollmentsByClass.has(e.classId)) enrollmentsByClass.set(e.classId, []);
    enrollmentsByClass.get(e.classId)!.push(e.studentId);
  }
  console.log(`   Pre-fetched ${allEnrollments.length} enrollments for ${enrollmentsByClass.size} classes`);

  for (const assessment of assessmentList) {
    const studentIds = enrollmentsByClass.get(assessment.classId) || [];
    const enrollments = studentIds.map(studentId => ({ studentId }));

    const submissionBatch: any[] = [];
    const missingRate = getMissingRate(assessment.grade);

    for (const enrollment of enrollments) {
      const studentId = enrollment.studentId;

      // Find student's subclass
      let subclass = "B";
      for (const sub of SUBCLASSES) {
        const key = `${assessment.grade}-${sub}`;
        if (studentsByGradeSub[key]?.some((s) => s.id === studentId)) {
          subclass = sub;
          break;
        }
      }

      // Missing submission check
      const isMissing = rng() < missingRate;
      if (isMissing) {
        missingCount++;
        submissionBatch.push({
          imageUrls: "[]",
          status: SubmissionStatus.PENDING,
          studentId,
          assessmentId: assessment.id,
          createdAt: new Date(now.getTime() - randInt(1, 30) * 24 * 60 * 60 * 1000),
        });
        continue;
      }

      // Score based on grade and subclass
      const { min: minPct, max: maxPct } = getScoreRange(assessment.grade, subclass);
      const pct = randInt(minPct, maxPct) / 100;
      const score = Math.round(assessment.totalMarks * pct);
      const maxScore = assessment.totalMarks;

      // Use assessment creation date + some offset for grading date
      const daysAfterCreate = randInt(1, 5);
      const gradedAt = new Date(assessment.createdAt.getTime() + daysAfterCreate * 24 * 60 * 60 * 1000);

      submissionBatch.push({
        imageUrls: JSON.stringify(["/uploads/demo/sample-answer.jpg"]),
        extractedText: `Student answer for ${assessment.subject} assessment`,
        score,
        maxScore,
        feedback: JSON.stringify({
          totalScore: score,
          maxScore,
          percentage: Math.round(pct * 100),
          summary: score >= maxScore * 0.7
            ? "Yaxshi natija! Davom eting."
            : score >= maxScore * 0.4
            ? "O'rtacha natija. Ko'proq mashq qiling."
            : "Qo'shimcha mashqlar kerak.",
        }),
        status: SubmissionStatus.GRADED,
        gradedAt,
        studentId,
        assessmentId: assessment.id,
        createdAt: new Date(gradedAt.getTime() - 60 * 60 * 1000),
      });

      if (!teacherCreditUsage[assessment.teacherId]) {
        teacherCreditUsage[assessment.teacherId] = 0;
      }
      teacherCreditUsage[assessment.teacherId]++;
    }

    if (submissionBatch.length > 0) {
      for (let i = 0; i < submissionBatch.length; i += 200) {
        const batch = submissionBatch.slice(i, i + 200);
        try {
          await prisma.submission.createMany({ data: batch, skipDuplicates: true });
          submissionCount += batch.length;
        } catch (err: any) {
          if (err.code === "P2003") {
            // FK violation — verify the assessmentId still exists
            const aId = batch[0]?.assessmentId;
            const exists = await prisma.assessment.findUnique({ where: { id: aId }, select: { id: true } });
            console.error(`\n   FK error for assessment ${aId} — exists in DB: ${!!exists}`);
            // Skip this batch and continue
            continue;
          }
          throw err;
        }
      }
    }

    if (submissionCount % 2000 < 200) {
      process.stdout.write(`   ${submissionCount} submissions...\r`);
    }
  }
  console.log(`   ✓ ${submissionCount} submissions created (${missingCount} missing)`);

  // ── 10. Create Credit Transactions ────────────────────────────────────
  console.log("💰  Creating credit transactions...");
  let txCount = 0;
  for (const [teacherId, usage] of Object.entries(teacherCreditUsage)) {
    const batchSize = Math.ceil(usage / 10);
    for (let i = 0; i < 10 && i * batchSize < usage; i++) {
      const amount = Math.min(batchSize, usage - i * batchSize);
      if (amount <= 0) break;
      const daysAgo = randInt(1, 30);
      await prisma.creditTransaction.create({
        data: {
          userId: teacherId,
          amount: -amount,
          type: TransactionType.USAGE,
          description: `AI grading: ${amount} submissions`,
          balanceAfter: 99999 - (i + 1) * batchSize,
          createdAt: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000),
        },
      });
      txCount++;
    }
  }
  console.log(`   ✓ ${txCount} credit transactions created`);

  // ── Summary ───────────────────────────────────────────────────────────
  console.log("\n📊  Summary:");
  console.log(`   School: ${SCHOOL_NAME} (code: ${SCHOOL_CODE})`);
  console.log(`   Director: direktor@maktab.uz / Direktor2025!`);
  console.log(`   Teachers: teacher1-16@maktab.uz / Teacher2025!`);
  console.log(`   Student: student1@maktab.uz / Student2025! (Grade 8-B)`);
  console.log(`   Classes: ${Object.keys(classMap).length}`);
  console.log(`   Assessments: ${assessmentList.length}`);
  console.log(`   Submissions: ${submissionCount}`);
  console.log(`   Enrollments: ${enrollmentCount}`);
  console.log(`\n   ⚠️  Grade 8 has intentionally lower scores for demo issues.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error("❌  Seed failed:", e);
    prisma.$disconnect();
    process.exit(1);
  });
