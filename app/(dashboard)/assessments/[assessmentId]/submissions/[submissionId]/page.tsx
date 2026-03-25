"use client";

import { useEffect, useState, useCallback, useMemo, useRef, type CSSProperties } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Pencil,
  AlertCircle,
  RefreshCw,
  User,
  FileImage,
  MessageSquare,
  BookOpen,
  Loader2,
  FileSpreadsheet,
  Download,
  Flag,
  X,
  CheckCircle2,
  TriangleAlert,
  XCircle,
  CircleDashed,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ImageOff,
  Lock,
  BookOpenCheck,
  BarChart2,
  History,
  Clock,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn, formatDate, getScoreColor, getScoreBgColor, normalizeImageUrl } from "@/lib/utils";
import { cachedFetch, invalidateCache } from "@/lib/fetch-cache";
import { useLanguage } from "@/lib/i18n/language-context";
import { ResizablePanelLayout, type PanelConfig } from "@/components/resizable-panels";
import {
  DndContext,
  closestCenter,
  TouchSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface AdjustmentChange {
  questionIndex: number;
  questionTitle: string;
  pointsBefore: number | null;
  pointsAfter: number;
  maxPoints: number | null;
  reason: string;
}

interface ScoreAdjustmentRecord {
  id: string;
  adjustedAt: string;
  scoreBefore: number;
  scoreAfter: number;
  changes: string;
  adjuster: {
    id: string;
    name: string;
  };
}

interface QuestionResultRecord {
  id: string;
  questionNumber: string;
  score: number;
  maxScore: number;
  status: string;
  deductionReason: string | null;
  feedback: string | null;
  containsDiagram: boolean;
  pageNumbers: number[];
}

interface SubmissionDetail {
  id: string;
  imageUrls: string;
  extractedText: string | null;
  score: number | null;
  maxScore: number | null;
  feedback: string | null;
  status: string;
  createdAt: string;
  gradedAt: string | null;
  originalScore: number | null;
  adjustedBy: string | null;
  adjustmentReason: string | null;
  adjustedAt: string | null;
  reportReason: string | null;
  reportedAt: string | null;
  student: {
    id: string;
    name: string;
    email: string;
    avatar: string | null;
  };
  assessment: {
    id: string;
    title: string;
    markScheme: string;
    markSchemePdfUrl: string | null;
    markSchemeFileUrls: string | null;
    totalMarks: number;
    class: {
      name: string;
    };
  };
  adjustments?: ScoreAdjustmentRecord[];
  questionResults?: QuestionResultRecord[];
  gradingMode?: string;
  viewerRole?: "OWNER" | "CO_TEACHER" | "DIRECTOR" | "STUDENT";
  viewerCanManage?: boolean;
  viewerCanViewTeacherData?: boolean;
}

type QuestionStatus = "correct" | "partial" | "incorrect" | "unanswered" | "unknown";

interface ParsedQuestionBlock {
  key: string;
  title: string;
  markdown: string;
  points: number | null;
  maxPoints: number | null;
  status: QuestionStatus;
}

interface ParsedFeedback {
  overallMarkdown: string;
  additionalMarkdown: string;
  questionBlocks: ParsedQuestionBlock[];
}

/** Merge API response with existing viewer fields so mutations don't wipe permissions */
function mergeSubmission(prev: SubmissionDetail | null, next: SubmissionDetail): SubmissionDetail {
  if (!prev) return next;
  return {
    ...next,
    viewerRole: next.viewerRole ?? prev.viewerRole,
    viewerCanManage: next.viewerCanManage ?? prev.viewerCanManage,
    viewerCanViewTeacherData: next.viewerCanViewTeacherData ?? prev.viewerCanViewTeacherData,
  };
}

function isAndroidWebView(): boolean {
  if (typeof window === "undefined") return false;
  const win = window as Window & { AndroidBridge?: unknown };
  const ua = window.navigator.userAgent || "";
  return Boolean(win.AndroidBridge) || /Android/i.test(ua);
}

function parseUrlArray(raw: string | null | undefined): string[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    }

    if (typeof parsed === "string" && parsed.trim().length > 0) {
      return [parsed.trim()];
    }
  } catch {
    const trimmed = raw.trim();
    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("/")
    ) {
      return [trimmed];
    }
  }

  return [];
}

function detectQuestionStatus(
  heading: string,
  points: number | null,
  maxPoints: number | null,
  markdown: string
): QuestionStatus {
  if (heading.includes("✅")) return "correct";
  if (heading.includes("⚠")) return "partial";
  if (heading.includes("❌")) return "incorrect";
  if (heading.includes("⭕") || heading.includes("◯")) return "unanswered";

  if (points !== null && maxPoints !== null && maxPoints > 0) {
    if (points === maxPoints) return "correct";
    if (points === 0) {
      if (/(blank|no answer|unanswered|left blank|bo'sh|javob yo'q|пуст|без ответа)/i.test(markdown)) {
        return "unanswered";
      }
      return "incorrect";
    }
    return "partial";
  }

  return "unknown";
}

function cleanQuestionHeading(heading: string): string {
  return heading.replace(/^(?:✅|⚠️?|❌|⭕|◯|\s)+/u, "").trim();
}

function parseFeedbackMarkdown(feedback: string | null): ParsedFeedback {
  if (!feedback?.trim()) {
    return { overallMarkdown: "", additionalMarkdown: "", questionBlocks: [] };
  }

  // Handle legacy JSON feedback format: {"totalScore":..., "summary":"..."}
  const trimmed = feedback.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed?.summary === "string") {
        return { overallMarkdown: parsed.summary, additionalMarkdown: "", questionBlocks: [] };
      }
    } catch {
      // Not valid JSON, fall through to normal parsing
    }
  }

  const normalized = feedback.replace(/\r\n/g, "\n").trim();
  const withoutHeader = normalized
    .replace(/^##\s+[^\n]+\n*/i, "")
    .replace(/^\*\*(?:Ball|Score|Баллы|Note|Punkte|الدرجة|Бали|得点|得分):[^\n]*\n*/im, "")
    .trim();

  // Match the first ### section (overall feedback) and second ### section (question breakdown)
  // Use generic matching to support all languages
  const sections = withoutHeader.split(/\n(?=###\s+)/);
  const overallSection = sections.find(s => /^###\s+/.test(s));
  const questionSection = sections.length > 1 ? sections.slice(1).find(s => /^###\s+/.test(s)) : null;

  const overallMatch = overallSection
    ? overallSection.match(/^###\s+[^\n]+\n([\s\S]*)$/)
    : null;

  const questionSectionMatch = questionSection
    ? questionSection.match(/^###\s+[^\n]+\n([\s\S]*)$/)
    : null;

  const questionBlocks: ParsedQuestionBlock[] = [];

  if (questionSectionMatch?.[1]) {
    const questionRegex = /####\s+([^\n]+)\n([\s\S]*?)(?=\n####\s+|$)/g;
    let match: RegExpExecArray | null;
    let idx = 0;

    while ((match = questionRegex.exec(questionSectionMatch[1])) !== null) {
      const rawHeading = match[1].trim();
      const rawBody = match[2].trim();

      const scoreMatch = rawBody.match(/\*\*(?:Ball|Score|Баллы|Note|Punkte|الدرجة|Бали|得点|得分):?\*\*:?\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/i);
      const points = scoreMatch ? Number(scoreMatch[1]) : null;
      const maxPoints = scoreMatch ? Number(scoreMatch[2]) : null;
      const markdown = scoreMatch ? rawBody.replace(scoreMatch[0], "").trim() : rawBody;

      const title = cleanQuestionHeading(rawHeading) || `Question ${idx + 1}`;

      questionBlocks.push({
        key: `${title}-${idx}`,
        title,
        markdown: markdown || rawBody,
        points,
        maxPoints,
        status: detectQuestionStatus(rawHeading, points, maxPoints, markdown || rawBody),
      });

      idx += 1;
    }
  }

  let additionalMarkdown = withoutHeader;
  if (overallMatch?.[0]) {
    additionalMarkdown = additionalMarkdown.replace(overallMatch[0], "").trim();
  }
  if (questionSectionMatch?.[0]) {
    additionalMarkdown = additionalMarkdown.replace(questionSectionMatch[0], "").trim();
  }

  const overallMarkdown = overallMatch?.[1]?.trim() || "";

  if (!overallMarkdown && additionalMarkdown) {
    return {
      overallMarkdown: additionalMarkdown,
      additionalMarkdown: "",
      questionBlocks,
    };
  }

  return {
    overallMarkdown,
    additionalMarkdown,
    questionBlocks,
  };
}

function questionResultsToBlocks(results: QuestionResultRecord[]): ParsedQuestionBlock[] {
  return results.map((r, idx) => {
    const qStatus = r.status as QuestionStatus;
    const status: QuestionStatus =
      qStatus === "correct" || qStatus === "partial" || qStatus === "incorrect" || qStatus === "unanswered"
        ? qStatus
        : "unknown";
    const markdown = [r.deductionReason, r.feedback].filter(Boolean).join("\n\n");
    return {
      key: `qr-${r.id}-${idx}`,
      title: r.questionNumber,
      markdown,
      points: r.score,
      maxPoints: r.maxScore,
      status,
    };
  });
}

function getAccuracyTheme(accuracy: number) {
  if (accuracy >= 80) {
    return {
      pageTint:
        "bg-[radial-gradient(1200px_540px_at_58%_-210px,rgba(16,185,129,0.22),transparent_65%)] dark:bg-[radial-gradient(1200px_540px_at_58%_-210px,rgba(16,185,129,0.3),transparent_65%)]",
      panelBorder: "border-green-500 dark:border-green-700",
      accentText: "text-green-800 dark:text-green-500",
      accentBadge:
        "bg-green-200 text-green-900 border-green-500 dark:bg-green-900/60 dark:text-green-200 dark:border-green-700",
      progressBar: "from-green-600 to-green-500",
      overallCard:
        "bg-green-200/90 border-green-600 dark:bg-green-900/50 dark:border-green-600",
    };
  }

  if (accuracy >= 60) {
    return {
      pageTint:
        "bg-[radial-gradient(1200px_540px_at_58%_-210px,rgba(59,130,246,0.22),transparent_65%)] dark:bg-[radial-gradient(1200px_540px_at_58%_-210px,rgba(59,130,246,0.28),transparent_65%)]",
      panelBorder: "border-blue-500 dark:border-blue-700",
      accentText: "text-blue-800 dark:text-blue-500",
      accentBadge:
        "bg-blue-200 text-blue-900 border-blue-500 dark:bg-blue-900/60 dark:text-blue-200 dark:border-blue-700",
      progressBar: "from-blue-600 to-blue-500",
      overallCard: "bg-blue-200/90 border-blue-600 dark:bg-blue-900/50 dark:border-blue-600",
    };
  }

  if (accuracy >= 40) {
    return {
      pageTint:
        "bg-[radial-gradient(1200px_540px_at_58%_-210px,rgba(245,158,11,0.22),transparent_65%)] dark:bg-[radial-gradient(1200px_540px_at_58%_-210px,rgba(245,158,11,0.3),transparent_65%)]",
      panelBorder: "border-amber-500 dark:border-amber-700",
      accentText: "text-amber-800 dark:text-amber-500",
      accentBadge:
        "bg-amber-200 text-amber-900 border-amber-500 dark:bg-amber-900/60 dark:text-amber-200 dark:border-amber-700",
      progressBar: "from-amber-600 to-orange-500",
      overallCard:
        "bg-amber-200/90 border-amber-600 dark:bg-amber-900/50 dark:border-amber-600",
    };
  }

  return {
    pageTint:
      "bg-[radial-gradient(1200px_540px_at_58%_-210px,rgba(239,68,68,0.2),transparent_65%)] dark:bg-[radial-gradient(1200px_540px_at_58%_-210px,rgba(239,68,68,0.28),transparent_65%)]",
    panelBorder: "border-red-500 dark:border-red-700",
    accentText: "text-red-800 dark:text-red-500",
    accentBadge:
      "bg-red-200 text-red-900 border-red-500 dark:bg-red-900/60 dark:text-red-200 dark:border-red-700",
    progressBar: "from-red-600 to-red-500",
    overallCard: "bg-red-200/90 border-red-600 dark:bg-red-900/50 dark:border-red-600",
  };
}

function getQuestionStatusMeta(status: QuestionStatus) {
  switch (status) {
    case "correct":
      return {
        icon: CheckCircle2,
        iconClass: "text-green-700 dark:text-green-500",
        scoreClass: "text-green-800 dark:text-green-500",
        borderClass: "border-green-500 dark:border-green-600",
      };
    case "partial":
      return {
        icon: TriangleAlert,
        iconClass: "text-amber-700 dark:text-amber-500",
        scoreClass: "text-amber-800 dark:text-amber-500",
        borderClass: "border-amber-400 dark:border-amber-600",
      };
    case "incorrect":
      return {
        icon: XCircle,
        iconClass: "text-red-700 dark:text-red-500",
        scoreClass: "text-red-800 dark:text-red-500",
        borderClass: "border-red-500 dark:border-red-600",
      };
    case "unanswered":
      return {
        icon: CircleDashed,
        iconClass: "text-slate-600 dark:text-slate-400",
        scoreClass: "text-slate-700 dark:text-slate-500",
        borderClass: "border-slate-300 dark:border-slate-700",
      };
    default:
      return {
        icon: MessageSquare,
        iconClass: "text-foreground/60",
        scoreClass: "text-foreground/60",
        borderClass: "border-border",
      };
  }
}

function SubmissionImage({ url, index }: { url: string; index: number }) {
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const maxAutoRetries = 3;
  const lowerUrl = url.toLowerCase();
  const isPdf = lowerUrl.endsWith(".pdf");
  const isDoc = lowerUrl.endsWith(".doc") || lowerUrl.endsWith(".docx");

  // Auto-retry with staggered delay when loading fails
  useEffect(() => {
    if (!error || retryCount >= maxAutoRetries) return;
    const delay = (retryCount + 1) * 1500 + index * 300; // stagger by page index
    const timer = setTimeout(() => {
      setError(false);
      setLoading(true);
      setRetryCount((c) => c + 1);
    }, delay);
    return () => clearTimeout(timer);
  }, [error, retryCount, index]);

  if (error && retryCount >= maxAutoRetries) {
    return (
      <div className="w-full aspect-[3/4] bg-muted/50 flex flex-col items-center justify-center gap-2 text-muted-foreground">
        <ImageOff className="h-8 w-8 opacity-40" />
        <span className="text-xs">Failed to load page {index + 1}</span>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs h-7"
          onClick={() => {
            setRetryCount(0);
            setError(false);
            setLoading(true);
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  // While auto-retrying, show spinner instead of error
  if (error && retryCount < maxAutoRetries) {
    return (
      <div className="w-full aspect-[3/4] bg-muted/30 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Submission images are served via /api/uploads/ which handles auth + file serving.
  // Next.js production mode (next start) does NOT serve dynamically-added public/ files,
  // so /uploads/ static paths return 404. The API route's 1-min auth cache mitigates DB load.

  // PDFs and Word docs: need /api/uploads/ for on-the-fly Word→PDF conversion
  if (isPdf || isDoc) {
    const src = isDoc
      ? normalizeImageUrl(url.replace(/\.(docx?|DOCx?)$/i, ".pdf"))
      : normalizeImageUrl(url);
    return (
      <div className="relative bg-card">
        {loading && (
          <div className="absolute inset-0 bg-muted/30 flex items-center justify-center min-h-[200px] z-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        <iframe
          src={src}
          title={`Page ${index + 1}`}
          className="w-full"
          style={{ height: "800px", border: "none" }}
          onLoad={() => setLoading(false)}
          onError={() => { setError(true); setLoading(false); }}
        />
      </div>
    );
  }

  return (
    <div className="relative bg-card">
      {loading && (
        <div className="absolute inset-0 bg-muted/30 flex items-center justify-center min-h-[200px]">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      <img
        src={normalizeImageUrl(url)}
        alt={`Page ${index + 1}`}
        className="w-full h-auto"
        loading={index > 2 ? "lazy" : "eager"}
        onLoad={() => setLoading(false)}
        onError={() => {
          setError(true);
          setLoading(false);
        }}
      />
    </div>
  );
}

function ScoreBadge({ score, maxScore }: { score: number; maxScore: number }) {
  const percentage = Math.round((score / maxScore) * 100);
  const bgColor = percentage >= 80
    ? "bg-green-200 border-green-400 text-green-900 dark:bg-green-900/60 dark:border-green-700 dark:text-green-200"
    : percentage >= 60
      ? "bg-yellow-200 border-yellow-400 text-yellow-900 dark:bg-yellow-900/60 dark:border-yellow-700 dark:text-yellow-200"
      : percentage >= 40
        ? "bg-orange-200 border-orange-400 text-orange-900 dark:bg-orange-900/60 dark:border-orange-700 dark:text-orange-200"
        : "bg-red-200 border-red-400 text-red-900 dark:bg-red-900/60 dark:border-red-700 dark:text-red-200";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-bold",
        bgColor
      )}
    >
      <span className="text-sm font-bold">
        {score}/{maxScore}
      </span>
      <span className="text-xs font-semibold opacity-80">({percentage}%)</span>
    </div>
  );
}

function SafeDocumentFrame({
  src,
  title,
  heightClass,
  blockedTitle,
  blockedDescription,
  openFileLabel,
}: {
  src: string;
  title: string;
  heightClass: string;
  blockedTitle: string;
  blockedDescription: string;
  openFileLabel: string;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  useEffect(() => {
    setBlockedReason(null);
  }, [src]);

  const handleLoad = () => {
    try {
      const text = frameRef.current?.contentDocument?.body?.innerText?.trim();
      if (!text || !text.startsWith("{")) return;

      const parsed = JSON.parse(text) as { error?: string };
      if (parsed?.error) {
        setBlockedReason(parsed.error);
      }
    } catch {
      // Cross-origin or binary document; no-op.
    }
  };

  if (blockedReason) {
    return (
      <div className={cn("w-full flex items-center justify-center p-6", heightClass)}>
        <div className="text-center max-w-sm">
          <div className="mx-auto mb-3 w-12 h-12 rounded-xl bg-muted/60 flex items-center justify-center">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-semibold">{blockedTitle}</p>
          <p className="text-xs text-muted-foreground mt-2">
            {blockedReason === "Forbidden" ? blockedDescription : blockedReason}
          </p>
          <a href={src} target="_blank" rel="noreferrer" className="inline-flex mt-3">
            <Button variant="outline" size="sm">
              {openFileLabel}
            </Button>
          </a>
        </div>
      </div>
    );
  }

  return (
    <iframe
      ref={frameRef}
      src={src}
      className={cn("w-full", heightClass)}
      title={title}
      onLoad={handleLoad}
    />
  );
}

const TAB_ORDER_KEY = "mobile-tab-order";
const DEFAULT_TAB_ORDER: TabId[] = ["feedback", "markScheme", "studentWork"];
type TabId = "feedback" | "markScheme" | "studentWork";

function getInitialTabOrder(): TabId[] {
  if (typeof window === "undefined") return DEFAULT_TAB_ORDER;
  try {
    const stored = localStorage.getItem(TAB_ORDER_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as TabId[];
      if (Array.isArray(parsed) && parsed.length === 3 && DEFAULT_TAB_ORDER.every((id) => parsed.includes(id))) {
        return parsed;
      }
    }
  } catch {}
  return DEFAULT_TAB_ORDER;
}

function SortableTab({ id, label, Icon, isActive, onTap }: { id: string; label: string; Icon: React.ComponentType<{ className?: string }>; isActive: boolean; onTap: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };
  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      {...attributes}
      {...listeners}
      onClick={onTap}
      className={cn(
        "flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium border-b-2 transition-colors touch-manipulation",
        isActive ? "border-primary text-primary" : "border-transparent text-muted-foreground"
      )}
    >
      <Icon className="h-[15px] w-[15px]" />
      {label}
    </button>
  );
}

export default function SubmissionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { language, t } = useLanguage();

  const [submission, setSubmission] = useState<SubmissionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [adjustedScore, setAdjustedScore] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);

  const [gradeDialogOpen, setGradeDialogOpen] = useState(false);
  const [manualScore, setManualScore] = useState("");
  const [manualFeedback, setManualFeedback] = useState("");
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [grading, setGrading] = useState(false);

  const [expandedQuestions, setExpandedQuestions] = useState<Record<string, boolean>>({});

  // Inline per-question score editing
  const [inlineEditIndex, setInlineEditIndex] = useState<number | null>(null);
  const [inlineEditScore, setInlineEditScore] = useState("");
  const [inlineEditReason, setInlineEditReason] = useState("");
  const [inlineSaving, setInlineSaving] = useState(false);

  // Mobile swipe tabs
  const [mobileTab, setMobileTab] = useState(0);
  const mobileSwipeRef = useRef<HTMLDivElement>(null);
  const [tabOrder, setTabOrder] = useState<TabId[]>(DEFAULT_TAB_ORDER);

  useEffect(() => {
    setTabOrder(getInitialTabOrder());
  }, []);

  const tabSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  const handleTabDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setTabOrder((prev) => {
      const oldIdx = prev.indexOf(active.id as TabId);
      const newIdx = prev.indexOf(over.id as TabId);
      const next = arrayMove(prev, oldIdx, newIdx);
      try { localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const handleMobileSwipeScroll = useCallback(() => {
    const el = mobileSwipeRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setMobileTab(idx);
  }, []);

  const switchMobileTab = useCallback((idx: number) => {
    const el = mobileSwipeRef.current;
    if (!el) return;
    el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" });
    setMobileTab(idx);
  }, []);

  const assessmentId = params.assessmentId as string;
  const submissionId = params.submissionId as string;

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024 || isAndroidWebView());
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Lock body scroll on mobile to prevent WebView scroll-chaining
  useEffect(() => {
    if (!isMobile) return;
    const origBody = document.body.style.overflow;
    const origHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = origBody;
      document.documentElement.style.overflow = origHtml;
    };
  }, [isMobile]);

  const fetchSubmission = useCallback(async () => {
    try {
      const data = await cachedFetch(`/api/submissions/${submissionId}`);
      if (!data) throw new Error("Submission not found");
      setSubmission(data.submission);
    } catch {
      toast({
        title: "Error",
        description: "Failed to load submission",
        variant: "destructive",
      });
      router.push(`/assessments/${assessmentId}`);
    } finally {
      setLoading(false);
    }
  }, [submissionId, assessmentId, toast, router]);

  useEffect(() => {
    fetchSubmission();
  }, [fetchSubmission]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (submission?.status === "PROCESSING") {
      interval = setInterval(() => {
        invalidateCache(`/api/submissions/${submissionId}`);
        fetchSubmission();
      }, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [submission?.status, fetchSubmission, submissionId]);

  const handleAdjustScore = async () => {
    if (!submission) return;

    const score = parseInt(adjustedScore, 10);
    const maxAllowed = submission.maxScore || submission.assessment?.totalMarks || 100;
    if (Number.isNaN(score) || score < 0 || score > maxAllowed) {
      toast({
        title: "Invalid Score",
        description: `Score must be between 0 and ${maxAllowed}`,
        variant: "destructive",
      });
      return;
    }

    if (!adjustmentReason.trim()) {
      toast({
        title: "Reason Required",
        description: "Please provide a reason for the adjustment",
        variant: "destructive",
      });
      return;
    }

    setAdjusting(true);
    try {
      const response = await fetch(`/api/submissions/${submissionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, reason: adjustmentReason }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to adjust score");
      }

      const data = await response.json();
      setSubmission((prev) => mergeSubmission(prev, data.submission));
      invalidateCache(`/api/submissions/${submissionId}`);
      setAdjustDialogOpen(false);
      setAdjustedScore("");
      setAdjustmentReason("");
      toast({ title: "Score Adjusted", description: "The score has been updated successfully" });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to adjust score",
        variant: "destructive",
      });
    } finally {
      setAdjusting(false);
    }
  };

  const handleManualGrade = async () => {
    if (!submission) return;

    const score = parseInt(manualScore, 10);
    const maxAllowed = submission.maxScore || submission.assessment?.totalMarks || 100;
    if (Number.isNaN(score) || score < 0 || score > maxAllowed) {
      toast({
        title: "Invalid Score",
        description: `Score must be between 0 and ${maxAllowed}`,
        variant: "destructive",
      });
      return;
    }

    setGrading(true);
    try {
      const response = await fetch(`/api/submissions/${submissionId}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, feedback: manualFeedback }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to grade submission");
      }

      const data = await response.json();
      setSubmission((prev) => mergeSubmission(prev, data.submission));
      invalidateCache(`/api/submissions/${submissionId}`);
      setGradeDialogOpen(false);
      setManualScore("");
      setManualFeedback("");
      toast({ title: "Submission Graded", description: "The submission has been graded successfully" });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to grade submission",
        variant: "destructive",
      });
    } finally {
      setGrading(false);
    }
  };

  const handleDismissReport = async () => {
    if (!submission) return;

    try {
      const res = await fetch(`/api/submissions/${submissionId}/report`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      setSubmission({ ...submission, reportReason: null, reportedAt: null });
      invalidateCache(`/api/submissions/${submissionId}`);
      toast({ title: t("reportDismissed"), description: t("reportDismissedDesc") });
    } catch {
      toast({ title: t("error"), variant: "destructive" });
    }
  };

  const copy = useMemo(() => {
    if (language === "uz") {
      return {
        studentWork: "O'quvchi ishi",
        feedback: "Izoh",
        markScheme: "Javoblar sxemasi",
        page: "Sahifa",
        pages: "sahifa",
        file: "fayl",
        files: "fayl",
        aiFeedback: "AI izohi",
        scoreResults: "Baholash Natijalari",
        scoreWord: "Ball",
        percentWord: "Foiz",
        overallFeedback: "Umumiy Fikr-mulohaza",
        questionAnalysis: "Savol bo'yicha Tahlil",
        additionalNotes: "Qo'shimcha eslatmalar",
        awaitingGrade: "Qo'lda baholash kutilmoqda",
        processing: "Tekshirilmoqda...",
        error: "Xatolik yuz berdi",
        gradeNow: "Baholash",
        adjustScore: "Ballni o'zgartirish",
        adjustmentHistory: "O'zgartirishlar tarixi",
        overallAdjustment: "Umumiy ball o'zgartirildi",
        submissionDate: "Yuborilgan sana",
        openFile: "Faylni ochish",
        previewBlocked: "Ko'rish cheklangan",
        previewBlockedDesc: "Bu faylni ko'rish uchun ruxsat yo'q yoki fayl mavjud emas.",
        inlineReasonPlaceholder: "O'zgartirish sababi...",
      };
    }

    if (language === "ru") {
      return {
        studentWork: "Работа ученика",
        feedback: "Отзыв",
        markScheme: "Схема оценки",
        page: "Стр.",
        pages: "стр.",
        file: "файл",
        files: "файлов",
        aiFeedback: "Отзыв AI",
        scoreResults: "Результаты Оценки",
        scoreWord: "Баллы",
        percentWord: "Процент",
        overallFeedback: "Общий Отзыв",
        questionAnalysis: "Разбор по Вопросам",
        additionalNotes: "Дополнительные заметки",
        awaitingGrade: "Ожидает ручной проверки",
        processing: "Обработка...",
        error: "Ошибка обработки",
        gradeNow: "Оценить",
        adjustScore: "Изменить балл",
        adjustmentHistory: "История изменений",
        overallAdjustment: "Общий балл изменён",
        submissionDate: "Дата отправки",
        openFile: "Открыть файл",
        previewBlocked: "Предпросмотр ограничен",
        previewBlockedDesc: "Нет доступа к файлу или файл недоступен.",
        inlineReasonPlaceholder: "Причина изменения...",
      };
    }

    return {
      studentWork: "Student Work",
      feedback: "Feedback",
      markScheme: "Mark Scheme",
      page: "Page",
      pages: "pages",
      file: "file",
      files: "files",
      aiFeedback: "AI Feedback",
      scoreResults: "Grading Results",
      scoreWord: "Score",
      percentWord: "Percent",
      overallFeedback: "Overall Feedback",
      questionAnalysis: "Question-by-Question Breakdown",
      additionalNotes: "Additional notes",
      awaitingGrade: "Awaiting Manual Grade",
      processing: "Processing...",
      error: "Error processing",
      gradeNow: "Grade",
      adjustScore: "Adjust Score",
      adjustmentHistory: "Adjustment History",
      overallAdjustment: "Overall score adjusted",
      submissionDate: "Submitted",
      openFile: "Open File",
      previewBlocked: "Preview blocked",
      previewBlockedDesc: "You don't have permission to view this file or it is unavailable.",
      inlineReasonPlaceholder: "Reason for change...",
    };
  }, [language]);

  const imageUrls = useMemo(() => parseUrlArray(submission?.imageUrls), [submission?.imageUrls]);
  const markSchemeUrls = useMemo(() => {
    const fromFiles = parseUrlArray(submission?.assessment.markSchemeFileUrls);
    if (fromFiles.length > 0) return fromFiles;
    return submission?.assessment.markSchemePdfUrl ? [submission.assessment.markSchemePdfUrl] : [];
  }, [submission?.assessment.markSchemeFileUrls, submission?.assessment.markSchemePdfUrl]);

  const parsedFeedback = useMemo((): ParsedFeedback => {
    const qrBlocks = submission?.questionResults?.length
      ? questionResultsToBlocks(submission.questionResults)
      : null;
    const markdownParsed = parseFeedbackMarkdown(submission?.feedback ?? null);
    if (qrBlocks) {
      return {
        overallMarkdown: markdownParsed.overallMarkdown,
        additionalMarkdown: markdownParsed.additionalMarkdown,
        questionBlocks: qrBlocks,
      };
    }
    return markdownParsed;
  }, [submission?.feedback, submission?.questionResults]);

  // Prefer AI-detected maxScore from graded submission (reads mark scheme), then teacher-set totalMarks
  const displayMaxScore =
    (submission?.maxScore && submission.maxScore > 0)
      ? submission.maxScore
      : (submission?.assessment.totalMarks && submission.assessment.totalMarks > 0)
        ? submission.assessment.totalMarks
        : 100;
  const hasScore =
    submission?.status === "GRADED" &&
    submission.score !== null &&
    displayMaxScore > 0;

  const accuracy = hasScore ? Math.round((submission!.score! / displayMaxScore) * 100) : 0;
  const accuracyTheme = getAccuracyTheme(accuracy);

  useEffect(() => {
    if (!parsedFeedback.questionBlocks.length) {
      setExpandedQuestions({});
      return;
    }

    setExpandedQuestions((previous) => {
      const next: Record<string, boolean> = {};
      parsedFeedback.questionBlocks.forEach((question, index) => {
        next[question.key] = previous[question.key] ?? index === 0;
      });
      return next;
    });
  }, [parsedFeedback.questionBlocks]);

  if (loading) return <SubmissionSkeleton />;
  if (!submission) return null;
  const canManageSubmission = Boolean(submission.viewerCanManage);

  const statusBadge = (() => {
    if (submission.status === "PENDING") {
      return <Badge variant="pending">{copy.awaitingGrade}</Badge>;
    }

    if (submission.status === "PROCESSING") {
      return (
        <Badge variant="processing" className="gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
          {copy.processing}
        </Badge>
      );
    }

    if (submission.status === "ERROR") {
      return <Badge variant="error">{copy.error}</Badge>;
    }

    return null;
  })();

  const toggleQuestion = (key: string) => {
    setExpandedQuestions((previous) => ({ ...previous, [key]: !previous[key] }));
  };

  const handleInlineSave = async (questionIndex: number, maxPoints: number) => {
    if (!submission) return;

    const score = Number(inlineEditScore);
    if (Number.isNaN(score) || score < 0 || score > maxPoints) {
      toast({
        title: language === "uz" ? "Noto'g'ri ball" : language === "ru" ? "Неверный балл" : "Invalid Score",
        description: language === "uz"
          ? `Ball 0 va ${maxPoints} orasida bo'lishi kerak`
          : language === "ru"
            ? `Балл должен быть от 0 до ${maxPoints}`
            : `Score must be between 0 and ${maxPoints}`,
        variant: "destructive",
      });
      return;
    }

    if (!inlineEditReason.trim()) {
      toast({
        title: language === "uz" ? "Sabab kerak" : language === "ru" ? "Укажите причину" : "Reason Required",
        description: language === "uz"
          ? "O'zgartirish sababini kiriting"
          : language === "ru"
            ? "Укажите причину изменения"
            : "Please provide a reason for the change",
        variant: "destructive",
      });
      return;
    }

    setInlineSaving(true);
    try {
      const response = await fetch(`/api/submissions/${submissionId}/adjust-questions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questions: [{ index: questionIndex, points: score, reason: inlineEditReason.trim() }],
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to adjust score");
      }

      const data = await response.json();
      setSubmission((prev) => mergeSubmission(prev, data.submission));
      invalidateCache(`/api/submissions/${submissionId}`);
      setInlineEditIndex(null);
      setInlineEditScore("");
      setInlineEditReason("");
      toast({
        title: language === "uz" ? "Ball o'zgartirildi" : language === "ru" ? "Балл изменён" : "Score Updated",
        description: language === "uz"
          ? "Savol balli muvaffaqiyatli yangilandi"
          : language === "ru"
            ? "Балл за вопрос успешно обновлён"
            : "Question score has been updated",
      });
    } catch (error) {
      toast({
        title: language === "uz" ? "Xato" : language === "ru" ? "Ошибка" : "Error",
        description: error instanceof Error ? error.message : "Failed to adjust score",
        variant: "destructive",
      });
    } finally {
      setInlineSaving(false);
    }
  };

  const renderStudentWorkPanel = (
    <section
      className={cn(
        "rounded-2xl border bg-card/95 shadow-sm backdrop-blur-sm flex flex-col transition-all duration-300",
        accuracyTheme.panelBorder,
        isMobile ? "h-auto min-h-[500px]" : "h-full overflow-hidden"
      )}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-background/80 shrink-0">
        <FileImage className="h-4 w-4 text-foreground/60" />
        <span className="text-xs font-semibold text-foreground/70 uppercase tracking-wider">
          {copy.studentWork}
        </span>
        <span className="ml-auto text-xs text-foreground/50">
          {imageUrls.length} {copy.pages}
        </span>
      </div>

      <div className={cn("p-3", isMobile ? "h-auto" : "flex-1 overflow-auto min-h-0")}>
        <div className="space-y-3">
          {imageUrls.map((url, index) => (
            <div
              key={index}
              className={cn(
                "rounded-xl overflow-hidden border bg-card shadow-[0_1px_3px_rgba(15,23,42,0.08)] dark:shadow-none",
                index === 0 && "border-primary ring-1 ring-primary/20"
              )}
            >
              <div className="px-3 py-1.5 text-xs text-foreground/60 border-b bg-muted/40 flex items-center">
                {copy.page} {index + 1}
                {index === 0 && <span className="ml-auto inline-flex h-2.5 w-2.5 rounded-full bg-primary" />}
              </div>
              <SubmissionImage url={url} index={index} />
            </div>
          ))}

          {imageUrls.length === 0 && (
            <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground text-sm">
              {language === "uz"
                ? "Yuklangan sahifalar topilmadi"
                : language === "ru"
                  ? "Загруженные страницы не найдены"
                  : "No uploaded pages found"}
            </div>
          )}
        </div>
      </div>
    </section>
  );

  const renderFeedbackPanel = (
    <section
      className={cn(
        "rounded-2xl border bg-card/95 shadow-sm backdrop-blur-sm flex flex-col transition-all duration-300",
        accuracyTheme.panelBorder,
        isMobile ? "h-auto" : "h-full overflow-hidden"
      )}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-background/80 shrink-0">
        <MessageSquare className="h-4 w-4 text-foreground/60" />
        <span className="text-xs font-semibold text-foreground/70 uppercase tracking-wider">
          {copy.feedback}
        </span>
      </div>

      <div className={cn("p-4 md:p-5 space-y-4 overflow-y-auto", isMobile ? "h-auto" : "flex-1 min-h-0")}>
        <div className="rounded-xl border bg-background/70 px-4 py-3 flex items-center gap-3">
          {submission.student.avatar ? (
            <img
              src={normalizeImageUrl(submission.student.avatar)}
              alt={submission.student.name}
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
              <User className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{submission.student.name}</p>
            <p className="text-xs text-muted-foreground truncate">{submission.student.email}</p>
          </div>
          <div className="text-right text-xs text-muted-foreground shrink-0">
            <p>{copy.submissionDate}</p>
            <p>{formatDate(submission.createdAt)}</p>
          </div>
        </div>

        {hasScore && (
          <div className={cn("rounded-2xl border bg-background/80 p-5", accuracyTheme.panelBorder)}>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">
                  {copy.scoreResults}
                </p>
                <div className="mt-2 flex items-end gap-2">
                  <span className={cn("text-4xl sm:text-5xl font-bold leading-none", accuracyTheme.accentText)}>
                    {submission.score}
                  </span>
                  <span className="text-2xl font-semibold text-foreground/50">/{displayMaxScore}</span>
                </div>
                <p className="mt-2 text-xs text-foreground/50">
                  {copy.scoreWord} • {copy.percentWord}
                </p>
              </div>
              <Badge variant="outline" className={cn("text-lg px-3 py-1 border", accuracyTheme.accentBadge)}>
                {accuracy}%
              </Badge>
            </div>

            <div className="mt-4 h-3 rounded-full bg-muted border overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full bg-gradient-to-r transition-all duration-700",
                  accuracyTheme.progressBar
                )}
                style={{ width: `${Math.max(0, Math.min(100, accuracy))}%` }}
              />
            </div>
          </div>
        )}

        {submission.status === "PENDING" && canManageSubmission && (
          <div className="rounded-xl border bg-background/70 p-5">
            <p className="text-sm font-medium">{copy.awaitingGrade}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {language === "uz"
                ? "Bu ish qo'lda baholashga tayyor."
                : language === "ru"
                  ? "Эта работа готова для ручной проверки."
                  : "This submission is ready for manual grading."}
            </p>
            <Button className="mt-3" size="sm" onClick={() => setGradeDialogOpen(true)}>
              <Pencil className="h-3.5 w-3.5 mr-2" />
              {copy.gradeNow}
            </Button>
          </div>
        )}

        {submission.status === "PROCESSING" && (
          <div className="p-8 text-center rounded-xl border bg-background/70">
            <div className="animate-spin h-6 w-6 border-2 border-primary/20 border-t-primary rounded-full mx-auto mb-3" />
            <p className="text-sm font-medium">{copy.processing}</p>
          </div>
        )}

        {submission.status === "ERROR" && (
          <div className="p-4 text-center rounded-xl border bg-destructive/10 border-destructive/30">
            <p className="text-sm font-medium text-destructive">{copy.error}</p>
            {submission.feedback && <p className="text-xs text-muted-foreground mt-1">{submission.feedback}</p>}
          </div>
        )}

        {submission.status === "GRADED" && submission.feedback && parsedFeedback.overallMarkdown && (
          <div className={cn("rounded-xl border p-4", accuracyTheme.overallCard)}>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className={cn("h-4 w-4", accuracyTheme.accentText)} />
              <h3 className="text-sm font-semibold">{copy.overallFeedback}</h3>
            </div>
            <div className="markdown-content feedback-rich prose prose-sm dark:prose-invert max-w-none text-foreground leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{parsedFeedback.overallMarkdown}</ReactMarkdown>
            </div>
          </div>
        )}

        {submission.status === "GRADED" && submission.feedback && parsedFeedback.questionBlocks.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{copy.questionAnalysis}</h3>

            {parsedFeedback.questionBlocks.map((question, questionIndex) => {
              const statusMeta = getQuestionStatusMeta(question.status);
              const StatusIcon = statusMeta.icon;
              const isOpen = Boolean(expandedQuestions[question.key]);

              const percentage =
                question.points !== null && question.maxPoints !== null && question.maxPoints > 0
                  ? Math.round((question.points / question.maxPoints) * 100)
                  : null;

              const hasDiagram = /diagram|graph|📎|рисун|диаграмм|grafik|chizma/i.test(question.markdown);

              return (
                <div
                  key={question.key}
                  className={cn(
                    "rounded-xl border bg-background/70 overflow-hidden transition-colors",
                    statusMeta.borderClass
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleQuestion(question.key)}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left"
                  >
                    <StatusIcon className={cn("h-4 w-4 shrink-0", statusMeta.iconClass)} />
                    <span className="text-sm font-semibold truncate">{question.title}</span>

                    <div className="ml-auto flex items-center gap-2 shrink-0">
                      {hasDiagram && (
                        <span title="This question contains a diagram. Consider reviewing for accuracy.">
                          <BarChart2 className="h-4 w-4 text-violet-500 dark:text-violet-400" />
                        </span>
                      )}
                      {question.points !== null && question.maxPoints !== null && (
                        canManageSubmission ? (
                          <span
                            className={cn(
                              "text-sm font-semibold cursor-pointer underline decoration-dotted underline-offset-2 decoration-current/40 hover:decoration-current/80 transition-all group/score inline-flex items-center gap-1",
                              statusMeta.scoreClass
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              setInlineEditIndex(questionIndex);
                              setInlineEditScore(String(question.points));
                              setInlineEditReason("");
                            }}
                            title={language === "uz" ? "Ballni o'zgartirish" : language === "ru" ? "Изменить балл" : "Edit score"}
                          >
                            {question.points}/{question.maxPoints}
                            {percentage !== null ? ` · ${percentage}%` : ""}
                            <Pencil className="h-3 w-3 opacity-0 group-hover/score:opacity-60 transition-opacity shrink-0" />
                          </span>
                        ) : (
                          <span className={cn("text-sm font-semibold", statusMeta.scoreClass)}>
                            {question.points}/{question.maxPoints}
                            {percentage !== null ? ` · ${percentage}%` : ""}
                          </span>
                        )
                      )}
                      {isOpen ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </button>

                  {/* Inline score edit form */}
                  {inlineEditIndex === questionIndex && question.maxPoints !== null && (
                    <div className="border-t px-4 py-3 bg-primary/5 dark:bg-primary/10 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <label className="text-xs font-medium text-foreground/70 shrink-0">
                            {copy.scoreWord}:
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={question.maxPoints}
                            value={inlineEditScore}
                            onChange={(e) => {
                              const val = e.target.value;
                              const num = Number(val);
                              if (val === "" || (num >= 0 && num <= question.maxPoints!)) {
                                setInlineEditScore(val);
                              }
                            }}
                            className="w-14 h-7 text-center text-sm font-semibold rounded border border-primary/30 bg-background focus:ring-1 focus:ring-primary/40 focus:border-primary outline-none"
                            autoFocus
                          />
                          <span className="text-sm text-foreground/50">/{question.maxPoints}</span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-1 min-w-[160px]">
                          <input
                            type="text"
                            value={inlineEditReason}
                            onChange={(e) => setInlineEditReason(e.target.value)}
                            placeholder={copy.inlineReasonPlaceholder}
                            className="flex-1 h-7 px-2 text-sm rounded border border-border bg-background focus:ring-1 focus:ring-primary/40 focus:border-primary outline-none placeholder:text-muted-foreground/60"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && inlineEditReason.trim() && inlineEditScore !== "") {
                                handleInlineSave(questionIndex, question.maxPoints!);
                              }
                              if (e.key === "Escape") {
                                setInlineEditIndex(null);
                                setInlineEditScore("");
                                setInlineEditReason("");
                              }
                            }}
                          />
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            size="sm"
                            className="h-7 text-xs px-3"
                            disabled={inlineSaving || !inlineEditReason.trim() || inlineEditScore === ""}
                            onClick={() => handleInlineSave(questionIndex, question.maxPoints!)}
                          >
                            {inlineSaving ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <>{language === "uz" ? "Saqlash" : language === "ru" ? "Сохранить" : "Save"}</>
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs px-2"
                            disabled={inlineSaving}
                            onClick={() => {
                              setInlineEditIndex(null);
                              setInlineEditScore("");
                              setInlineEditReason("");
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {isOpen && (
                    <div className="border-t px-4 pb-4 pt-3">
                      <div className="markdown-content feedback-rich prose prose-sm dark:prose-invert max-w-none text-foreground leading-relaxed">
                        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{question.markdown}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {submission.status === "GRADED" && submission.feedback && parsedFeedback.additionalMarkdown && (
          <div className="rounded-xl border bg-background/70 p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">{copy.additionalNotes}</h3>
            <div className="markdown-content feedback-rich prose prose-sm dark:prose-invert max-w-none text-foreground leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{parsedFeedback.additionalMarkdown}</ReactMarkdown>
            </div>
          </div>
        )}

        {/* Adjustment History — show when there are ScoreAdjustment records OR legacy adjustmentReason */}
        {((submission.adjustments && submission.adjustments.length > 0) || submission.adjustmentReason) && (
          <div className="rounded-xl border border-orange-300 dark:border-orange-700 overflow-hidden">
            <button
              type="button"
              onClick={() => setHistoryExpanded(!historyExpanded)}
              className="w-full px-4 py-3 flex items-center gap-3 bg-orange-50 dark:bg-orange-950/60 hover:bg-orange-100 dark:hover:bg-orange-950/80 transition-colors"
            >
              <History className="h-4 w-4 text-orange-700 dark:text-orange-400 shrink-0" />
              <span className="text-sm font-semibold text-orange-900 dark:text-orange-100">
                {copy.adjustmentHistory}
              </span>
              {submission.originalScore !== null && (
                <span className="text-xs font-medium text-orange-700 dark:text-orange-300 ml-1">
                  {submission.originalScore}/{displayMaxScore} &rarr; {submission.score}/{displayMaxScore}
                </span>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px] border-orange-400 text-orange-700 dark:text-orange-300 dark:border-orange-600">
                  {submission.adjustments?.length || 1}
                </Badge>
                {historyExpanded ? (
                  <ChevronUp className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                )}
              </div>
            </button>

            {historyExpanded && (
              <div className="border-t border-orange-200 dark:border-orange-800">
                {submission.adjustments && submission.adjustments.length > 0 ? (
                  <div className="divide-y divide-orange-100 dark:divide-orange-900/50">
                    {submission.adjustments.map((adj) => {
                      let changes: AdjustmentChange[] = [];
                      try {
                        changes = JSON.parse(adj.changes);
                      } catch {
                        changes = [];
                      }
                      const isOverall = changes.length === 1 && changes[0].questionIndex === -1;

                      return (
                        <div key={adj.id} className="px-4 py-3 bg-white dark:bg-background/50">
                          <div className="flex items-center gap-2 mb-2">
                            <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="text-xs text-muted-foreground">
                              {formatDate(adj.adjustedAt)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              &middot; {adj.adjuster.name}
                            </span>
                            <span className={cn(
                              "ml-auto text-xs font-semibold",
                              adj.scoreAfter > adj.scoreBefore
                                ? "text-green-700 dark:text-green-400"
                                : adj.scoreAfter < adj.scoreBefore
                                  ? "text-red-700 dark:text-red-400"
                                  : "text-muted-foreground"
                            )}>
                              {adj.scoreBefore} &rarr; {adj.scoreAfter}/{displayMaxScore}
                            </span>
                          </div>

                          {isOverall ? (
                            <div className="ml-5.5 pl-0.5">
                              <p className="text-sm text-foreground/80 leading-relaxed">
                                <span className="font-medium text-foreground/60">{copy.overallAdjustment}:</span>{" "}
                                {changes[0].reason}
                              </p>
                            </div>
                          ) : (
                            <div className="ml-5.5 pl-0.5 space-y-1.5">
                              {changes.map((change, ci) => (
                                <div key={ci} className="text-sm">
                                  <div className="flex items-baseline gap-1.5 flex-wrap">
                                    <span className="font-medium text-foreground/90">
                                      Q{change.questionIndex + 1}
                                      {change.questionTitle && change.questionTitle !== `Question ${change.questionIndex + 1}`
                                        ? ` (${change.questionTitle})`
                                        : ""}
                                      :
                                    </span>
                                    <span className="text-muted-foreground line-through">
                                      {change.pointsBefore}
                                    </span>
                                    <span className="text-foreground/60">&rarr;</span>
                                    <span className="font-semibold text-foreground">
                                      {change.pointsAfter}/{change.maxPoints}
                                    </span>
                                  </div>
                                  {change.reason && (
                                    <p className="text-xs text-muted-foreground mt-0.5 ml-0.5 italic leading-relaxed">
                                      {change.reason}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Legacy fallback — show old adjustmentReason when no ScoreAdjustment records exist */
                  <div className="px-4 py-3 bg-white dark:bg-background/50">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="h-4 w-4 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
                      <div className="space-y-1 min-w-0">
                        <p className="text-sm font-medium text-orange-900 dark:text-orange-100">{t("scoreAdjustedByTeacher")}</p>
                        <p className="text-sm text-foreground/80 leading-relaxed">{submission.adjustmentReason}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {submission.reportedAt && (
          <div className="p-3 border rounded-xl bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
            <div className="flex items-start gap-2">
              <Flag className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="space-y-1 text-sm min-w-0 flex-1">
                <p className="font-medium text-amber-800 dark:text-amber-200">{t("reported")}</p>
                {submission.reportReason && (
                  <p className="text-xs text-amber-700/90 dark:text-amber-500/90 italic">
                    &ldquo;{submission.reportReason}&rdquo;
                  </p>
                )}
                {canManageSubmission && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1 mt-1 -ml-2 text-amber-800 dark:text-amber-200"
                    onClick={handleDismissReport}
                  >
                    <X className="h-3 w-3" />
                    {t("dismissReport")}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );

  const renderMarkSchemePanel = (
    <section
      className={cn(
        "rounded-2xl border bg-card/95 shadow-sm backdrop-blur-sm flex flex-col transition-all duration-300",
        accuracyTheme.panelBorder,
        isMobile ? "h-auto" : "h-full overflow-hidden"
      )}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-background/80 shrink-0">
        <BookOpen className="h-4 w-4 text-foreground/60" />
        <span className="text-xs font-semibold text-foreground/70 uppercase tracking-wider">
          {copy.markScheme}
        </span>
        <span className="ml-auto text-xs text-foreground/50">
          {markSchemeUrls.length} {markSchemeUrls.length === 1 ? copy.file : copy.files}
        </span>
      </div>

      <div
        className={cn(
          "overflow-y-auto",
          isMobile ? "max-h-[85vh]" : "flex-1 min-h-0"
        )}
      >
        {markSchemeUrls.length > 0 ? (
          <div className="h-full flex flex-col">
            {markSchemeUrls.map((url, index) => {
              const lowerUrl = url.toLowerCase();
              const isPdf = lowerUrl.endsWith(".pdf");
              const isDoc = lowerUrl.endsWith(".doc") || lowerUrl.endsWith(".docx");
              const isExcel = lowerUrl.endsWith(".xls") || lowerUrl.endsWith(".xlsx");
              const normalizedUrl = normalizeImageUrl(url);
              const fileName = url.split("/").pop() || `File ${index + 1}`;

              return (
                <div
                  key={`${url}-${index}`}
                  className={cn(
                    "border-b last:border-b-0",
                    markSchemeUrls.length === 1 && (isPdf || (!isDoc && !isExcel)) ? "flex-1 min-h-0" : ""
                  )}
                >
                  {markSchemeUrls.length > 1 && (
                    <div className="px-3 py-1.5 text-xs text-muted-foreground border-b bg-muted/20">
                      {copy.page} {index + 1}
                    </div>
                  )}

                  {isPdf ? (
                    <SafeDocumentFrame
                      src={normalizedUrl}
                      title={`Mark Scheme ${index + 1}`}
                      heightClass={
                        isMobile
                          ? "h-[80vh] min-h-[460px]"
                          : markSchemeUrls.length === 1
                            ? "h-full"
                            : "h-[560px]"
                      }
                      blockedTitle={copy.previewBlocked}
                      blockedDescription={copy.previewBlockedDesc}
                      openFileLabel={copy.openFile}
                    />
                  ) : isDoc ? (
                    <SafeDocumentFrame
                      src={normalizeImageUrl(url.replace(/\.(docx?|DOCx?)$/, ".pdf"))}
                      title={`Mark Scheme ${index + 1}`}
                      heightClass={
                        isMobile
                          ? "h-[80vh] min-h-[460px]"
                          : markSchemeUrls.length === 1
                            ? "h-full"
                            : "h-[560px]"
                      }
                      blockedTitle={copy.previewBlocked}
                      blockedDescription={copy.previewBlockedDesc}
                      openFileLabel={copy.openFile}
                    />
                  ) : isExcel ? (
                    <div className="p-6 flex flex-col items-center justify-center gap-3">
                      <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
                      <p className="text-sm font-medium truncate max-w-full">{fileName}</p>
                      <a href={normalizedUrl} download className="inline-flex">
                        <Button variant="outline" size="sm" className="gap-2">
                          <Download className="h-4 w-4" />
                          {t("download")}
                        </Button>
                      </a>
                    </div>
                  ) : (
                    <img src={normalizedUrl} alt={`Mark Scheme ${index + 1}`} className="w-full h-auto" width={800} height={1100} />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center p-6">
              <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm">
                {language === "uz"
                  ? "Javoblar sxemasi fayllari yo'q"
                  : language === "ru"
                    ? "Нет файлов схемы оценки"
                    : "No mark scheme files"}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );

  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col">
      <div className="border-b bg-background/95 backdrop-blur-sm px-3 py-2.5 flex items-center gap-2">
        <Link href={`/assessments/${assessmentId}`}>
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Back to Assessment">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <Link href="/classes">
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Home">
            <BookOpenCheck className="h-4 w-4" />
          </Button>
        </Link>

        {hasScore ? <ScoreBadge score={submission.score!} maxScore={displayMaxScore} /> : statusBadge}

        {submission.originalScore !== null && submission.originalScore !== submission.score && (
          <Badge variant="outline" className="h-7 text-xs">
            AI: {submission.originalScore}/{displayMaxScore}
          </Badge>
        )}

        <div className="flex items-center gap-1 ml-1">
          {canManageSubmission && (
            <Link href={`/assessments/${assessmentId}/submit?resubmit=${submissionId}`}>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title={language === "uz" ? "Qayta topshirish" : language === "ru" ? "Отправить снова" : "Resubmit"}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </Link>
          )}

          {submission.status === "PENDING" && canManageSubmission && (
            <Button
              size="sm"
              className="h-8"
              title={copy.gradeNow}
              onClick={() => {
                setManualScore("");
                setManualFeedback("");
                setGradeDialogOpen(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              {copy.gradeNow}
            </Button>
          )}

          {submission.status === "GRADED" && canManageSubmission && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title={copy.adjustScore}
              onClick={() => {
                setAdjustedScore(String(submission.score || 0));
                setAdjustDialogOpen(true);
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}

          {submission.reportedAt && (
            <Badge variant="warning" className="h-7 text-xs">
              <Flag className="h-3 w-3 mr-1" />
              {t("reported")}
            </Badge>
          )}
        </div>

        <span className="ml-auto text-xs text-muted-foreground truncate max-w-[320px] hidden sm:block">
          {submission.assessment.title} • {submission.student.name}
        </span>
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div className={cn("absolute inset-0 pointer-events-none", accuracyTheme.pageTint)} />

        {!isMobile ? (
          <div className="relative h-full min-h-0 p-3 md:p-4">
            <ResizablePanelLayout
              panels={[
                { id: "work", label: copy.studentWork, icon: FileImage, defaultFlex: 0.95, content: renderStudentWorkPanel },
                { id: "feedback", label: copy.feedback, icon: MessageSquare, defaultFlex: 1.6, content: renderFeedbackPanel },
                { id: "scheme", label: copy.markScheme, icon: BookOpen, defaultFlex: 0.95, content: renderMarkSchemePanel },
              ] satisfies PanelConfig[]}
              storageKey={`submission-panels-${submissionId}`}
              gap={8}
              className="h-full"
            />
          </div>
        ) : (
          /* ── Mobile: swipe-tab layout ── */
          <div className="absolute inset-0 flex flex-col overflow-hidden">
            {/* Tab bar — plain buttons on mobile (DndKit blocks touch scrolling) */}
            <div className="flex border-b bg-background shrink-0">
              {tabOrder.map((tabId, i) => {
                const meta: Record<TabId, { label: string; Icon: typeof MessageSquare }> = {
                  feedback: { label: copy.feedback, Icon: MessageSquare },
                  markScheme: { label: copy.markScheme, Icon: BookOpen },
                  studentWork: { label: copy.studentWork, Icon: FileImage },
                };
                const { label, Icon } = meta[tabId];
                return (
                  <button
                    key={tabId}
                    type="button"
                    onClick={() => switchMobileTab(i)}
                    className={cn(
                      "flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium border-b-2 transition-colors touch-manipulation",
                      mobileTab === i ? "border-primary text-primary" : "border-transparent text-muted-foreground"
                    )}
                  >
                    <Icon className="h-[15px] w-[15px]" />
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Swipeable panels */}
            <div
              ref={mobileSwipeRef}
              onScroll={handleMobileSwipeScroll}
              className="flex flex-1 min-h-0 overflow-x-auto overflow-y-hidden snap-x snap-mandatory overscroll-contain"
              style={{ scrollbarWidth: "none", touchAction: "pan-x" } as React.CSSProperties}
            >
              {tabOrder.map((tabId) => {
                const panelContent: Record<TabId, { content: React.ReactNode; className: string }> = {
                  feedback: { content: renderFeedbackPanel, className: "p-3 space-y-4 pb-20" },
                  markScheme: { content: renderMarkSchemePanel, className: "p-3 pb-20" },
                  studentWork: { content: renderStudentWorkPanel, className: "p-3 space-y-3 pb-20" },
                };
                const { content, className } = panelContent[tabId];
                return (
                  <div key={tabId} className="flex-shrink-0 w-full h-full snap-center overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" } as React.CSSProperties}>
                    <div className={className}>{content}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <Dialog open={gradeDialogOpen} onOpenChange={setGradeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.gradeNow}</DialogTitle>
            <DialogDescription>
              {language === "uz"
                ? `${submission.student.name} ishini baholang.`
                : language === "ru"
                  ? `Оцените работу ${submission.student.name}.`
                  : `Grade ${submission.student.name}'s submission.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="manualScore">{copy.scoreWord} (0 - {displayMaxScore})</Label>
              <Input
                id="manualScore"
                type="number"
                min={0}
                max={displayMaxScore || 100}
                value={manualScore}
                onChange={(e) => setManualScore(e.target.value)}
                placeholder={language === "uz" ? "Ballni kiriting" : language === "ru" ? "Введите балл" : "Enter score"}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manualFeedback">{copy.feedback}</Label>
              <Textarea
                id="manualFeedback"
                value={manualFeedback}
                onChange={(e) => setManualFeedback(e.target.value)}
                placeholder={
                  language === "uz"
                    ? "O'quvchi uchun izoh kiriting..."
                    : language === "ru"
                      ? "Введите отзыв для ученика..."
                      : "Enter feedback for the student..."
                }
                rows={4}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={grading} onClick={() => setGradeDialogOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleManualGrade} disabled={grading || !manualScore.trim()}>
              {grading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {grading ? (language === "ru" ? "Сохранение..." : language === "uz" ? "Saqlanmoqda..." : "Saving...") : copy.gradeNow}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adjustDialogOpen} onOpenChange={setAdjustDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.adjustScore}</DialogTitle>
            <DialogDescription>
              {language === "uz"
                ? `${submission.student.name} uchun AI bahosini tahrirlang.`
                : language === "ru"
                  ? `Измените AI-оценку для ${submission.student.name}.`
                  : `Override the AI-generated score for ${submission.student.name}.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="score">{copy.scoreWord} (0 - {displayMaxScore})</Label>
              <Input
                id="score"
                type="number"
                min={0}
                max={displayMaxScore || 100}
                value={adjustedScore}
                onChange={(e) => setAdjustedScore(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reason">{language === "uz" ? "Sabab" : language === "ru" ? "Причина" : "Reason"} *</Label>
              <Textarea
                id="reason"
                value={adjustmentReason}
                onChange={(e) => setAdjustmentReason(e.target.value)}
                placeholder={
                  language === "uz"
                    ? "Nega bahoni o'zgartirayotganingizni yozing..."
                    : language === "ru"
                      ? "Объясните причину изменения..."
                      : "Explain why you are changing the score..."
                }
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={adjusting} onClick={() => setAdjustDialogOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleAdjustScore} disabled={adjusting || !adjustmentReason.trim()}>
              {adjusting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {adjusting ? (language === "ru" ? "Сохранение..." : language === "uz" ? "Saqlanmoqda..." : "Saving...") : (language === "ru" ? "Сохранить" : language === "uz" ? "Saqlash" : "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SubmissionSkeleton() {
  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col">
      <div className="flex items-center gap-4 px-4 py-3 border-b">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-6 w-44" />
      </div>
      <div className="flex-1 p-3 md:p-4">
        <div className="grid h-full gap-4 lg:grid-cols-[minmax(260px,0.95fr)_minmax(460px,1.6fr)_minmax(260px,0.95fr)]">
          <Skeleton className="h-full rounded-2xl" />
          <Skeleton className="h-full rounded-2xl" />
          <Skeleton className="h-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
