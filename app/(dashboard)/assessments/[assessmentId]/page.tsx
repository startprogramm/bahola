"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { cachedFetch, invalidateCache, invalidateCachePrefix, prefetch } from "@/lib/fetch-cache";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpDown,
  FileText,
  Upload,
  Clock,
  Trash2,
  RefreshCw,
  Pencil,
  Sparkles,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatDate, getScoreColor } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/language-context";

interface Assessment {
  id: string;
  title: string;
  description: string | null;
  totalMarks: number;
  dueDate: string | null;
  status: string;
  createdAt: string;
  showTextInput: boolean;
  showAIFeedback: boolean;
  studentsCanUpload: boolean;
  studentsSeeMarkScheme: boolean;
  studentsSeeQP: boolean;
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

/** Progress bar that persists its start time so it doesn't restart on re-visit */
function DraftProgressBar({ assessmentId }: { assessmentId: string }) {
  const key = `draft-progress-start-${assessmentId}`;
  const [pct, setPct] = useState(5);

  useEffect(() => {
    let startMs = Number(sessionStorage.getItem(key));
    if (!startMs) {
      startMs = Date.now();
      sessionStorage.setItem(key, String(startMs));
    }
    const DURATION = 30_000; // 30s to reach 85%
    const update = () => {
      const elapsed = Date.now() - startMs;
      // easeOut: fast start, slow finish — maps 0→1 via 1-(1-t)^2
      const t = Math.min(elapsed / DURATION, 1);
      const eased = 1 - (1 - t) * (1 - t);
      setPct(5 + eased * 80); // 5% → 85%
    };
    update();
    const id = setInterval(update, 200);
    return () => clearInterval(id);
  }, [key]);

  return (
    <div className="h-1 w-full bg-amber-200 dark:bg-amber-900/50 rounded-full overflow-hidden mt-2">
      <div
        className="h-full bg-amber-500 dark:bg-amber-400 rounded-full transition-[width] duration-200 ease-linear"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function AssessmentPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const { toast } = useToast();
  const { language, t } = useLanguage();
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [simulatedProgress, setSimulatedProgress] = useState<Record<string, number>>({});
  const [sortBy, setSortBy] = useState<"name" | "score" | "date">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [submissionSearch, setSubmissionSearch] = useState("");
  const [isPendingUpload, setIsPendingUpload] = useState(false);

  const assessmentId = params.assessmentId as string;

  const fetchAssessment = useCallback(async () => {
    try {
      const data = await cachedFetch(`/api/assessments/${assessmentId}`);
      if (!data) throw new Error("Assessment not found");
      setAssessment(data.assessment);
      // Clean up DRAFT progress timer once assessment is no longer DRAFT
      if (data.assessment.status !== "DRAFT") {
        sessionStorage.removeItem(`draft-progress-start-${assessmentId}`);
      }
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
    fetchAssessment();
  }, [fetchAssessment]);

  // Detect pending upload from sessionStorage (set by submit page)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const pendingKey = `submission-pending-${assessmentId}`;
    const pendingTs = sessionStorage.getItem(pendingKey);
    if (pendingTs && (Date.now() - Number(pendingTs)) < 60_000) {
      setIsPendingUpload(true);
    }
  }, [assessmentId]);

  // Mark this assessment as viewed (fire-and-forget)
  useEffect(() => {
    if (!assessment) return;
    fetch("/api/assessments/mark-viewed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assessmentIds: [assessmentId] }),
    }).catch(() => {});
  }, [assessment, assessmentId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const createdKey = `assessment-created-${assessmentId}`;
    if (sessionStorage.getItem(createdKey) === "1") {
      toast({
        title: language === "uz" ? "Topshiriq yaratildi" : language === "ru" ? "Задание создано" : "Assessment created",
        description: language === "uz"
          ? "Fayllar fonda qayta ishlanmoqda"
          : language === "ru"
            ? "Файлы обрабатываются в фоне"
            : "Files are being processed in the background",
      });
      sessionStorage.removeItem(createdKey);
    }
  }, [assessmentId, language, toast]);

  // Poll for updates if any submission is PROCESSING, assessment is DRAFT, or a submission was just sent
  useEffect(() => {
    const hasProcessing = assessment?.submissions.some(s => s.status === "PROCESSING");
    const isDraft = assessment?.status === "DRAFT";
    const pendingKey = `submission-pending-${assessmentId}`;
    const pendingTs = typeof window !== "undefined" ? sessionStorage.getItem(pendingKey) : null;
    const isPending = pendingTs && (Date.now() - Number(pendingTs)) < 60_000; // timeout after 60s

    if (hasProcessing || isDraft || isPending) {
      const interval = setInterval(() => {
        // Invalidate cache so polling actually fetches fresh data from server
        invalidateCache(`/api/assessments/${assessmentId}`);
        fetchAssessment();
      }, isPending && !hasProcessing ? 2000 : 3000); // Poll faster while waiting for submission to appear

      // Clear pending flag once a submission has appeared
      if (isPending && hasProcessing) {
        sessionStorage.removeItem(pendingKey);
        setIsPendingUpload(false);
      }

      return () => clearInterval(interval);
    }

    // Clear visual pending indicator if timeout expired or flag was removed
    if (!isPending && isPendingUpload) {
      setIsPendingUpload(false);
    }
  }, [assessment?.submissions, assessment?.status, fetchAssessment, assessmentId, isPendingUpload]);

  // Simulate progress movement between points
  useEffect(() => {
    const processingSubmissions = assessment?.submissions.filter(s => s.status === "PROCESSING") || [];
    
    if (processingSubmissions.length > 0) {
      // Sync simulated progress with real progress initially and on updates
      setSimulatedProgress(prev => {
        const next = { ...prev };
        processingSubmissions.forEach(s => {
          const currentReal = s.gradingProgress || 0;
          const currentSim = next[s.id] || 0;
          
          // If simulation hasn't started or is behind real progress significantly, jump to real
          if (!next[s.id] || currentSim < currentReal) {
            next[s.id] = currentReal;
          }
        });
        return next;
      });

      const interval = setInterval(() => {
        setSimulatedProgress(prev => {
          const next = { ...prev };
          processingSubmissions.forEach(s => {
            const currentReal = s.gradingProgress || 0;
            const currentSim = next[s.id] || currentReal;
            
            // Crawl slowly (0.1% every 200ms) but don't go more than 10% ahead of real progress
            // and never reach 100% until real progress is 100%
            if (currentSim < 99 && currentSim < currentReal + 10) {
              next[s.id] = parseFloat((currentSim + 0.1).toFixed(1));
            }
          });
          return next;
        });
      }, 200);
      
      return () => clearInterval(interval);
    } else {
      setSimulatedProgress({});
    }
  }, [assessment?.submissions]);

  const mySubmission = assessment?.submissions.find(
    (s) => s.student.id === session?.user?.id
  );

  // Prefetch submission detail pages so they load instantly when clicked
  useEffect(() => {
    if (!assessment?.submissions) return;
    for (const s of assessment.submissions) {
      if (s.status === "GRADED" || s.status === "ERROR") {
        prefetch(`/api/submissions/${s.id}`);
      }
    }
  }, [assessment?.submissions]);

  const handleDeleteAssessment = async () => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/assessments/${assessmentId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete assessment");
      }

      toast({
        title: "Success",
        description: "Assessment deleted successfully",
      });
      router.push(`/classes/${assessment?.class.id}`);
    } catch {
      toast({
        title: "Error",
        description: "Failed to delete assessment",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  if (loading) {
    return <AssessmentSkeleton />;
  }

  if (!assessment) {
    return null;
  }

  // Resolve viewer access from API metadata (fallback to local ownership)
  const isTeacher = assessment.viewerCanViewTeacherData ?? assessment.viewerCanManage ?? (assessment.class.teacher.id === session?.user?.id);
  const canManage = assessment.viewerCanManage ?? (assessment.class.teacher.id === session?.user?.id);

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
              {!isTeacher && ` • ${assessment.class.teacher.name}`}
            </p>
          </div>
        </div>

        {canManage && (
          <div className="flex flex-wrap gap-2 lg:justify-end lg:pt-1">
            {assessment.status !== "CLOSED" && (
              <Link href={`/assessments/${assessmentId}/submit`}>
                <Button size="sm">
                  <Upload className="h-4 w-4 mr-1.5" />
                  <span className="hidden sm:inline">{language === "uz" ? "O'quvchi ishini yuklash" : language === "ru" ? "Загрузить работу" : "Submit Student Work"}</span>
                  <span className="sm:hidden">{language === "uz" ? "Yuklash" : language === "ru" ? "Загр." : "Upload"}</span>
                </Button>
              </Link>
            )}

            <Link href={`/assessments/${assessmentId}/edit`}>
              <Button variant="outline" size="sm">
                <Pencil className="h-4 w-4 mr-1.5" />
                <span className="hidden sm:inline">{language === "uz" ? "Tahrirlash" : language === "ru" ? "Редактировать" : "Edit"}</span>
                <span className="sm:hidden">{language === "uz" ? "Tahrir" : language === "ru" ? "Ред." : "Edit"}</span>
              </Button>
            </Link>

            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  <span className="hidden sm:inline">{language === "uz" ? "O'chirish" : language === "ru" ? "Удалить" : "Delete"}</span>
                  <span className="sm:hidden">{language === "uz" ? "O'chirish" : language === "ru" ? "Удал." : "Delete"}</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {language === "uz" ? "Topshiriqni o'chirish" : language === "ru" ? "Удалить задание" : "Delete Assessment"}
                  </DialogTitle>
                  <DialogDescription>
                    {language === "uz"
                      ? `"${assessment.title}" ni o'chirishni xohlaysizmi? Bu ${assessment.submissions.length} ta yuborilgan ishni ham o'chiradi. Bu amalni qaytarib bo'lmaydi.`
                      : language === "ru"
                      ? `Вы уверены, что хотите удалить "${assessment.title}"? Это также удалит ${assessment.submissions.length} работ(ы). Это действие нельзя отменить.`
                      : `Are you sure you want to delete "${assessment.title}"? This will also delete all ${assessment.submissions.length} submission(s). This action cannot be undone.`}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setDeleteDialogOpen(false)}
                    disabled={deleting}
                  >
                    {t("cancel")}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleDeleteAssessment}
                    disabled={deleting}
                  >
                    {deleting
                      ? (language === "uz" ? "O'chirilmoqda..." : language === "ru" ? "Удаление..." : "Deleting...")
                      : (language === "uz" ? "O'chirish" : language === "ru" ? "Удалить" : "Delete")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      {/* DRAFT Assessment Banner */}
      {assessment.status === "DRAFT" && (
        <div className="flex items-center gap-3 p-4 rounded-lg border border-amber-500/30 bg-amber-500/10">
          <Clock className="h-5 w-5 text-amber-700 dark:text-amber-500 animate-spin shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-amber-800 dark:text-amber-500 text-sm">
              {language === "uz" ? "Topshiriq tayyorlanmoqda..." : language === "ru" ? "Задание подготавливается..." : "Assessment is being prepared..."}
            </p>
            <p className="text-xs text-amber-800/70 dark:text-amber-500/70 mt-0.5">
              {language === "uz"
                ? "Fayllar qayta ishlanmoqda. O'quvchilar ishlarini hoziroq yuborishi mumkin — ular navbatga qo'yiladi."
                : language === "ru"
                ? "Файлы обрабатываются. Ученики могут сдавать работы — они будут поставлены в очередь."
                : "Files are being processed. Students can submit work now — it will be queued and graded automatically."}
            </p>
            <DraftProgressBar assessmentId={assessmentId} />
          </div>
        </div>
      )}

      {/* Student View - Show their submission or submit option */}
      {!isTeacher && (
        <div className="bg-transparent mb-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold">
              {language === "uz" ? "Sizning ishingiz" : language === "ru" ? "Ваша работа" : "Your Submission"}
            </h2>
          </div>
          <div>
            {isPendingUpload && !mySubmission ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-lg border border-amber-500/30 bg-amber-500/10">
                  <div className="flex items-center gap-3">
                    <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400 animate-spin" />
                    <div>
                      <p className="font-medium text-amber-800 dark:text-amber-400">
                        {language === "uz" ? "Ishingiz yuklanmoqda..." : language === "ru" ? "Ваша работа загружается..." : "Your work is uploading..."}
                      </p>
                      <p className="text-xs text-amber-700/70 dark:text-amber-400/70 mt-0.5">
                        {language === "uz" ? "Iltimos, kuting. Ish fonda qayta ishlanmoqda." : language === "ru" ? "Пожалуйста, подождите. Работа обрабатывается в фоне." : "Please wait. Your work is being processed in the background."}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : mySubmission ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-lg border bg-accent/50">
                  <div>
                    <p className="font-medium">
                      {language === "uz" ? "Yuborilgan" : language === "ru" ? "Отправлено" : "Submitted"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(mySubmission.createdAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    {mySubmission.status === "GRADED" ? (
                      <div>
                        <span
                          className={`text-2xl font-bold ${getScoreColor(
                            mySubmission.score || 0,
                            (mySubmission.maxScore && mySubmission.maxScore > 0 ? mySubmission.maxScore : assessment.totalMarks > 0 ? assessment.totalMarks : null) || 100
                          )}`}
                        >
                          {mySubmission.score}/{(mySubmission.maxScore && mySubmission.maxScore > 0 ? mySubmission.maxScore : assessment.totalMarks > 0 ? assessment.totalMarks : null) || 100}
                        </span>
                        <p className="text-sm text-muted-foreground">
                          {Math.round(
                            ((mySubmission.score || 0) / ((mySubmission.maxScore && mySubmission.maxScore > 0 ? mySubmission.maxScore : assessment.totalMarks > 0 ? assessment.totalMarks : null) || 1)) * 100
                          )}
                          %
                        </p>
                      </div>
                    ) : mySubmission.status === "PROCESSING" ? (
                      <div className="flex flex-col items-end gap-1 min-w-[120px]">
                        <Badge variant="warning" className="flex items-center gap-1">
                          <Clock className="h-3 w-3 animate-spin" />
                          {assessment.status === "DRAFT" && (mySubmission.gradingProgress || 0) <= 5
                            ? (language === "uz" ? "Navbatda" : language === "ru" ? "В очереди" : "Queued")
                            : (mySubmission.gradingProgress || 0) < 25
                            ? (language === "uz" ? "Yuklanmoqda" : language === "ru" ? "Загрузка" : "Uploading")
                            : (language === "uz" ? "Tekshirilmoqda" : language === "ru" ? "Обработка" : "Processing")}
                        </Badge>
                        <div className="w-full h-1 bg-secondary rounded-full overflow-hidden mt-1">
                          <div
                            className="h-full bg-primary transition-[width] duration-200 ease-linear"
                            style={{ width: `${simulatedProgress[mySubmission.id] || mySubmission.gradingProgress || 0}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground">{Math.floor(simulatedProgress[mySubmission.id] || mySubmission.gradingProgress || 0)}%</span>
                      </div>
                    ) : mySubmission.status === "ERROR" ? (
                      <Badge variant="destructive">
                        {language === "uz" ? "Xatolik" : language === "ru" ? "Ошибка" : "Error"}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        {language === "uz" ? "Kutilmoqda" : language === "ru" ? "Ожидает" : "Pending"}
                      </Badge>
                    )}
                  </div>
                </div>

                {mySubmission.status === "GRADED" && (
                  <Link href={`/assessments/${assessmentId}/feedback`}>
                    <Button className="w-full">
                      {language === "uz" ? "Batafsil bahoni ko'rish" : language === "ru" ? "Посмотреть подробную оценку" : "View Detailed Feedback"}
                    </Button>
                  </Link>
                )}

              </div>
            ) : assessment.studentsCanUpload ? (
              <div className="text-center py-12 rounded-xl">
                <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-50" />
                <p className="text-muted-foreground mb-6">
                  {language === "uz"
                    ? "Hali ish yuklanmagan. Ishingizni hozir topshirishingiz mumkin."
                    : language === "ru"
                    ? "Работа еще не загружена. Вы можете сдать её сейчас."
                    : "No work uploaded yet. You can submit your work now."}
                </p>
                <Link href={`/assessments/${assessmentId}/submit`}>
                  <Button size="lg" className="px-8 shadow-md">
                    <Upload className="h-4 w-4 mr-2" />
                    {language === "uz" ? "Ishni topshirish" : language === "ru" ? "Сдать работу" : "Submit Work"}
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="text-center py-12 border rounded-xl bg-destructive/5 border-destructive/10">
                <Clock className="h-12 w-12 mx-auto text-destructive mb-4 opacity-50" />
                <p className="text-destructive font-medium">
                  {language === "uz"
                    ? "Ish topshirish yopilgan"
                    : language === "ru"
                    ? "Прием работ закрыт"
                    : "Submissions are closed"}
                </p>
                <p className="text-xs text-muted-foreground mt-1 px-4">
                  {language === "uz"
                    ? "O'qituvchi ushbu topshiriq uchun ishlarni qabul qilishni to'xtatgan."
                    : language === "ru"
                    ? "Учитель отключил возможность сдачи работ для этого задания."
                    : "The teacher has disabled submissions for this assessment."}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Teacher View — submissions + link to insights */}
      {isTeacher && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 border-b border-border pb-3">
            <div className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-primary border-b-2 border-primary -mb-[13px]">
              <FileText className="h-4 w-4" />
              {language === "uz" ? "Yuborilgan ishlar" : language === "ru" ? "Работы" : "Submissions"}
            </div>
            <Link
              href={`/assessments/${assessmentId}/insights`}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors -mb-[13px] border-b-2 border-transparent"
            >
              <Sparkles className="h-4 w-4" />
              {language === "uz" ? "Tahlil" : language === "ru" ? "Аналитика" : "Analytics"}
            </Link>
          </div>

          <div className="space-y-4">
            {isPendingUpload && (
              <div className="flex items-center gap-3 p-4 rounded-lg border border-amber-500/30 bg-amber-500/10">
                <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400 animate-spin shrink-0" />
                <div>
                  <p className="font-medium text-amber-800 dark:text-amber-400 text-sm">
                    {language === "uz" ? "Ish yuklanmoqda..." : language === "ru" ? "Работа загружается..." : "Work is uploading..."}
                  </p>
                  <p className="text-xs text-amber-700/70 dark:text-amber-400/70 mt-0.5">
                    {language === "uz" ? "Fonda qayta ishlanmoqda. Tez orada ko'rinadi." : language === "ru" ? "Обрабатывается в фоне. Скоро появится." : "Processing in background. It will appear shortly."}
                  </p>
                </div>
              </div>
            )}
            {assessment.submissions.length === 0 && !isPendingUpload ? (
              <div className="py-16 text-center">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">
                  {language === "uz" ? "Hali ishlar yuborilmagan" : language === "ru" ? "Пока нет работ" : "No submissions yet"}
                </h3>
                <p className="text-muted-foreground">
                  {language === "uz"
                    ? "O'quvchilar ishlari bu yerda ko'rsatiladi"
                    : language === "ru"
                    ? "Здесь появятся работы учеников"
                    : "Students will appear here once they submit their work"}
                </p>
              </div>
            ) : assessment.submissions.length === 0 ? null : (
              <div className="bg-transparent">
                <div className="mb-4 flex items-end justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold">
                      {language === "uz" ? "O'quvchilar ishlari" : language === "ru" ? "Работы учеников" : "Student Submissions"}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {language === "uz"
                        ? `${assessment.submissions.length} ta ish yuborilgan`
                        : language === "ru"
                        ? `Получено работ: ${assessment.submissions.length}`
                        : `${assessment.submissions.length} submission(s) received`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {(["name", "score", "date"] as const).map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          if (sortBy === key) {
                            setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                          } else {
                            setSortBy(key);
                            setSortDir(key === "score" ? "desc" : "asc");
                          }
                        }}
                        className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                          sortBy === key
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {key === "name"
                          ? (language === "uz" ? "Ism" : language === "ru" ? "Имя" : "Name")
                          : key === "score"
                          ? (language === "uz" ? "Ball" : language === "ru" ? "Балл" : "Score")
                          : (language === "uz" ? "Sana" : language === "ru" ? "Дата" : "Date")}
                        {sortBy === key && (
                          <ArrowUpDown className="h-3 w-3" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={language === "uz" ? "O'quvchi qidirish..." : language === "ru" ? "Поиск ученика..." : "Search students..."}
                    value={submissionSearch}
                    onChange={(e) => setSubmissionSearch(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
                <div className="divide-y">
                  {[...assessment.submissions]
                    .filter((s) => {
                      if (!submissionSearch.trim()) return true;
                      return s.student.name.toLowerCase().includes(submissionSearch.trim().toLowerCase());
                    })
                    .sort((a, b) => {
                      const dir = sortDir === "asc" ? 1 : -1;
                      if (sortBy === "name") {
                        return dir * a.student.name.localeCompare(b.student.name);
                      }
                      if (sortBy === "score") {
                        const maxA = (a.maxScore && a.maxScore > 0 ? a.maxScore : assessment.totalMarks > 0 ? assessment.totalMarks : null) || 1;
                        const maxB = (b.maxScore && b.maxScore > 0 ? b.maxScore : assessment.totalMarks > 0 ? assessment.totalMarks : null) || 1;
                        const pctA = a.status === "GRADED" ? (a.score || 0) / maxA : -1;
                        const pctB = b.status === "GRADED" ? (b.score || 0) / maxB : -1;
                        return dir * (pctA - pctB);
                      }
                      return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                    })
                    .map((submission) => (
                    <div
                      key={submission.id}
                      className="py-3 hover:bg-muted/50 px-2 -mx-2 rounded-lg transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Link
                          href={`/assessments/${assessmentId}/submissions/${submission.id}`}
                          className="no-underline text-foreground min-w-0 flex-1"
                        >
                          <p className="font-medium text-sm truncate">{submission.student.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatDate(submission.createdAt)}
                          </p>
                        </Link>

                        {(submission.status === "GRADED" || submission.status === "ERROR" || submission.status === "PROCESSING") && (
                          <Link
                            href={`/assessments/${assessmentId}/submit?resubmit=${submission.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="shrink-0"
                          >
                            <Button variant="outline" size="sm" className="gap-1 h-7 text-xs">
                              <RefreshCw className="h-3 w-3" />
                              <span className="hidden sm:inline">{language === "uz" ? "Qayta" : language === "ru" ? "Снова" : "Resubmit"}</span>
                            </Button>
                          </Link>
                        )}

                        <div className="shrink-0 text-right min-w-[80px]">
                          {submission.status === "GRADED" ? (
                            <Link
                              href={`/assessments/${assessmentId}/submissions/${submission.id}`}
                              className="no-underline"
                            >
                              <span
                                className={`text-base font-bold ${getScoreColor(
                                  submission.score || 0,
                                  (submission.maxScore && submission.maxScore > 0 ? submission.maxScore : assessment.totalMarks > 0 ? assessment.totalMarks : null) || 100
                                )}`}
                              >
                                {submission.score}/{(submission.maxScore && submission.maxScore > 0 ? submission.maxScore : assessment.totalMarks > 0 ? assessment.totalMarks : null) || 100}
                              </span>
                              <p className="text-xs text-muted-foreground">
                                {Math.round(
                                  ((submission.score || 0) / ((submission.maxScore && submission.maxScore > 0 ? submission.maxScore : assessment.totalMarks > 0 ? assessment.totalMarks : null) || 1)) * 100
                                )}%
                              </p>
                            </Link>
                          ) : submission.status === "PROCESSING" ? (
                            <div className="flex flex-col gap-1 min-w-[90px]">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground text-[10px]">
                                  {assessment.status === "DRAFT" && (submission.gradingProgress || 0) <= 5
                                    ? (language === "uz" ? "Navbatda" : language === "ru" ? "Очередь" : "Queued")
                                    : (submission.gradingProgress || 0) < 25
                                    ? (language === "uz" ? "Yuklash..." : language === "ru" ? "Загр..." : "Uploading")
                                    : (language === "uz" ? "Tekshir..." : language === "ru" ? "Обраб..." : "Processing")}
                                </span>
                                <span className="font-medium text-xs">{Math.floor(simulatedProgress[submission.id] || submission.gradingProgress || 0)}%</span>
                              </div>
                              <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary transition-[width] duration-200 ease-linear"
                                  style={{ width: `${simulatedProgress[submission.id] || submission.gradingProgress || 0}%` }}
                                />
                              </div>
                            </div>
                          ) : submission.status === "ERROR" ? (
                            <Badge variant="destructive" className="text-xs">
                              {language === "uz" ? "Xatolik" : language === "ru" ? "Ошибка" : "Error"}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">
                              {language === "uz" ? "Kutilmoqda" : language === "ru" ? "Ожидает" : "Pending"}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AssessmentSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Skeleton className="h-10 w-10 rounded" />
        <div>
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
