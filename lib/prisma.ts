import { PrismaClient } from '@prisma/client';
import { isSuperAdminEmail } from './subscription';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error'],
  });

// Cache in all environments to prevent connection exhaustion
globalForPrisma.prisma = prisma;

export default prisma;

// Cache superadmin status by userId to avoid repeated DB lookups
const superAdminCache = new Map<string, boolean>();

export async function isSuperAdmin(userId: string): Promise<boolean> {
  const cached = superAdminCache.get(userId);
  if (cached !== undefined) return cached;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  const result = isSuperAdminEmail(user?.email);
  superAdminCache.set(userId, result);
  return result;
}

/**
 * Check if a user has teacher-level access to a class.
 * Returns true if the user is:
 * - the class owner (teacherId), or
 * - a co-teacher (enrollment role = TEACHER), or
 * - a superadmin enrolled in the class (any role)
 */
export async function isUserClassTeacher(userId: string, classId: string): Promise<boolean> {
  // Superadmin: teacher access to any class
  if (await isSuperAdmin(userId)) return true;

  // First check if user is the class owner
  const classData = await prisma.class.findUnique({
    where: { id: classId },
    select: { teacherId: true },
  });
  if (classData?.teacherId === userId) return true;

  // Check if user is a co-teacher via enrollment
  const enrollment = await prisma.enrollment.findUnique({
    where: { studentId_classId: { studentId: userId, classId } },
    select: { role: true },
  });
  if (enrollment?.role === "TEACHER") return true;

  return false;
}
