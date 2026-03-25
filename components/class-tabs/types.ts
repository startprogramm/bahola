export interface Submission {
  id: string;
  status: string;
  score: number | null;
  maxScore: number | null;
  feedback: string | null;
  createdAt: string;
  gradedAt: string | null;
  reportReason?: string | null;
  reportedAt?: string | null;
  student?: {
    id: string;
    name: string;
    email: string;
  };
}

export interface Assessment {
  id: string;
  title: string;
  totalMarks: number;
  dueDate: string | null;
  status: string;
  createdAt: string;
  isNew?: boolean;
  gradedSubmissionsCount?: number;
  _count: {
    submissions: number;
  };
  submissions: Submission[];
}

export interface ClassDetail {
  id: string;
  name: string;
  code: string;
  description: string | null;
  subject: string | null;
  headerColor?: string;
  bannerStyle?: string | null;
  classAvatar?: string | null;
  createdAt: string;
  teacher: {
    id: string;
    name: string;
    email: string;
    avatar?: string;
  };
  enrollments: {
    id: string;
    joinedAt: string;
    role?: "STUDENT" | "TEACHER";
    student: {
      id: string;
      name: string;
      email: string;
      submissions?: { score: number | null; maxScore: number | null }[];
    };
  }[];
  assessments: Assessment[];
  viewerRole?: "OWNER" | "CO_TEACHER" | "DIRECTOR" | "STUDENT";
  viewerCanManage?: boolean;
  viewerCanViewTeacherData?: boolean;
  viewerCanInteractWithStream?: boolean;
}

export type GradesTimelineType = "all" | "month" | "quarter" | "semester" | "year";

export interface GradesFilterState {
  type: GradesTimelineType;
  quarter: 1 | 2 | 3 | 4;
  semester: 1 | 2;
  academicYear: number | null;
}

export interface DateRange {
  from: Date;
  to: Date;
}

export interface CurrentAcademicSelection {
  academicYear: number;
  quarter: 1 | 2 | 3 | 4;
  semester: 1 | 2;
}

// Helper functions for grades

export function getAcademicYearStart(date: Date): number {
  return date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1;
}

export function formatAcademicYearLabel(startYear: number): string {
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export function getAcademicYears(assessments: { createdAt: string }[]): number[] {
  const years = new Set<number>();

  for (const assessment of assessments) {
    const createdAt = new Date(assessment.createdAt);
    if (!Number.isNaN(createdAt.getTime())) {
      years.add(getAcademicYearStart(createdAt));
    }
  }

  return Array.from(years).sort((a, b) => b - a);
}

function startOfDay(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day, 0, 0, 0, 0);
}

function endOfDay(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day, 23, 59, 59, 999);
}

export function getGradesDateRange(
  filter: GradesFilterState,
  fallbackAcademicYear: number | null
): DateRange | null {
  if (filter.type === "all") return null;

  if (filter.type === "month") {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 30);
    return { from, to };
  }

  const academicYear = filter.academicYear ?? fallbackAcademicYear;
  if (academicYear == null) return null;

  if (filter.type === "quarter") {
    switch (filter.quarter) {
      case 1:
        return { from: startOfDay(academicYear, 8, 1), to: endOfDay(academicYear, 9, 31) };
      case 2:
        return { from: startOfDay(academicYear, 10, 1), to: endOfDay(academicYear, 11, 31) };
      case 3:
        return { from: startOfDay(academicYear + 1, 0, 1), to: endOfDay(academicYear + 1, 2, 20) };
      case 4:
        return { from: startOfDay(academicYear + 1, 2, 21), to: endOfDay(academicYear + 1, 5, 25) };
      default:
        return null;
    }
  }

  if (filter.type === "semester") {
    if (filter.semester === 1) {
      return { from: startOfDay(academicYear, 8, 1), to: endOfDay(academicYear, 11, 31) };
    }
    return { from: startOfDay(academicYear + 1, 0, 1), to: endOfDay(academicYear + 1, 5, 25) };
  }

  return { from: startOfDay(academicYear, 8, 1), to: endOfDay(academicYear + 1, 5, 25) };
}

export function getCurrentAcademicSelection(date: Date): CurrentAcademicSelection {
  const academicYear = getAcademicYearStart(date);
  const month = date.getMonth();
  const day = date.getDate();

  let quarter: 1 | 2 | 3 | 4 = 4;

  if (month >= 8 && month <= 9) {
    quarter = 1;
  } else if (month === 10 || month === 11) {
    quarter = 2;
  } else if (month === 0 || month === 1 || (month === 2 && day <= 20)) {
    quarter = 3;
  } else if ((month === 2 && day >= 21) || month === 3 || month === 4 || (month === 5 && day <= 25)) {
    quarter = 4;
  }

  return {
    academicYear,
    quarter,
    semester: quarter <= 2 ? 1 : 2,
  };
}

export function isSubmissionLate(submittedAt: string | null | undefined, dueDate: string | null | undefined): boolean {
  if (!submittedAt || !dueDate) return false;
  const submitted = new Date(submittedAt);
  const due = new Date(dueDate);
  if (Number.isNaN(submitted.getTime()) || Number.isNaN(due.getTime())) return false;
  return submitted > due;
}

/** Extract correct maxScore from feedback's per-question breakdown.
 *  Matches patterns like **Score:** 2/3 or **Ball:** 1/2 in each question block. */
export function extractMaxFromFeedback(feedback: string | null | undefined): number | null {
  if (!feedback) return null;
  const re = /\*\*(?:Ball|Score|Баллы|Note|Punkte|الدرجة|Бали|得点|得分):?\*\*:?\s*\d+(?:\.\d+)?\s*\/\s*(\d+(?:\.\d+)?)/gi;
  let total = 0;
  let count = 0;
  let m;
  while ((m = re.exec(feedback)) !== null) {
    total += Number(m[1]);
    count++;
  }
  return count > 0 ? total : null;
}

export function getGradesScoreColor(score: number, maxScore: number): string {
  const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;
  if (percentage >= 80) return "text-emerald-800 dark:text-emerald-500 font-bold";
  if (percentage >= 60) return "text-amber-800 dark:text-amber-500 font-bold";
  if (percentage >= 40) return "text-orange-800 dark:text-orange-500 font-bold";
  return "text-red-800 dark:text-red-500 font-bold";
}
