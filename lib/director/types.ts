// Director dashboard types

export interface DirectorKPIs {
  passRate: number;
  missingRate: number;
  atRiskCount: number;
  topImproved: { id: string; name: string; change: number; avg: number } | null;
  topDeclined: { id: string; name: string; change: number; avg: number } | null;
  studentCount: number;
  teacherCount: number;
  classCount: number;
  totalGraded: number;
  totalSubmissions: number;
}

export interface DirectorClass {
  id: string;
  name: string;
  subject: string | null;
  grade: number;
  teacher: { id: string; name: string };
  studentCount: number;
  assessmentCount: number;
  avgScore: number | null;
  passRate: number | null;
  missingRate: number;
  totalGraded: number;
  totalPending: number;
}

export interface DirectorIssue {
  id: string;
  type: "low_score" | "high_missing" | "declining" | "at_risk_students" | "grading_delay";
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  classId?: string;
  className?: string;
  teacherName?: string;
  value: number;
  studentIds?: string[];
}

export interface TrendPoint {
  assessmentId?: string;
  label: string;
  date: string;
  avg: number | null;
  count: number;
}

export interface GroupStats {
  subjects: { name: string; groupAvg: number; gradeAvg: number }[];
}

export interface ComparisonData {
  assessments: { id: string; title: string }[];
  threads: { thread: string; scores: { assessmentId: string; avg: number }[] }[];
}

export interface AssessmentTypeStats {
  type: string;
  label: string;
  avgScore: number;
  passRate: number;
  count: number;
}

export interface ScoreBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

export interface TeacherUsage {
  id: string;
  name: string;
  email: string | null;
  avatar: string | null;
  subscription: string;
  credits: number;
  creditsUsed: number;
  subjects: string[];
  classCount: number;
  classes: {
    id: string;
    name: string;
    subject: string | null;
    studentCount: number;
    assessmentCount: number;
  }[];
  assessmentsCreated: number;
  submissionsGraded: number;
}

export interface StudentProfile {
  student: {
    id: string;
    name: string;
    email: string | null;
    avatar: string | null;
    createdAt: string;
  };
  grade?: number | null;
  overallAvg: number | null;
  totalSubmissions: number;
  gradedCount: number;
  missingCount: number;
  subjects: {
    subject: string;
    classId: string;
    className: string;
    avgScore: number | null;
    totalGraded: number;
    missing: number;
    total: number;
    trend: number;
  }[];
  timeline: {
    date: string;
    subject: string;
    className: string;
    assessmentTitle: string;
    score: number;
    maxScore: number;
    pct: number;
    type: string;
  }[];
}

export interface ClassVsGrade {
  className: string;
  subject: string | null;
  grade: number;
  classAvg: number | null;
  gradeAvg: number | null;
  schoolAvg: number | null;
  classCount: number;
}

export type DirectorTab = "overview" | "explore" | "issues" | "students" | "teachers" | "health" | "cambridge";

export interface DirectorStudent {
  id: string;
  name: string;
  email: string | null;
  grade: string | null;
  subclass: string | null;
  enrolledCount: number;
  avgScore: number | null;
  missingRate: number;
}
