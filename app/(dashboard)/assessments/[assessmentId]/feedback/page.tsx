"use client";

import { useEffect, useState, useCallback, useMemo, useRef, type CSSProperties } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  FileImage,
  MessageSquare,
  BookOpen,
  AlertCircle,
  BookOpenCheck,
  RefreshCw,
  FileSpreadsheet,
  Download,
  Loader2,
  Flag,
  ImageOff,
  Lock,
  CheckCircle2,
  TriangleAlert,
  XCircle,
  CircleDashed,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { ResizablePanelLayout, type PanelConfig } from "@/components/resizable-panels";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn, normalizeImageUrl, getScoreColor, getScoreBgColor } from "@/lib/utils";
import { cachedFetch, invalidateCache } from "@/lib/fetch-cache";
import { useLanguage } from "@/lib/i18n/language-context";
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

const isAndroidWebView = (): boolean => {
  if (typeof window === "undefined") return false;
  const win = window as Window & { AndroidBridge?: unknown };
  const ua = window.navigator.userAgent || "";
  return Boolean(win.AndroidBridge) || /Android/i.test(ua);
};

interface SubmissionData {
  id: string;
  imageUrls: string;
  extractedText: string | null;
  score: number | null;
  maxScore: number | null;
  feedback: string | null;
  status: string;
  originalScore: number | null;
  adjustmentReason: string | null;
  adjustedAt: string | null;
  reportReason: string | null;
  reportedAt: string | null;
  assessment: {
    id: string;
    title: string;
    markScheme: string;
    markSchemePdfUrl: string | null;
    markSchemeFileUrls: string | null;
    questionPaperFileUrls: string | null;
    totalMarks: number;
    showAIFeedback: boolean;
    showTextInput: boolean;
    studentsSeeMarkScheme: boolean;
    studentsSeeQP: boolean;
    class: {
      id: string;
      name: string;
    };
  };
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

function getAccuracyTheme(accuracy: number) {
  if (accuracy >= 80) {
    return {
      pageTint:
        "bg-[radial-gradient(1200px_540px_at_58%_-210px,rgba(16,185,129,0.22),transparent_65%)] dark:bg-[radial-gradient(1200px_540px_at_58%_-210px,rgba(16,185,129,0.3),transparent_65%)]",
      panelBorder: "border-green-500 dark:border-green-700",
      accentText: "text-green-800 dark:text-green-500",
      accentBadge: "bg-green-200 text-green-900 border-green-500 dark:bg-green-900/60 dark:text-green-200 dark:border-green-700",
      progressBar: "from-green-600 to-green-500",
      overallCard: "bg-green-200/90 border-green-600 dark:bg-green-900/50 dark:border-green-600",
    };
  }

  if (accuracy >= 60) {
    return {
      pageTint:
        "bg-[radial-gradient(1200px_540px_at_58%_-210px,rgba(59,130,246,0.22),transparent_65%)] dark:bg-[radial-gradient(1200px_540px_at_58%_-210px,rgba(59,130,246,0.28),transparent_65%)]",
      panelBorder: "border-blue-500 dark:border-blue-700",
      accentText: "text-blue-800 dark:text-blue-500",
      accentBadge: "bg-blue-200 text-blue-900 border-blue-500 dark:bg-blue-900/60 dark:text-blue-200 dark:border-blue-700",
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
      accentBadge: "bg-amber-200 text-amber-900 border-amber-500 dark:bg-amber-900/60 dark:text-amber-200 dark:border-amber-700",
      progressBar: "from-amber-600 to-orange-500",
      overallCard: "bg-amber-200/90 border-amber-600 dark:bg-amber-900/50 dark:border-amber-600",
    };
  }

  return {
    pageTint:
      "bg-[radial-gradient(1200px_540px_at_58%_-210px,rgba(239,68,68,0.2),transparent_65%)] dark:bg-[radial-gradient(1200px_540px_at_58%_-210px,rgba(239,68,68,0.28),transparent_65%)]",
    panelBorder: "border-red-500 dark:border-red-700",
    accentText: "text-red-800 dark:text-red-500",
    accentBadge: "bg-red-200 text-red-900 border-red-500 dark:bg-red-900/60 dark:text-red-200 dark:border-red-700",
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
  const lowerUrl = url.toLowerCase();
  const isPdf = lowerUrl.endsWith(".pdf");
  const isDoc = lowerUrl.endsWith(".doc") || lowerUrl.endsWith(".docx");

  if (error) {
    return (
      <div className="w-full aspect-[3/4] bg-muted/50 flex flex-col items-center justify-center gap-2 text-muted-foreground">
        <ImageOff className="h-8 w-8 opacity-40" />
        <span className="text-xs">Failed to load page {index + 1}</span>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs h-7"
          onClick={() => {
            setError(false);
            setLoading(true);
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  // PDFs and Word docs: display via iframe (Word docs converted to PDF on-the-fly by uploads API)
  if (isPdf || isDoc) {
    const rawSrc = isDoc
      ? normalizeImageUrl(url.replace(/\.(docx?|DOCx?)$/i, ".pdf"))
      : normalizeImageUrl(url);
    // Append #view=FitH to auto-zoom PDF to fit container width
    const src = rawSrc + (rawSrc.includes("#") ? "" : "#view=FitH");
    return (
      <div className="relative bg-card overflow-x-auto">
        {loading && (
          <div className="absolute inset-0 bg-muted/30 flex items-center justify-center min-h-[200px] z-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        <iframe
          src={src}
          title={`Page ${index + 1}`}
          className="w-full"
          style={{ height: "85vh", minHeight: "600px", border: "none" }}
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

/* ─── Generic collapsible panel wrapper for mobile ─── */
function MobileCollapsiblePanel({
  label,
  icon: Icon,
  panelBorderClass,
  defaultExpanded = true,
  children,
}: {
  label: string;
  icon: React.ElementType;
  panelBorderClass: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={cn("rounded-2xl border bg-card/95 overflow-hidden", panelBorderClass)}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-background/80 text-left"
      >
        <Icon className="h-4 w-4 text-foreground/60" />
        <span className="text-xs font-semibold text-foreground/70 uppercase tracking-wider">
          {label}
        </span>
        <span className="ml-auto">
          {expanded ? <ChevronUp className="h-3.5 w-3.5 text-foreground/50" /> : <ChevronDown className="h-3.5 w-3.5 text-foreground/50" />}
        </span>
      </button>
      {expanded && (
        <div className="border-t">
          {children}
        </div>
      )}
    </div>
  );
}

/* ─── Mobile horizontal swipe carousel for images/PDFs ─── */
function MobileImageCarousel({
  urls,
  label,
  icon: Icon,
  pageLabel,
  pagesLabel,
  panelBorderClass,
  defaultExpanded = true,
}: {
  urls: string[];
  label: string;
  icon: React.ElementType;
  pageLabel: string;
  pagesLabel: string;
  panelBorderClass: string;
  defaultExpanded?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [expanded, setExpanded] = useState(defaultExpanded);

  const scrollToPage = useCallback((index: number) => {
    const container = scrollRef.current;
    if (!container) return;
    const child = container.children[index] as HTMLElement | undefined;
    if (child) {
      child.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, []);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

    scrollTimeoutRef.current = setTimeout(() => {
      // Determine which page is most visible
      const scrollLeft = container.scrollLeft;
      const containerWidth = container.clientWidth;
      const center = scrollLeft + containerWidth / 2;

      let closest = 0;
      let closestDist = Infinity;
      for (let i = 0; i < container.children.length; i++) {
        const child = container.children[i] as HTMLElement;
        const childCenter = child.offsetLeft + child.offsetWidth / 2;
        const dist = Math.abs(center - childCenter);
        if (dist < closestDist) {
          closestDist = dist;
          closest = i;
        }
      }
      setCurrentPage(closest);
    }, 100);
  }, []);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  if (urls.length === 0) return null;

  return (
    <div className={cn("rounded-2xl border bg-card/95 overflow-hidden", panelBorderClass)}>
      {/* Header - tappable to collapse/expand */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-background/80 text-left"
      >
        <Icon className="h-4 w-4 text-foreground/60" />
        <span className="text-xs font-semibold text-foreground/70 uppercase tracking-wider">
          {label}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-foreground/50">
          {urls.length} {pagesLabel}
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>

      {expanded && (
        <>
          {/* Carousel */}
          <div className="relative border-t">
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth hide-scrollbar"
            >
              {urls.map((url, index) => (
                <div
                  key={index}
                  className="flex-shrink-0 w-full snap-center"
                >
                  <SubmissionImage url={url} index={index} />
                </div>
              ))}
            </div>

          </div>

          {/* Page dots */}
          {urls.length > 1 && (
            <div className="flex items-center justify-center gap-1.5 py-2 bg-background/60">
              {urls.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => { setCurrentPage(index); scrollToPage(index); }}
                  className={cn(
                    "rounded-full transition-all duration-200",
                    index === currentPage
                      ? "w-6 h-2 bg-primary"
                      : "w-2 h-2 bg-foreground/20 hover:bg-foreground/30"
                  )}
                  aria-label={`${pageLabel} ${index + 1}`}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Mobile mark scheme panel (collapsible, vertical layout for proper PDF scrolling) ─── */
function MobileMarkSchemeCarousel({
  urls,
  label,
  panelBorderClass,
  fileLabel,
  filesLabel,
  language,
  t,
  defaultExpanded = true,
}: {
  urls: string[];
  label: string;
  panelBorderClass: string;
  fileLabel: string;
  filesLabel: string;
  language: string;
  t: (key: any) => string;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (urls.length === 0) return null;

  const sortedUrls = [...urls].sort((a, b) => {
    const aIsPdf = a.toLowerCase().endsWith(".pdf");
    const bIsPdf = b.toLowerCase().endsWith(".pdf");
    if (aIsPdf && !bIsPdf) return -1;
    if (!aIsPdf && bIsPdf) return 1;
    return 0;
  });

  return (
    <div className={cn("rounded-2xl border bg-card/95 overflow-hidden", panelBorderClass)}>
      {/* Header - tappable to collapse/expand */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-background/80 text-left"
      >
        <BookOpen className="h-4 w-4 text-foreground/60" />
        <span className="text-xs font-semibold text-foreground/70 uppercase tracking-wider">
          {label}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-foreground/50">
          {sortedUrls.length} {sortedUrls.length === 1 ? fileLabel : filesLabel}
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>

      {expanded && (
        <div className="border-t">
          {sortedUrls.map((url, index) => {
            const lowerUrl = url.toLowerCase();
            const isPdf = lowerUrl.endsWith(".pdf");
            const isDoc = lowerUrl.endsWith(".doc") || lowerUrl.endsWith(".docx");
            const isExcel = lowerUrl.endsWith(".xls") || lowerUrl.endsWith(".xlsx");
            const fileName = url.split("/").pop() || `File ${index + 1}`;

            return (
              <div key={index} className={index > 0 ? "border-t" : ""}>
                {isPdf ? (
                  <iframe
                    src={normalizeImageUrl(url)}
                    title={`${label} ${index + 1}`}
                    className="w-full"
                    style={{ border: "none", height: "85vh" }}
                  />
                ) : isDoc ? (
                  <iframe
                    src={normalizeImageUrl(url.replace(/\.(docx?|DOCx?)$/i, ".pdf"))}
                    title={`${label} ${index + 1}`}
                    className="w-full"
                    style={{ border: "none", height: "85vh" }}
                  />
                ) : isExcel ? (
                  <div className="p-8 flex flex-col items-center justify-center gap-3 min-h-[200px]">
                    <FileSpreadsheet className="h-10 w-10 text-foreground/40" />
                    <p className="text-sm font-medium truncate max-w-full">{fileName}</p>
                    <a href={normalizeImageUrl(url)} download className="inline-flex">
                      <Button variant="outline" size="sm" className="gap-2">
                        <Download className="h-4 w-4" />
                        {t("download")}
                      </Button>
                    </a>
                  </div>
                ) : (
                  <img
                    src={normalizeImageUrl(url)}
                    alt={`${label} ${index + 1}`}
                    className="w-full h-auto"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
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

export default function FeedbackPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { language, t } = useLanguage();

  const [submission, setSubmission] = useState<SubmissionData | null>(null);
  const [isTeacher, setIsTeacher] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reporting, setReporting] = useState(false);
  const [expandedQuestions, setExpandedQuestions] = useState<Record<string, boolean>>({});
  const [mobileTab, setMobileTab] = useState(0);
  const mobileSwipeRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef<{ startX: number; startY: number; startTime: number; decided: boolean; isSwipe: boolean }>({ startX: 0, startY: 0, startTime: 0, decided: false, isSwipe: false });
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

  const switchMobileTab = useCallback((index: number) => {
    setMobileTab(index);
  }, []);

  // Horizontal swipe to switch tabs — coexists with vertical scroll.
  // Scroll is priority (native). Swipe triggers on decisive horizontal gesture.
  useEffect(() => {
    const el = mobileSwipeRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      touchRef.current = { startX: t.clientX, startY: t.clientY, startTime: Date.now(), decided: false, isSwipe: false };
    };

    const onTouchMove = (e: TouchEvent) => {
      const tr = touchRef.current;
      if (tr.decided) return;
      const t = e.touches[0];
      const dx = Math.abs(t.clientX - tr.startX);
      const dy = Math.abs(t.clientY - tr.startY);
      // Wait until finger has moved enough to decide direction
      if (dx < 15 && dy < 15) return;
      // Horizontal swipe: dx must be clearly dominant (2:1 ratio)
      tr.decided = true;
      tr.isSwipe = dx > dy * 2 && dx > 20;
    };

    const finishGesture = (e: TouchEvent) => {
      const tr = touchRef.current;
      if (!tr.isSwipe) return;
      const t = e.changedTouches?.[0] || e.touches?.[0];
      if (!t) return;
      const dx = t.clientX - tr.startX;
      const elapsed = Date.now() - tr.startTime;
      // Need either: fast flick (>0.3px/ms) OR long swipe (>70px)
      const velocity = Math.abs(dx) / Math.max(elapsed, 1);
      if (Math.abs(dx) > 70 || (Math.abs(dx) > 40 && velocity > 0.3)) {
        if (dx < 0) {
          setMobileTab((prev) => Math.min(prev + 1, tabOrder.length - 1));
        } else {
          setMobileTab((prev) => Math.max(prev - 1, 0));
        }
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", finishGesture, { passive: true });
    el.addEventListener("touchcancel", finishGesture, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", finishGesture);
      el.removeEventListener("touchcancel", finishGesture);
    };
  }, [tabOrder.length]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024 || isAndroidWebView());
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const assessmentId = params.assessmentId as string;

  const fetchSubmission = useCallback(async () => {
    try {
      const data = await cachedFetch(`/api/assessments/${assessmentId}/my-submission`);
      if (!data) throw new Error("Submission not found");
      setSubmission(data.submission);
      setIsTeacher(data.isTeacher ?? false);
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
  }, [assessmentId, toast, router]);

  useEffect(() => {
    fetchSubmission();
  }, [fetchSubmission]);

  const handleReport = async () => {
    if (!submission || !reportReason.trim()) return;
    setReporting(true);
    try {
      const res = await fetch(`/api/submissions/${submission.id}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reportReason.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to report");
      }
      setSubmission({
        ...submission,
        reportReason: reportReason.trim(),
        reportedAt: new Date().toISOString(),
      });
      setReportDialogOpen(false);
      setReportReason("");
      toast({ title: t("reportSubmitted"), description: t("reportSubmittedDesc") });
    } catch (error) {
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : "Failed to report",
        variant: "destructive",
      });
    } finally {
      setReporting(false);
    }
  };

  const copy = useMemo(() => {
    if (language === "uz") {
      return {
        studentWork: "O'quvchi ishi",
        feedback: "Izoh",
        markScheme: "Javoblar",
        page: "Sahifa",
        pages: "sahifa",
        file: "fayl",
        files: "fayl",
        scoreResults: "Baholash Natijalari",
        scoreWord: "Ball",
        percentWord: "Foiz",
        overallFeedback: "Umumiy Fikr-mulohaza",
        questionAnalysis: "Savol bo'yicha Tahlil",
        hiddenAnswersTitle: "Kirish cheklangan",
        hiddenAnswersDescription: "O'qituvchi bu topshiriq uchun javoblarni yashirgan.",
        processingDesc: "Natijalar tayyor bo'lganda sahifani yangilang",
        feedbackHidden: "Bu topshiriqda AI fikr-mulohazasi talabalar uchun yopiq.",
        additionalNotes: "Qo'shimcha eslatmalar",
      };
    }

    if (language === "ru") {
      return {
        studentWork: "Работа ученика",
        feedback: "Отзыв",
        markScheme: "Ответы",
        page: "Стр.",
        pages: "стр.",
        file: "файл",
        files: "файлов",
        scoreResults: "Результаты Оценки",
        scoreWord: "Баллы",
        percentWord: "Процент",
        overallFeedback: "Общий Отзыв",
        questionAnalysis: "Разбор по Вопросам",
        hiddenAnswersTitle: "Доступ ограничен",
        hiddenAnswersDescription: "Учитель скрыл ответы для этого задания.",
        processingDesc: "Обновите страницу, когда результаты будут готовы",
        feedbackHidden: "AI-отзыв скрыт для учеников в этом задании.",
        additionalNotes: "Дополнительные заметки",
      };
    }

    return {
      studentWork: "Student Work",
      feedback: "Feedback",
      markScheme: "Answers",
      page: "Page",
      pages: "pages",
      file: "file",
      files: "files",
      scoreResults: "Grading Results",
      scoreWord: "Score",
      percentWord: "Percent",
      overallFeedback: "Overall Feedback",
      questionAnalysis: "Question-by-Question Breakdown",
      hiddenAnswersTitle: "Access restricted",
      hiddenAnswersDescription: "The teacher has hidden the answers for this assessment.",
      processingDesc: "Refresh the page when results are ready",
      feedbackHidden: "AI feedback is hidden for students in this assessment.",
      additionalNotes: "Additional notes",
    };
  }, [language]);

  const imageUrls = useMemo(() => {
    if (!submission?.imageUrls) return [] as string[];
    try {
      const parsed = JSON.parse(submission.imageUrls);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [submission?.imageUrls]);

  const markSchemeUrls = useMemo(() => {
    if (!submission) return [] as string[];

    if (submission.assessment.markSchemeFileUrls) {
      try {
        const parsed = JSON.parse(submission.assessment.markSchemeFileUrls);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        return [];
      }
    }

    return submission.assessment.markSchemePdfUrl ? [submission.assessment.markSchemePdfUrl] : [];
  }, [submission]);

  const parsedFeedback = useMemo(
    () => parseFeedbackMarkdown(submission?.feedback ?? null),
    [submission?.feedback]
  );

  // Sum maxPoints from per-question feedback breakdown (more accurate than AI's overall maxScore)
  const questionMaxTotal = parsedFeedback.questionBlocks.reduce(
    (sum, q) => sum + (q.maxPoints ?? 0), 0
  );

  // Prefer AI-detected maxScore from graded submission (reads mark scheme), then question
  // breakdown sum, then teacher-set totalMarks as fallback.
  const displayMaxScore =
    (submission?.maxScore && submission.maxScore > 0)
      ? submission.maxScore
      : questionMaxTotal > 0
        ? questionMaxTotal
        : (submission?.assessment.totalMarks && submission.assessment.totalMarks > 0)
          ? submission.assessment.totalMarks
          : 100;
  const hasScore =
    submission?.status === "GRADED" &&
    submission.score !== null;

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

  if (loading) {
    return <FeedbackSkeleton />;
  }

  if (!submission) {
    return null;
  }

  const canSeeMS = submission.assessment.studentsSeeMarkScheme;
  const showFeedback = Boolean(submission.feedback && submission.assessment.showAIFeedback);

  const toggleQuestion = (key: string) => {
    setExpandedQuestions((previous) => ({ ...previous, [key]: !previous[key] }));
  };

  const renderStudentWorkPanel = (
    <section
      className={cn(
        "rounded-2xl border bg-card/95 shadow-sm backdrop-blur-sm flex flex-col",
        isMobile ? "overflow-visible" : "h-full overflow-hidden min-h-0",
        accuracyTheme.panelBorder
      )}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-background/80">
        <FileImage className="h-4 w-4 text-foreground/60" />
        <span className="text-xs font-semibold text-foreground/70 uppercase tracking-wider">
          {copy.studentWork}
        </span>
        <span className="ml-auto text-xs text-foreground/50">
          {imageUrls.length} {copy.pages}
        </span>
      </div>
      <div className={cn("p-3", isMobile ? "" : "flex-1 overflow-auto min-h-0")}>
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
                {index === 0 && (
                  <span className="ml-auto inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                )}
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
        "rounded-2xl border bg-card/95 shadow-sm backdrop-blur-sm flex flex-col",
        isMobile ? "overflow-visible" : "h-full overflow-hidden min-h-0",
        accuracyTheme.panelBorder
      )}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-background/80">
        <MessageSquare className="h-4 w-4 text-foreground/60" />
        <span className="text-xs font-semibold text-foreground/70 uppercase tracking-wider">
          {copy.feedback}
        </span>
      </div>

      <div className={cn("p-4 md:p-5 space-y-4", isMobile ? "" : "flex-1 overflow-auto min-h-0")}>
        {hasScore && (
          <div
            data-guide="feedback-score"
            className={cn(
              "rounded-2xl border bg-background/80 p-5",
              accuracyTheme.panelBorder
            )}
          >
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
                className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-700", accuracyTheme.progressBar)}
                style={{ width: `${Math.max(0, Math.min(100, accuracy))}%` }}
              />
            </div>
          </div>
        )}

        {submission.status === "PROCESSING" && (
          <div className="p-8 text-center rounded-xl border bg-background/70">
            <div className="animate-spin h-6 w-6 border-2 border-primary/20 border-t-primary rounded-full mx-auto mb-3" />
            <p className="text-sm font-medium">{t("processing")}</p>
            <p className="text-xs text-muted-foreground mt-1">{copy.processingDesc}</p>
          </div>
        )}

        {showFeedback && parsedFeedback.overallMarkdown && (
          <div data-guide="feedback-overall" className={cn("rounded-xl border p-4", accuracyTheme.overallCard)}>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className={cn("h-4 w-4", accuracyTheme.accentText)} />
              <h3 className="text-sm font-semibold">{copy.overallFeedback}</h3>
            </div>
            <div className="markdown-content feedback-rich prose prose-sm dark:prose-invert max-w-none text-foreground leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{parsedFeedback.overallMarkdown}</ReactMarkdown>
            </div>
          </div>
        )}

        {submission.adjustmentReason && (
          <div className="p-4 border-2 rounded-xl bg-orange-50 dark:bg-orange-950/60 border-orange-400 dark:border-orange-600">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-orange-700 dark:text-orange-500 mt-0.5 shrink-0" />
              <div className="space-y-1.5 min-w-0">
                <p className="font-bold text-sm text-orange-900 dark:text-orange-100">{t("scoreAdjustedByTeacher")}</p>
                <p className="text-sm font-semibold text-orange-800 dark:text-orange-200">
                  {submission.originalScore}/{displayMaxScore} &rarr; {submission.score}/{displayMaxScore}
                </p>
                <p className="text-sm text-orange-900 dark:text-orange-100 leading-relaxed">{submission.adjustmentReason}</p>
              </div>
            </div>
          </div>
        )}

        {showFeedback && parsedFeedback.questionBlocks.length > 0 && (
          <div className="space-y-3" data-guide="feedback-questions">
            <h3 className="text-sm font-semibold text-foreground">{copy.questionAnalysis}</h3>

            {parsedFeedback.questionBlocks.map((question) => {
              const statusMeta = getQuestionStatusMeta(question.status);
              const StatusIcon = statusMeta.icon;
              const isOpen = Boolean(expandedQuestions[question.key]);

              const percentage =
                question.points !== null && question.maxPoints !== null && question.maxPoints > 0
                  ? Math.round((question.points / question.maxPoints) * 100)
                  : null;

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
                      {question.points !== null && question.maxPoints !== null && (
                        <span className={cn("text-sm font-semibold", statusMeta.scoreClass)}>
                          {question.points}/{question.maxPoints}
                          {percentage !== null ? ` · ${percentage}%` : ""}
                        </span>
                      )}
                      {isOpen ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </button>

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

        {showFeedback && parsedFeedback.additionalMarkdown && (
          <div className="rounded-xl border bg-background/70 p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">{copy.additionalNotes}</h3>
            <div className="markdown-content feedback-rich prose prose-sm dark:prose-invert max-w-none text-foreground leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{parsedFeedback.additionalMarkdown}</ReactMarkdown>
            </div>
          </div>
        )}

        {!showFeedback && submission.status === "GRADED" && (
          <div className="rounded-xl border bg-background/70 p-4 text-sm text-muted-foreground">
            {copy.feedbackHidden}
          </div>
        )}
      </div>
    </section>
  );

  const renderAnswersPanel = (
    <section
      className={cn(
        "rounded-2xl border bg-card/95 shadow-sm backdrop-blur-sm flex flex-col",
        isMobile ? "overflow-visible" : "h-full overflow-hidden min-h-0",
        accuracyTheme.panelBorder
      )}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-background/80">
        <BookOpen className="h-4 w-4 text-foreground/60" />
        <span className="text-xs font-semibold text-foreground/70 uppercase tracking-wider">
          {copy.markScheme}
        </span>
        {canSeeMS && (
          <span className="ml-auto text-xs text-foreground/50">
            {markSchemeUrls.length} {markSchemeUrls.length === 1 ? copy.file : copy.files}
          </span>
        )}
      </div>

      {canSeeMS ? (
        <div className={isMobile ? "" : "flex-1 overflow-hidden min-h-0"}>
          <MarkSchemeContent urls={markSchemeUrls} language={language} t={t} isMobile={isMobile} />
        </div>
      ) : (
        <div className="flex-1 p-6 flex items-center justify-center min-h-0">
          <div className="w-full rounded-2xl border border-dashed bg-background/70 p-8 text-center">
            <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-muted/60 flex items-center justify-center">
              <Lock className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="font-semibold text-base">{copy.hiddenAnswersTitle}</p>
            <p className="text-sm text-muted-foreground mt-2">{copy.hiddenAnswersDescription}</p>
          </div>
        </div>
      )}
    </section>
  );

  const desktopPanels: PanelConfig[] = [
    {
      id: "student-work",
      label: copy.studentWork,
      icon: FileImage,
      defaultFlex: 1,
      minWidth: 200,
      content: renderStudentWorkPanel,
    },
    {
      id: "feedback",
      label: copy.feedback,
      icon: MessageSquare,
      defaultFlex: 1,
      minWidth: 300,
      content: renderFeedbackPanel,
    },
    {
      id: "answers",
      label: copy.markScheme,
      icon: BookOpen,
      defaultFlex: 1,
      minWidth: 200,
      content: renderAnswersPanel,
    },
  ];

  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col">
      <div className="border-b bg-background/95 backdrop-blur-sm px-3 py-2.5 flex items-center gap-2">
        <Link href={submission.assessment.class?.id ? `/classes/${submission.assessment.class.id}?tab=classwork` : `/assessments/${assessmentId}`}>
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <Link href="/classes">
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Home">
            <BookOpenCheck className="h-4 w-4" />
          </Button>
        </Link>

        {hasScore && <ScoreBadge score={submission.score!} maxScore={displayMaxScore} />}

        {submission.originalScore !== null && submission.originalScore !== submission.score && (
          <Badge variant="outline" className="h-7 text-xs">
            AI: {submission.originalScore}/{displayMaxScore}
          </Badge>
        )}

        <div className="flex items-center gap-1 ml-1">
          {isTeacher && (
            <Link href={`/assessments/${assessmentId}/submit?resubmit=${submission?.id}`}>
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

          {submission.status === "GRADED" &&
            (submission.reportedAt ? (
              <Badge variant="outline" className="text-xs bg-amber-200 text-amber-900 border-amber-500 h-7">
                <Flag className="h-3 w-3 mr-1" />
                {t("reported")}
              </Badge>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title={t("reportFeedback")}
                onClick={() => setReportDialogOpen(true)}
              >
                <Flag className="h-4 w-4" />
              </Button>
            ))}
        </div>

        <span className="ml-auto text-xs text-muted-foreground truncate max-w-[260px] hidden sm:block">
          {submission.assessment.title}
        </span>
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div className={cn("absolute inset-0 pointer-events-none", accuracyTheme.pageTint)} />

        {!isMobile ? (
          <div className="relative h-full min-h-0 p-3 md:p-4">
            <ResizablePanelLayout
              panels={desktopPanels}
              storageKey={`feedback-panels-v2-${assessmentId}`}
              gap={8}
              className="h-full"
            />
          </div>
        ) : (
          /* ── Mobile: swipe-tab layout ── */
          <div className="absolute inset-0 flex flex-col overflow-hidden">
            {/* Action bar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b bg-background/95 backdrop-blur-sm shrink-0">
              {isTeacher && (
                <Link href={`/assessments/${assessmentId}/submit?resubmit=${submission?.id}`} className="flex-1 min-w-0">
                  <Button variant="outline" size="sm" className="w-full gap-1.5 h-8 text-xs">
                    <RefreshCw className="h-3 w-3" />
                    {language === "uz" ? "Qayta topshirish" : language === "ru" ? "Отправить снова" : "Resubmit"}
                  </Button>
                </Link>
              )}
              {submission.status === "GRADED" && !submission.reportedAt && (
                <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs shrink-0" onClick={() => setReportDialogOpen(true)}>
                  <Flag className="h-3 w-3" />
                  {t("reportFeedback")}
                </Button>
              )}
              {submission.status === "GRADED" && submission.reportedAt && (
                <Badge variant="outline" className="text-xs bg-amber-200 text-amber-900 border-amber-500 h-7 px-2 shrink-0">
                  <Flag className="h-3 w-3 mr-1" />
                  {t("reported")}
                </Badge>
              )}
            </div>

            {/* Score strip (always visible above tabs) */}
            {hasScore && (
              <div className={cn("px-4 py-2 border-b shrink-0 flex items-center gap-3", "bg-card/80")}>
                <div className="flex items-end gap-1">
                  <span className={cn("text-2xl font-bold leading-none", accuracyTheme.accentText)}>{submission.score}</span>
                  <span className="text-sm font-semibold text-foreground/50 pb-0.5">/{displayMaxScore}</span>
                </div>
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className={cn("h-full rounded-full bg-gradient-to-r transition-all", accuracyTheme.progressBar)} style={{ width: `${Math.min(100, accuracy)}%` }} />
                </div>
                <Badge variant="outline" className={cn("text-xs px-2 py-0.5 border shrink-0", accuracyTheme.accentBadge)}>{accuracy}%</Badge>
                {submission.originalScore !== null && submission.originalScore !== submission.score && (
                  <span className="text-[10px] text-foreground/40 shrink-0">AI:{submission.originalScore}</span>
                )}
              </div>
            )}

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

            {/* Tab panels — only active panel shown, swipe to switch */}
            <div
              ref={mobileSwipeRef}
              className="flex-1 min-h-0 overflow-y-auto"
              style={{ touchAction: "manipulation", WebkitOverflowScrolling: "touch", overscrollBehaviorY: "contain" }}
            >
              {tabOrder[mobileTab] === "feedback" && (
                  <div className="px-4 py-3 space-y-3 pb-8">
                      {submission.status === "PROCESSING" && (
                        <div className="p-6 text-center rounded-xl border bg-card/95">
                          <div className="animate-spin h-6 w-6 border-2 border-primary/20 border-t-primary rounded-full mx-auto mb-3" />
                          <p className="text-sm font-medium">{t("processing")}</p>
                          <p className="text-xs text-muted-foreground mt-1">{copy.processingDesc}</p>
                        </div>
                      )}
                      {submission.adjustmentReason && (
                        <div className="p-3 border-2 rounded-xl bg-orange-50 dark:bg-orange-950/60 border-orange-400 dark:border-orange-600">
                          <div className="flex items-start gap-2.5">
                            <AlertCircle className="h-4 w-4 text-orange-700 dark:text-orange-500 mt-0.5 shrink-0" />
                            <div className="space-y-1 min-w-0">
                              <p className="font-bold text-xs text-orange-900 dark:text-orange-100">{t("scoreAdjustedByTeacher")}</p>
                              <p className="text-xs font-semibold text-orange-800 dark:text-orange-200">
                                {submission.originalScore}/{displayMaxScore} &rarr; {submission.score}/{displayMaxScore}
                              </p>
                              <p className="text-xs text-orange-900 dark:text-orange-100 leading-relaxed">{submission.adjustmentReason}</p>
                            </div>
                          </div>
                        </div>
                      )}
                      {showFeedback && parsedFeedback.overallMarkdown && (
                        <div className={cn("rounded-xl border p-3", accuracyTheme.overallCard)}>
                          <div className="flex items-center gap-2 mb-2">
                            <Sparkles className={cn("h-4 w-4", accuracyTheme.accentText)} />
                            <h3 className="text-sm font-semibold">{copy.overallFeedback}</h3>
                          </div>
                          <div className="markdown-content feedback-rich prose prose-sm dark:prose-invert max-w-none text-foreground leading-relaxed">
                            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{parsedFeedback.overallMarkdown}</ReactMarkdown>
                          </div>
                        </div>
                      )}
                      {showFeedback && parsedFeedback.questionBlocks.length > 0 && (
                        <div className="space-y-2">
                          <h3 className="text-sm font-semibold text-foreground px-1">{copy.questionAnalysis}</h3>
                          {parsedFeedback.questionBlocks.map((question) => {
                            const statusMeta = getQuestionStatusMeta(question.status);
                            const StatusIcon = statusMeta.icon;
                            const isOpen = Boolean(expandedQuestions[question.key]);
                            const pct = question.points !== null && question.maxPoints !== null && question.maxPoints > 0
                              ? Math.round((question.points / question.maxPoints) * 100) : null;
                            return (
                              <div key={question.key} className={cn("rounded-xl border bg-background/70 overflow-hidden", statusMeta.borderClass)}>
                                <button type="button" onClick={() => toggleQuestion(question.key)} className="w-full px-3 py-2.5 flex items-center gap-2.5 text-left">
                                  <StatusIcon className={cn("h-4 w-4 shrink-0", statusMeta.iconClass)} />
                                  <span className="text-sm font-semibold truncate">{question.title}</span>
                                  <div className="ml-auto flex items-center gap-1.5 shrink-0">
                                    {question.points !== null && question.maxPoints !== null && (
                                      <span className={cn("text-xs font-semibold", statusMeta.scoreClass)}>
                                        {question.points}/{question.maxPoints}{pct !== null ? ` · ${pct}%` : ""}
                                      </span>
                                    )}
                                    {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                                  </div>
                                </button>
                                {isOpen && (
                                  <div className="border-t px-3 pb-3 pt-2">
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
                      {showFeedback && parsedFeedback.additionalMarkdown && (
                        <div className="rounded-xl border bg-background/70 p-3">
                          <h3 className="text-sm font-semibold text-foreground mb-2">{copy.additionalNotes}</h3>
                          <div className="markdown-content feedback-rich prose prose-sm dark:prose-invert max-w-none text-foreground leading-relaxed">
                            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{parsedFeedback.additionalMarkdown}</ReactMarkdown>
                          </div>
                        </div>
                      )}
                      {!showFeedback && submission.status === "GRADED" && (
                        <div className="rounded-xl border bg-background/70 p-3 text-sm text-muted-foreground">
                          {copy.feedbackHidden}
                        </div>
                      )}
                    </div>
              )}

              {tabOrder[mobileTab] === "markScheme" && (
                    canSeeMS ? (
                      markSchemeUrls.length > 0 ? (
                        <div>
                          {[...markSchemeUrls].sort((a, b) => {
                            const aP = a.toLowerCase().endsWith(".pdf");
                            const bP = b.toLowerCase().endsWith(".pdf");
                            return aP && !bP ? -1 : !aP && bP ? 1 : 0;
                          }).map((url, idx) => {
                            const lo = url.toLowerCase();
                            const isPdf = lo.endsWith(".pdf");
                            const isDoc = lo.endsWith(".doc") || lo.endsWith(".docx");
                            const isExcel = lo.endsWith(".xls") || lo.endsWith(".xlsx");
                            const fileName = url.split("/").pop() || `File ${idx + 1}`;
                            return (
                              <div key={idx} className={idx > 0 ? "border-t" : ""}>
                                {isPdf ? (
                                  <iframe src={normalizeImageUrl(url)} title={`${copy.markScheme} ${idx + 1}`} className="w-full" style={{ border: "none", height: "85vh" }} />
                                ) : isDoc ? (
                                  <iframe src={normalizeImageUrl(url.replace(/\.(docx?|DOCx?)$/i, ".pdf"))} title={`${copy.markScheme} ${idx + 1}`} className="w-full" style={{ border: "none", height: "85vh" }} />
                                ) : isExcel ? (
                                  <div className="p-8 flex flex-col items-center justify-center gap-3 min-h-[200px]">
                                    <FileSpreadsheet className="h-10 w-10 text-foreground/40" />
                                    <p className="text-sm font-medium truncate max-w-full">{fileName}</p>
                                    <a href={normalizeImageUrl(url)} download className="inline-flex">
                                      <Button variant="outline" size="sm" className="gap-2"><Download className="h-4 w-4" />{t("download")}</Button>
                                    </a>
                                  </div>
                                ) : (
                                  <img src={normalizeImageUrl(url)} alt={`${copy.markScheme} ${idx + 1}`} className="w-full h-auto" width={800} height={1100} />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="p-8 text-center text-muted-foreground">
                          <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-30" />
                          <p className="text-sm">{language === "uz" ? "Javoblar mavjud emas" : language === "ru" ? "Ответы недоступны" : "No answers available"}</p>
                        </div>
                      )
                    ) : (
                      <div className="p-10 text-center">
                        <Lock className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                        <p className="font-semibold text-sm">{copy.hiddenAnswersTitle}</p>
                        <p className="text-xs text-muted-foreground mt-2">{copy.hiddenAnswersDescription}</p>
                      </div>
                    )
              )}

              {tabOrder[mobileTab] === "studentWork" && (
                    <div className="py-3 space-y-3 pb-8 px-4">
                      {imageUrls.length > 0 ? imageUrls.map((url, idx) => (
                        <div key={idx} className="rounded-xl overflow-hidden border bg-card shadow-sm">
                          <div className="px-3 py-1.5 text-xs text-foreground/60 border-b bg-muted/40">{copy.page} {idx + 1}</div>
                          <SubmissionImage url={url} index={idx} />
                        </div>
                      )) : (
                        <div className="p-8 text-center text-muted-foreground">
                          <p className="text-sm">{language === "uz" ? "Yuklangan sahifalar topilmadi" : language === "ru" ? "Загруженные страницы не найдены" : "No uploaded pages found"}</p>
                        </div>
                      )}
                    </div>
              )}
            </div>
          </div>
        )}
      </div>

      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("reportFeedback")}</DialogTitle>
            <DialogDescription>{t("reportFeedbackDesc")}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            placeholder={t("reportReasonPlaceholder")}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportDialogOpen(false)} disabled={reporting}>
              {t("cancel")}
            </Button>
            <Button onClick={handleReport} disabled={reporting || !reportReason.trim()}>
              {reporting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {t("submitReport")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SafeDocumentFrame({ src, title, className }: { src: string; title: string; className?: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setLoadError(false);
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleLoad = () => {
      try {
        // Check if the iframe loaded a valid document
        const contentType = iframe.contentDocument?.contentType;
        if (contentType && contentType.includes("application/json")) {
          setLoadError(true);
        }
      } catch {
        // Cross-origin - can't check, assume OK or blocked
      }
    };

    const handleError = () => setLoadError(true);

    iframe.addEventListener("load", handleLoad);
    iframe.addEventListener("error", handleError);
    return () => {
      iframe.removeEventListener("load", handleLoad);
      iframe.removeEventListener("error", handleError);
    };
  }, [src]);

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <Lock className="h-10 w-10 text-foreground/30" />
        <p className="text-sm font-medium text-foreground/70">
          Ko&apos;rish cheklangan
        </p>
        <p className="text-xs text-foreground/50 max-w-[200px]">
          Bu faylni ko&apos;rish uchun ruxsat yo&apos;q yoki fayl mavjud emas.
        </p>
        <a href={src} target="_blank" rel="noopener noreferrer" className="inline-flex">
          <Button variant="outline" size="sm" className="gap-2">
            <ExternalLink className="h-4 w-4" />
            Faylni ochish
          </Button>
        </a>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      src={src}
      className={className}
      title={title}
    />
  );
}

function MarkSchemeContent({
  urls,
  language,
  t,
  isMobile = false,
}: {
  urls: string[];
  language: string;
  t: (key: any) => string;
  isMobile?: boolean;
}) {
  if (urls.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-foreground/50">
        <div className="text-center p-6">
          <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">
            {language === "uz"
              ? "Baholash sxemasi mavjud emas"
              : language === "ru"
              ? "Схема оценивания недоступна"
              : "No mark scheme available"}
          </p>
        </div>
      </div>
    );
  }

  const sortedUrls = [...urls].sort((a, b) => {
    const aIsPdf = a.toLowerCase().endsWith(".pdf");
    const bIsPdf = b.toLowerCase().endsWith(".pdf");
    if (aIsPdf && !bIsPdf) return -1;
    if (!aIsPdf && bIsPdf) return 1;
    return 0;
  });

  // Single embeddable file: fill 100% height on desktop, fixed height on mobile
  // Multiple files: scrollable list
  const isSingleEmbeddable =
    sortedUrls.length === 1 &&
    (() => {
      const l = sortedUrls[0].toLowerCase();
      return l.endsWith(".pdf") || l.endsWith(".doc") || l.endsWith(".docx") || !(l.endsWith(".xls") || l.endsWith(".xlsx"));
    })();

  // On mobile, iframes need a fixed height since flex/h-full won't work in natural flow
  const getIframeHeight = (single: boolean): string => {
    if (isMobile) return "h-[85vh]";
    return single ? "h-full" : "h-[600px]";
  };

  return (
    <div className={cn(
      isMobile ? "" : "h-full",
      !isMobile && isSingleEmbeddable ? "flex flex-col" : "",
      !isMobile && !isSingleEmbeddable ? "overflow-auto" : "",
    )}>
      {sortedUrls.map((url: string, index: number) => {
        const lowerUrl = url.toLowerCase();
        const isPdf = lowerUrl.endsWith(".pdf");
        const isDoc = lowerUrl.endsWith(".doc") || lowerUrl.endsWith(".docx");
        const isExcel = lowerUrl.endsWith(".xls") || lowerUrl.endsWith(".xlsx");
        const fileName = url.split("/").pop() || `File ${index + 1}`;

        return (
          <div
            key={index}
            className={cn(
              "border-b last:border-b-0",
              !isMobile && isSingleEmbeddable ? "flex-1 min-h-0" : ""
            )}
          >
            {sortedUrls.length > 1 && (
              <div className="px-3 py-1.5 text-xs text-foreground/60 border-b bg-muted/40">
                {t("page")} {index + 1}
              </div>
            )}

            {isPdf ? (
              <SafeDocumentFrame
                src={normalizeImageUrl(url)}
                className={cn("w-full", getIframeHeight(isSingleEmbeddable))}
                title={`Mark Scheme ${index + 1}`}
              />
            ) : isDoc ? (
              <SafeDocumentFrame
                src={normalizeImageUrl(url.replace(/\.(docx?|DOCx?)$/, ".pdf"))}
                className={cn("w-full", getIframeHeight(isSingleEmbeddable))}
                title={`Mark Scheme ${index + 1}`}
              />
            ) : isExcel ? (
              <div className="p-6 flex flex-col items-center justify-center gap-3">
                <FileSpreadsheet className="h-10 w-10 text-foreground/40" />
                <p className="text-sm font-medium truncate max-w-full">{fileName}</p>
                <a href={normalizeImageUrl(url)} download className="inline-flex">
                  <Button variant="outline" size="sm" className="gap-2">
                    <Download className="h-4 w-4" />
                    {t("download")}
                  </Button>
                </a>
              </div>
            ) : (
              <img
                src={normalizeImageUrl(url)}
                alt={`Mark Scheme ${index + 1}`}
                className="w-full h-auto"
                width={800}
                height={1100}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function FeedbackSkeleton() {
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
