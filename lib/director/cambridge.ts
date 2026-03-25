// Cambridge grading utilities for grades 9-11

export const CAMBRIDGE_GRADES = [9, 10, 11];
export const CAMBRIDGE_LABELS = ["A*", "A", "B", "C", "D", "E", "U"] as const;
export const CAMBRIDGE_FILL: Record<string, string> = {
  "A*": "#10b981", A: "#34d399", B: "#f59e0b", C: "#fbbf24",
  D: "#f97316", E: "#fb923c", U: "#ef4444",
};

export function isCambridgeGrade(grade: number | string | null | undefined): boolean {
  const g = typeof grade === "string" ? parseInt(grade, 10) : grade;
  return g === 9 || g === 10 || g === 11;
}

export function toCambridgeGrade(pct: number): string {
  if (pct >= 90) return "A*";
  if (pct >= 80) return "A";
  if (pct >= 70) return "B";
  if (pct >= 60) return "C";
  if (pct >= 50) return "D";
  if (pct >= 40) return "E";
  return "U";
}

export function cambridgeGradeColor(grade: string): string {
  if (grade === "A*" || grade === "A") return "text-emerald-600 dark:text-emerald-400";
  if (grade === "B" || grade === "C") return "text-amber-600 dark:text-amber-400";
  if (grade === "D" || grade === "E") return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}

export function formatScore(pct: number | null, grade?: number | string | null): string {
  if (pct === null) return "—";
  if (isCambridgeGrade(grade)) {
    return `${pct}% (${toCambridgeGrade(pct)})`;
  }
  return `${pct}%`;
}

export function scoreColorForGrade(score: number | null, grade?: number | string | null): string {
  if (score === null) return "text-muted-foreground";
  if (isCambridgeGrade(grade)) {
    return cambridgeGradeColor(toCambridgeGrade(score));
  }
  if (score >= 70) return "text-emerald-600";
  if (score >= 50) return "text-orange-600";
  return "text-red-600";
}
