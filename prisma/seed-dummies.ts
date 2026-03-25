/**
 * seed-dummies.ts — Creates 5 login-able students and 2 login-able teachers
 * for the Demo Maktab #1 school, enrolled in relevant classes.
 *
 * Run: npx tsx prisma/seed-dummies.ts
 */

import { PrismaClient, Role, SubscriptionTier } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const SCHOOL_CODE = "DEMO2025";

async function main() {
  console.log("🔧  Creating dummy users for Demo Maktab #1...\n");

  const school = await prisma.school.findUnique({ where: { code: SCHOOL_CODE } });
  if (!school) {
    console.error("❌  School DEMO2025 not found. Run seed-school.ts first.");
    process.exit(1);
  }

  const teacherHash = await bcrypt.hash("Teacher2025!", 10);
  const studentHash = await bcrypt.hash("Student2025!", 10);

  // Clean up existing dummy users (if re-running)
  const dummyEmails = [
    "student2@maktab.uz", "student3@maktab.uz", "student4@maktab.uz",
    "student5@maktab.uz", "student6@maktab.uz",
    "teacher17@maktab.uz", "teacher18@maktab.uz",
  ];
  for (const email of dummyEmails) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await prisma.enrollment.deleteMany({ where: { studentId: existing.id } });
      await prisma.schoolMembership.deleteMany({ where: { userId: existing.id } });
      await prisma.submission.deleteMany({ where: { studentId: existing.id } });
      await prisma.user.delete({ where: { id: existing.id } });
    }
  }

  // ── Teachers ──
  const teacherDefs = [
    { name: "Sardor Hamidov", email: "teacher17@maktab.uz", subject: "Matematika" },
    { name: "Dilnoza Karimova", email: "teacher18@maktab.uz", subject: "Fizika" },
  ];

  console.log("👨‍🏫  Creating 2 teachers...");
  for (const td of teacherDefs) {
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

    await prisma.schoolMembership.create({
      data: {
        userId: teacher.id,
        schoolId: school.id,
        role: Role.TEACHER,
        status: "active",
      },
    });

    // Find classes for this teacher's subject and assign them as enrollments
    // (Teachers don't need enrollments, but they need classes)
    // Actually let's give them some classes to teach by updating class teacherId
    const targetClasses = await prisma.class.findMany({
      where: {
        schoolId: school.id,
        subject: td.subject,
        name: { startsWith: "9-sinf" },
      },
      select: { id: true, name: true },
      take: 1,
    });

    for (const cls of targetClasses) {
      // Don't change existing teacher, just enroll this teacher
      await prisma.enrollment.create({
        data: { studentId: teacher.id, classId: cls.id },
      }).catch(() => {}); // ignore if duplicate
      console.log(`   ${td.name} → enrolled in ${cls.name}`);
    }

    console.log(`   ✓ ${td.email} / Teacher2025!`);
  }

  // ── Students ──
  const studentDefs = [
    { name: "Bobur Toshmatov", email: "student2@maktab.uz", grade: "9", subclass: "A" },
    { name: "Nilufar Rahimova", email: "student3@maktab.uz", grade: "9", subclass: "A" },
    { name: "Otabek Yusupov", email: "student4@maktab.uz", grade: "10", subclass: "B" },
    { name: "Sabohat Mirzayeva", email: "student5@maktab.uz", grade: "10", subclass: "B" },
    { name: "Ulugbek Nazarov", email: "student6@maktab.uz", grade: "11", subclass: "C" },
  ];

  console.log("\n🧑‍🎓  Creating 5 students...");
  for (const sd of studentDefs) {
    const student = await prisma.user.create({
      data: {
        name: sd.name,
        email: sd.email,
        password: studentHash,
        role: Role.STUDENT,
        schoolId: school.id,
        subscription: SubscriptionTier.PLUS,
        credits: 300,
        language: "uz",
        feedbackLanguage: "uz",
        isPlaceholder: false,
      },
    });

    await prisma.schoolMembership.create({
      data: {
        userId: student.id,
        schoolId: school.id,
        role: Role.STUDENT,
        status: "active",
        grade: sd.grade,
        subclass: sd.subclass,
      },
    });

    // Enroll in all subject classes for their grade
    const gradeClasses = await prisma.class.findMany({
      where: {
        schoolId: school.id,
        name: { startsWith: `${sd.grade}-sinf` },
      },
      select: { id: true, name: true },
    });

    let enrollCount = 0;
    for (const cls of gradeClasses) {
      await prisma.enrollment.create({
        data: { studentId: student.id, classId: cls.id },
      }).catch(() => {}); // ignore duplicates
      enrollCount++;
    }

    console.log(`   ✓ ${sd.email} / Student2025! (${sd.grade}-${sd.subclass}, ${enrollCount} classes)`);
  }

  console.log("\n✅  Done!\n");
  console.log("📋  Login credentials:");
  console.log("   Teachers:");
  console.log("   teacher17@maktab.uz / Teacher2025! (Sardor Hamidov)");
  console.log("   teacher18@maktab.uz / Teacher2025! (Dilnoza Karimova)");
  console.log("   Students:");
  console.log("   student2@maktab.uz / Student2025! (Bobur, 9-A)");
  console.log("   student3@maktab.uz / Student2025! (Nilufar, 9-A)");
  console.log("   student4@maktab.uz / Student2025! (Otabek, 10-B)");
  console.log("   student5@maktab.uz / Student2025! (Sabohat, 10-B)");
  console.log("   student6@maktab.uz / Student2025! (Ulugbek, 11-C)");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error("❌  Failed:", e);
    prisma.$disconnect();
    process.exit(1);
  });
