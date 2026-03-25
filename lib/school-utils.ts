import prisma from "./prisma";

/**
 * Generates a unique school code in format XXX-1234
 * Retries until a unique code is found.
 */
export async function generateSchoolCode(): Promise<string> {
  const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O confusion
  const DIGITS = "0123456789";

  for (let attempt = 0; attempt < 20; attempt++) {
    const prefix = Array.from({ length: 3 }, () =>
      LETTERS[Math.floor(Math.random() * LETTERS.length)]
    ).join("");
    const suffix = Array.from({ length: 4 }, () =>
      DIGITS[Math.floor(Math.random() * DIGITS.length)]
    ).join("");
    const code = `${prefix}-${suffix}`;

    const existing = await prisma.school.findUnique({ where: { code } });
    if (!existing) return code;
  }

  throw new Error("Failed to generate unique school code");
}

/**
 * Auto-enroll a student in all active classes of a school.
 * Skips classes the student is already enrolled in.
 */
export async function enrollStudentInSchoolClasses(
  studentId: string,
  schoolId: string
): Promise<number> {
  const classes = await prisma.class.findMany({
    where: { schoolId, archived: false },
    select: { id: true },
  });

  if (classes.length === 0) return 0;

  // Upsert each enrollment (ignore conflicts)
  let count = 0;
  for (const cls of classes) {
    try {
      await prisma.enrollment.create({
        data: { studentId, classId: cls.id },
      });
      count++;
    } catch {
      // Already enrolled — skip
    }
  }

  return count;
}

/**
 * Auto-enroll all school students into a newly created class.
 */
export async function enrollSchoolStudentsInClass(
  classId: string,
  schoolId: string
): Promise<number> {
  const students = await prisma.user.findMany({
    where: { schoolId, role: "STUDENT" },
    select: { id: true },
  });

  if (students.length === 0) return 0;

  let count = 0;
  for (const student of students) {
    try {
      await prisma.enrollment.create({
        data: { studentId: student.id, classId },
      });
      count++;
    } catch {
      // Already enrolled — skip
    }
  }

  return count;
}
