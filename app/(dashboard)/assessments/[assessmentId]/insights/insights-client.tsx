"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { cachedFetch } from "@/lib/fetch-cache";
import Link from "next/link";
import {
  ArrowLeft,
  FileText,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  User,
  Sparkles,
  Loader2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  Cell,
  ResponsiveContainer,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getScoreColor } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/language-context";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

interface Assessment {
  id: string;
  title: string;
  description: string | null;
  totalMarks: number;
  dueDate: string | null;
  status: string;
  createdAt: string;
  class: {
    id: string;
    name: string;
    teacher: {
      id: string;
      name: string;
    };
  };
  submissions: {
    id: string;
    score: number | null;
    maxScore: number | null;
    feedback: string | null;
    status: string;
    gradingProgress: number;
    createdAt: string;
    student: {
      id: string;
      name: string;
      email: string;
    };
  }[];
  viewerRole?: "OWNER" | "CO_TEACHER" | "DIRECTOR" | "STUDENT";
  viewerCanManage?: boolean;
  viewerCanViewTeacherData?: boolean;
}

interface ParsedQuestionBreakdown {
  questionId: string;
  points: number;
  maxPoints: number;
  feedback: string;
}

interface CommonMistakeItem {
  questionId: string;
  affectedCount: number;
  totalCount: number;
  affectedRate: number;
  averageMarksLost: number;
  examples: string[];
  affectedStudents: {
    studentName: string;
    studentId: string;
    points: number;
    maxPoints: number;
    feedback: string;
  }[];
}

const QUESTION_HEADER_REGEX = /^####\s+([^\n]+)$/gm;
const SCORE_LINE_REGEX = /\*\*(?:Score|Ball|Баллы):\*\*\s*(\d+)\s*\/\s*(\d+)/i;

function normalizeQuestionId(rawHeader: string): string {
  return rawHeader
    .replace(/^(?:✅|⚠️|⚠|❌|⭕)\s*/u, "")
    .replace(/^Question\s+/i, "")
    .replace(/^Вопрос\s+/i, "")
    .replace(/-savol$/i, "")
    .trim();
}

function extractCommonIssueSnippet(raw: string): string {
  const compact = raw.replace(/\s+/g, " ").trim();
  if (!compact) return "";

  const [firstSentence] = compact.split(/(?<=[.!?])\s+/);
  const snippet = (firstSentence || compact).trim();
  return snippet.length > 220 ? `${snippet.slice(0, 217)}...` : snippet;
}

function extractTopicFromFeedback(sectionText: string, questionId: string): string {
  const topicPatterns: [RegExp, string][] = [
    [/kinetic energy|potential energy|conservation of (energy|momentum)|energy/i, "Energy"],
    [/newton'?s?\s+(first|second|third|1st|2nd|3rd)\s+law/i, "Newton's Laws"],
    [/\bmomentum\b/i, "Momentum"],
    [/\b(velocity|acceleration|displacement|SUVAT)\b/i, "Kinematics"],
    [/\b(friction|tension)\b|\bforce(s)?\b.*\b(resolve|component|resultant|newton)\b|\bnormal\s+reaction\b|\bequilibrium\b/i, "Forces"],
    [/\belectric(ity|al)?\s*(field|circuit|current|potential)\b|\b(magnetic|electromagnetic)\b/i, "Electricity"],
    [/\bwave(s|length)?\b|oscillat/i, "Waves"],
    [/thermodynamic|entropy|heat\s+capacity/i, "Thermodynamics"],
    [/\bgravit(y|ational)\b/i, "Gravity"],
    [/\bpower\b.*\b(watt|W)\b|\bpower\s*=/i, "Power & Work"],
    [/oxidation|reduction|redox|electroly(sis|te)/i, "Redox & Electrolysis"],
    [/\bmole(s|ar)\b|stoichiometr/i, "Stoichiometry"],
    [/\b(acid|base)\b|pH|neutrali[sz]/i, "Acids & Bases"],
    [/organic\s+(chemistry|compound)/i, "Organic Chemistry"],
    [/\bbond(ing)?\b|covalent|ionic/i, "Chemical Bonding"],
    [/reaction\s+rate|rate\s+of\s+reaction/i, "Reaction Rates"],
    [/photosynthe|respirat/i, "Photosynthesis & Respiration"],
    [/cell\s+division|mitosis|meiosis/i, "Cell Division"],
    [/\benzyme\b/i, "Enzymes"],
    [/\bDNA\b|\bRNA\b|\bgene(tic)?\b|\bmutation\b/i, "Genetics"],
    [/ecology|ecosystem|food\s+(chain|web)|\bevolution\b|natural\s+selection/i, "Ecology & Evolution"],
    [/\bdifferenti(ation|ate)\b|\bderivative\b|\bintegrat(ion|e|ing)\b/i, "Calculus"],
    [/\bquadratic\b|simultaneous\s+equation|\bfactoris/i, "Algebra"],
    [/\btrigonometr/i, "Trigonometry"],
    [/\blogarithm\b|\bexponential\b/i, "Logarithms"],
    [/\bprobabilit|\bstatistic|\bstandard\s+deviation\b|\bmedian\b/i, "Probability & Stats"],
    [/\bgeometry\b|\btriangle\b|\bcircle\b/i, "Geometry"],
    [/\bvector\b|\bmatri(x|ces)\b/i, "Vectors & Matrices"],
    [/\bsequence\b|\bseries\b|arithmetic\s+progression/i, "Sequences"],
    [/\bgrammar\b|\btense\b|\bsyntax\b|\bvocabulary\b|\bdiction\b/i, "Grammar & Vocab"],
    [/\bcomprehension\b|reading/i, "Comprehension"],
    [/\bessay\b|\bcomposition\b|\bwriting\b/i, "Writing"],
    [/\bliterary\b|\bmetaphor\b|\bsimile\b|\bimagery\b|\brhetorical\b/i, "Literary Analysis"],
  ];

  for (const [pattern, topic] of topicPatterns) {
    if (pattern.test(sectionText)) return topic;
  }

  return `Q${questionId}`;
}

interface InsightsClientProps {
  initialData: Assessment | null;
  initialSummary: string | null;
  assessmentId: string;
}

const MAX_RADAR_TOPICS = 8;
const MIN_TOPIC_SAMPLES = 3;

function parseQuestionBreakdown(feedback: string): ParsedQuestionBreakdown[] {
  const headers = [...feedback.matchAll(QUESTION_HEADER_REGEX)];
  if (headers.length === 0) return [];

  const parsed: ParsedQuestionBreakdown[] = [];

  for (let i = 0; i < headers.length; i++) {
    const match = headers[i];
    const sectionStart = match.index ?? 0;
    const sectionEnd = i + 1 < headers.length ? (headers[i + 1].index ?? feedback.length) : feedback.length;
    const section = feedback.slice(sectionStart, sectionEnd).trim();
    const questionId = normalizeQuestionId(match[1] || "");

    if (!questionId) continue;

    const scoreMatch = section.match(SCORE_LINE_REGEX);
    if (!scoreMatch) continue;

    const points = Number.parseInt(scoreMatch[1], 10);
    const maxPoints = Number.parseInt(scoreMatch[2], 10);

    if (!Number.isFinite(points) || !Number.isFinite(maxPoints) || maxPoints <= 0) {
      continue;
    }

    const afterScore = section.slice(section.indexOf(scoreMatch[0]) + scoreMatch[0].length).trim();
    const feedbackText = afterScore.replace(/\*\*(?:Deductions|Ayirmalar|Вычеты):\*\*[\s\S]*$/i, "").trim();

    parsed.push({
      questionId,
      points,
      maxPoints,
      feedback: feedbackText,
    });
  }

  return parsed;
}

function buildCommonMistakes(submissions: Assessment["submissions"]): {
  items: CommonMistakeItem[];
  gradedCount: number;
  parsedCount: number;
} {
  const graded = submissions.filter(
    (submission) =>
      submission.status === "GRADED" &&
      typeof submission.feedback === "string" &&
      submission.feedback.trim().length > 0
  );

  const byQuestion = new Map<
    string,
    {
      totalSubmissionIds: Set<string>;
      affectedSubmissionIds: Set<string>;
      totalMarksLost: number;
      issueFrequency: Map<string, number>;
      affectedStudents: {
        studentName: string;
        studentId: string;
        points: number;
        maxPoints: number;
        feedback: string;
      }[];
    }
  >();

  let parsedCount = 0;

  for (const submission of graded) {
    const breakdown = parseQuestionBreakdown(submission.feedback || "");
    if (breakdown.length === 0) continue;

    parsedCount += 1;

    for (const item of breakdown) {
      const existing = byQuestion.get(item.questionId) || {
        totalSubmissionIds: new Set<string>(),
        affectedSubmissionIds: new Set<string>(),
        totalMarksLost: 0,
        issueFrequency: new Map<string, number>(),
        affectedStudents: [],
      };

      existing.totalSubmissionIds.add(submission.id);

      if (item.points < item.maxPoints) {
        existing.affectedSubmissionIds.add(submission.id);
        existing.totalMarksLost += item.maxPoints - item.points;

        const snippet = extractCommonIssueSnippet(item.feedback);
        if (snippet) {
          existing.issueFrequency.set(snippet, (existing.issueFrequency.get(snippet) || 0) + 1);
        }

        existing.affectedStudents.push({
          studentName: submission.student.name || submission.student.email,
          studentId: submission.student.id,
          points: item.points,
          maxPoints: item.maxPoints,
          feedback: item.feedback,
        });
      }

      byQuestion.set(item.questionId, existing);
    }
  }

  const items = [...byQuestion.entries()]
    .filter(([, value]) => value.affectedSubmissionIds.size > 0)
    .map(([questionId, value]) => {
      const totalCount = parsedCount;
      const affectedCount = value.affectedSubmissionIds.size;
      const affectedRate = totalCount > 0 ? Math.round((affectedCount / totalCount) * 100) : 0;
      const averageMarksLost = affectedCount > 0 ? value.totalMarksLost / affectedCount : 0;

      const examples = [...value.issueFrequency.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([snippet]) => snippet);

      return {
        questionId,
        affectedCount,
        totalCount,
        affectedRate,
        averageMarksLost: Number(averageMarksLost.toFixed(1)),
        examples,
        affectedStudents: value.affectedStudents,
      };
    })
    .sort((a, b) => b.affectedRate - a.affectedRate || b.affectedCount - a.affectedCount);

  return {
    items,
    gradedCount: graded.length,
    parsedCount,
  };
}

export default function InsightsClient({ initialData, initialSummary, assessmentId }: InsightsClientProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const { toast } = useToast();
  const { language } = useLanguage();
  const [assessment, setAssessment] = useState<Assessment | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [showAllMistakes, setShowAllMistakes] = useState(false);
  const [expandedMistakes, setExpandedMistakes] = useState<Set<string>>(new Set());
  const [aiSummary, setAiSummary] = useState<string | null>(initialSummary);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryFetched, setAiSummaryFetched] = useState(!!initialSummary);

  const fetchAssessment = useCallback(async () => {
    try {
      const data = await cachedFetch(`/api/assessments/${assessmentId}`);
      if (!data) throw new Error("Assessment not found");
      setAssessment(data.assessment);
    } catch {
      toast({
        title: "Error",
        description: "Failed to load assessment",
        variant: "destructive",
      });
      router.push("/classes");
    } finally {
      setLoading(false);
    }
  }, [assessmentId, toast, router]);

  useEffect(() => {
    if (!initialData) {
      fetchAssessment();
    }
  }, [fetchAssessment, initialData]);

  const commonMistakes = useMemo(
    () =>
      assessment
        ? buildCommonMistakes(assessment.submissions)
        : { items: [], gradedCount: 0, parsedCount: 0 },
    [assessment]
  );

  const scoreDistribution = useMemo(() => {
    if (!assessment) return [];
    const effectiveMax = assessment.totalMarks > 0 ? assessment.totalMarks : 0;
    const gradedSubs = assessment.submissions.filter(
      (s) => s.status === "GRADED" && s.score != null && (effectiveMax > 0 || s.maxScore || s.score! > 0)
    );
    const buckets = [
      { range: "0-19%", min: 0, max: 19, count: 0, color: "#ef4444" },
      { range: "20-39%", min: 20, max: 39, count: 0, color: "#f97316" },
      { range: "40-59%", min: 40, max: 59, count: 0, color: "#eab308" },
      { range: "60-79%", min: 60, max: 79, count: 0, color: "#84cc16" },
      { range: "80-100%", min: 80, max: 100, count: 0, color: "#10b981" },
    ];
    for (const s of gradedSubs) {
      const pct = Math.round((s.score! / (effectiveMax || s.maxScore || 100)) * 100);
      const clamped = Math.max(0, Math.min(100, pct));
      const idx = clamped >= 80 ? 4 : clamped >= 60 ? 3 : clamped >= 40 ? 2 : clamped >= 20 ? 1 : 0;
      buckets[idx].count++;
    }
    return buckets;
  }, [assessment]);

  const topicRadarData = useMemo(() => {
    if (!assessment) return [];
    const graded = assessment.submissions.filter(
      (s) => s.status === "GRADED" && typeof s.feedback === "string" && s.feedback.trim().length > 0
    );
    const topicScores = new Map<string, { totalPct: number; count: number }>();
    for (const sub of graded) {
      const fb = sub.feedback || "";
      const headers = [...fb.matchAll(QUESTION_HEADER_REGEX)];
      for (let i = 0; i < headers.length; i++) {
        const match = headers[i];
        const sectionStart = match.index ?? 0;
        const sectionEnd = i + 1 < headers.length ? (headers[i + 1].index ?? fb.length) : fb.length;
        const section = fb.slice(sectionStart, sectionEnd).trim();
        const qId = normalizeQuestionId(match[1] || "");
        const scoreMatch = section.match(SCORE_LINE_REGEX);
        if (!scoreMatch || !qId) continue;
        const points = Number.parseInt(scoreMatch[1], 10);
        const maxPoints = Number.parseInt(scoreMatch[2], 10);
        if (!Number.isFinite(points) || !Number.isFinite(maxPoints) || maxPoints <= 0) continue;

        const topic = extractTopicFromFeedback(section, qId);
        const pct = (points / maxPoints) * 100;
        const existing = topicScores.get(topic) || { totalPct: 0, count: 0 };
        existing.totalPct += pct;
        existing.count++;
        topicScores.set(topic, existing);
      }
    }
    return [...topicScores.entries()]
      .filter(([topic, data]) => !topic.startsWith("Q") && data.count >= MIN_TOPIC_SAMPLES)
      .map(([topic, data]) => ({
        topic,
        score: Math.round(data.totalPct / data.count),
        count: data.count,
        fullMark: 100,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_RADAR_TOPICS)
      .sort((a, b) => a.topic.localeCompare(b.topic));
  }, [assessment]);

  const fetchAiSummary = useCallback(async () => {
    if (!assessment || aiSummaryFetched || aiSummaryLoading) return;
    const effectiveMax = assessment.totalMarks > 0 ? assessment.totalMarks : 0;
    const gradedSubs = assessment.submissions.filter(
      (s) => s.status === "GRADED" && s.score != null && (effectiveMax > 0 || s.maxScore || s.score! > 0)
    );
    if (gradedSubs.length < 2) return;

    setAiSummaryLoading(true);
    setAiSummaryFetched(true);
    try {
      const cached = await fetch(`/api/assessments/${assessmentId}/analytics-summary`);
      if (cached.ok) {
        const data = await cached.json();
        if (data.summary) {
          setAiSummary(data.summary);
          setAiSummaryLoading(false);
          return;
        }
      }

      const scores = gradedSubs.map((s) => s.score as number);
      const maxScore = effectiveMax || gradedSubs[0]?.maxScore || 100;
      const classAvg = Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length / maxScore * 100);
      const topMistakes = commonMistakes.items.slice(0, 5).map((m) => `${m.questionId}: ${m.affectedRate}% missed`);

      const res = await fetch(`/api/assessments/${assessmentId}/analytics-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: assessment.title,
          scores,
          maxScore,
          classAvg,
          totalStudents: gradedSubs.length,
          topMistakes,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.summary) {
          setAiSummary(data.summary);
        }
      } else {
        console.error("Analytics summary API error:", res.status, await res.text().catch(() => ""));
      }
    } catch (err) {
      console.error("Analytics summary fetch error:", err);
    } finally {
      setAiSummaryLoading(false);
    }
  }, [assessment, assessmentId, aiSummaryFetched, aiSummaryLoading, commonMistakes.items]);

  useEffect(() => {
    if (assessment && !aiSummaryFetched) {
      fetchAiSummary();
    }
  }, [assessment, aiSummaryFetched, fetchAiSummary]);

  if (loading) {
    return <InsightsSkeleton />;
  }

  if (!assessment) {
    return null;
  }

  const isTeacher = assessment.viewerCanViewTeacherData ?? assessment.viewerCanManage ?? (assessment.class.teacher.id === session?.user?.id);

  if (!isTeacher) {
    router.push(`/assessments/${assessmentId}`);
    return null;
  }

  const effectiveMax = assessment.totalMarks > 0 ? assessment.totalMarks : 0;
  const gradedSubs = assessment.submissions.filter(
    (s) => s.status === "GRADED" && s.score != null && (effectiveMax > 0 || s.maxScore || s.score! > 0)
  );
  const classAvg = gradedSubs.length > 0
    ? Math.round(
        gradedSubs.reduce((sum, s) => sum + ((s.score || 0) / ((effectiveMax || s.maxScore || 100)) * 100), 0) /
          gradedSubs.length
      )
    : 0;

  const mostStruggled = commonMistakes.items[0] || null;

  const visibleMistakes = showAllMistakes ? commonMistakes.items : commonMistakes.items.slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <Link href={`/classes/${assessment.class.id}`} className="shrink-0">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight break-words">
                {assessment.title}
              </h1>
            </div>
            <p className="text-muted-foreground text-sm">
              {assessment.class.name}
            </p>
          </div>
        </div>
      </div>

      {/* Nav bar */}
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <Link
          href={`/assessments/${assessmentId}`}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors -mb-[13px] border-b-2 border-transparent"
        >
          <FileText className="h-4 w-4" />
          {language === "uz" ? "Yuborilgan ishlar" : language === "ru" ? "Работы" : "Submissions"}
        </Link>
        <div className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-primary border-b-2 border-primary -mb-[13px]">
          <Sparkles className="h-4 w-4" />
          {language === "uz" ? "Tahlil" : language === "ru" ? "Аналитика" : "Analytics"}
        </div>
      </div>

      {/* Analytics Content */}
      <div className="space-y-6">
        {/* AI Insights Card */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-primary">
                {language === "uz" ? "AI Tahlil" : language === "ru" ? "AI Анализ" : "AI Insights"}
              </span>
            </div>
            {aiSummaryLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">
                  {language === "uz" ? "Tahlil qilinmoqda..." : language === "ru" ? "Анализируем..." : "Analyzing..."}
                </span>
              </div>
            ) : aiSummary ? (
              <div className="text-sm font-medium text-foreground leading-relaxed prose prose-sm dark:prose-invert max-w-none break-words">
                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {aiSummary}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {gradedSubs.length < 2
                  ? (language === "uz" ? "Tahlil uchun kamida 2 ta baholangan ish kerak" : language === "ru" ? "Для анализа нужно минимум 2 оценённых работы" : "Need at least 2 graded submissions for AI analysis")
                  : (language === "uz" ? "AI tahlili mavjud emas" : language === "ru" ? "AI анализ недоступен" : "AI summary not available")}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Summary Stats */}
        {gradedSubs.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardContent className="pt-5 pb-4">
                <p className="text-sm text-muted-foreground">
                  {language === "uz" ? "Sinf o'rtachasi" : language === "ru" ? "Средний балл" : "Class Average"}
                </p>
                <p className={`text-3xl font-bold mt-1 ${getScoreColor(classAvg, 100)}`}>
                  {classAvg}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {language === "uz"
                    ? `${gradedSubs.length} ta baholangan ishdan`
                    : language === "ru"
                    ? `Из ${gradedSubs.length} оценённых работ`
                    : `From ${gradedSubs.length} graded submission${gradedSubs.length > 1 ? "s" : ""}`}
                </p>
              </CardContent>
            </Card>
            {mostStruggled && (
              <Card className="border-red-200 dark:border-red-900/50">
                <CardContent className="pt-5 pb-4">
                  <p className="text-sm text-muted-foreground">
                    {language === "uz" ? "Eng qiyin savol" : language === "ru" ? "Самый сложный вопрос" : "Most Struggled Question"}
                  </p>
                  <p className="text-xl font-bold mt-1 text-red-600 dark:text-red-400">
                    {mostStruggled.questionId}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {language === "uz"
                      ? `${mostStruggled.affectedCount}/${mostStruggled.totalCount} o'quvchi xato qildi (${mostStruggled.affectedRate}%)`
                      : language === "ru"
                      ? `${mostStruggled.affectedCount}/${mostStruggled.totalCount} учеников ошиблись (${mostStruggled.affectedRate}%)`
                      : `Missed by ${mostStruggled.affectedCount}/${mostStruggled.totalCount} students (${mostStruggled.affectedRate}%)`}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Score Distribution Chart */}
        {scoreDistribution.some((b) => b.count > 0) && (
          <Card>
            <CardContent className="pt-5 pb-4">
              <h3 className="text-sm font-semibold mb-3">
                {language === "uz" ? "Ball taqsimoti" : language === "ru" ? "Распределение баллов" : "Score Distribution"}
              </h3>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={scoreDistribution} barCategoryGap="20%">
                    <XAxis dataKey="range" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <RechartsTooltip
                      formatter={(value) => [`${value} student${value !== 1 ? "s" : ""}`, "Count"]}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {scoreDistribution.map((entry, idx) => (
                        <Cell key={idx} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Topic Radar Chart */}
        {topicRadarData.length >= 3 && (
          <Card>
            <CardContent className="pt-5 pb-4">
              <h3 className="text-sm font-semibold mb-3">
                {language === "uz" ? "Mavzu bo'yicha natijalar" : language === "ru" ? "Результаты по темам" : "Performance by Topic"}
              </h3>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={topicRadarData} cx="50%" cy="50%" outerRadius="65%">
                    <PolarGrid />
                    <PolarAngleAxis dataKey="topic" tick={{ fontSize: 11 }} />
                    <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10 }} />
                    <Radar
                      name="Class Avg %"
                      dataKey="score"
                      stroke="#2563eb"
                      fill="#2563eb"
                      fillOpacity={0.25}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Common Mistakes */}
        {commonMistakes.items.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-3">
              {language === "uz"
                ? "Ko'p uchraydigan xatolar"
                : language === "ru"
                ? "Частые ошибки"
                : "Common Mistakes"}
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              {language === "uz"
                ? `${commonMistakes.parsedCount} ta ishdan tahlil qilindi`
                : language === "ru"
                ? `Проанализировано ${commonMistakes.parsedCount} работ`
                : `Analyzed from ${commonMistakes.parsedCount} parsed submissions`}
            </p>
            <div className="space-y-3">
              {visibleMistakes.map((mistake) => {
                const isExpanded = expandedMistakes.has(mistake.questionId);
                return (
                  <Card key={mistake.questionId} className="overflow-hidden">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">
                              {mistake.questionId}
                            </span>
                            <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                              {language === "uz"
                                ? `${mistake.affectedCount}/${mistake.totalCount} o'quvchi xato qildi (${mistake.affectedRate}%)`
                                : language === "ru"
                                ? `${mistake.affectedCount}/${mistake.totalCount} ошиблись (${mistake.affectedRate}%)`
                                : `Missed by ${mistake.affectedCount}/${mistake.totalCount} (${mistake.affectedRate}%)`}
                            </span>
                          </div>
                          {mistake.examples.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {mistake.examples[0]}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground">
                            ~{mistake.averageMarksLost}{" "}
                            {language === "uz" ? "ball yo'qotildi" : language === "ru" ? "баллов потеряно" : "marks lost"}
                          </span>
                          {mistake.affectedStudents.length > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => {
                                setExpandedMistakes((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(mistake.questionId)) {
                                    next.delete(mistake.questionId);
                                  } else {
                                    next.add(mistake.questionId);
                                  }
                                  return next;
                                });
                              }}
                            >
                              {isExpanded ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                      {isExpanded && mistake.affectedStudents.length > 0 && (
                        <div className="mt-3 pt-3 border-t space-y-2">
                          {mistake.affectedStudents.map((student, idx) => (
                            <div key={idx} className="flex items-start gap-2 text-xs">
                              <User className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <span className="font-medium">{student.studentName}</span>
                                <span className={`ml-2 ${getScoreColor(student.points, student.maxPoints)}`}>
                                  {student.points}/{student.maxPoints}
                                </span>
                                {student.feedback && (
                                  <p className="text-muted-foreground mt-0.5 line-clamp-2">{student.feedback}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            {commonMistakes.items.length > 5 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full mt-2"
                onClick={() => setShowAllMistakes(!showAllMistakes)}
              >
                {showAllMistakes
                  ? (language === "uz" ? "Kamroq ko'rsatish" : language === "ru" ? "Показать меньше" : "Show less")
                  : (language === "uz"
                    ? `Yana ${commonMistakes.items.length - 5} ta ko'rsatish`
                    : language === "ru"
                    ? `Показать ещё ${commonMistakes.items.length - 5}`
                    : `Show ${commonMistakes.items.length - 5} more`)}
              </Button>
            )}
          </div>
        )}

        {/* No data */}
        {gradedSubs.length === 0 && (
          <div className="py-16 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">
              {language === "uz" ? "Ma'lumotlar yo'q" : language === "ru" ? "Нет данных" : "No data yet"}
            </h3>
            <p className="text-muted-foreground">
              {language === "uz"
                ? "Tahlil ko'rsatish uchun kamida bitta baholangan ish kerak"
                : language === "ru"
                ? "Для отображения аналитики нужна хотя бы одна оценённая работа"
                : "Analytics will appear once submissions are graded"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Skeleton className="h-10 w-10 rounded" />
        <div>
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-32 w-full" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
