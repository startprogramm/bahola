"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useRef } from "react";
import { useSubscriptionData } from "@/hooks/use-subscription";
import { cachedFetch, invalidateCache, prefetch } from "@/lib/fetch-cache";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  Copy,
  Plus,
  CheckCircle2,
  AlertCircle,
  FileText,
  ChevronRight,
  Eye,
  Loader2,
  Link2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n/language-context";
import { cn, getScoreColor } from "@/lib/utils";
import dynamic from "next/dynamic";

// Lazy-load tab components and dialogs
const StreamTab = dynamic(() => import("@/components/class-tabs/stream-tab").then(m => ({ default: m.StreamTab })));
const ClassworkTab = dynamic(() => import("@/components/class-tabs/classwork-tab").then(m => ({ default: m.ClassworkTab })));
const PeopleTab = dynamic(() => import("@/components/class-tabs/people-tab").then(m => ({ default: m.PeopleTab })));
const GradesTab = dynamic(() => import("@/components/class-tabs/grades-tab").then(m => ({ default: m.GradesTab })));
const EditClassDialog = dynamic(() => import("@/components/class-tabs/edit-class-dialog").then(m => ({ default: m.EditClassDialog })), { ssr: false });

const isMaktab = process.env.NEXT_PUBLIC_APP_MODE === "maktab";

const BANNER_COLORS = [
  "#1967d2",
  "#137333",
  "#a142f4",
  "#e37400",
  "#1a73e8",
  "#c5221f",
];

interface Submission {
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

interface Assessment {
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

interface ClassDetail {
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

/** Extract correct maxScore from feedback's per-question breakdown. */
function extractMaxFromFeedback(feedback: string | null | undefined): number | null {
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

export interface ClassDetailPageProps {
  initialData: ClassDetail | null;
  classId: string;
}

export default function ClassDetailClient({ initialData, classId: serverClassId }: ClassDetailPageProps) {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const [classData, setClassData] = useState<ClassDetail | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [selectedAssessment, setSelectedAssessment] = useState<Assessment | null>(null);
  const [batchGrading, setBatchGrading] = useState(false);
  const [activeTab, setActiveTab] = useState(() => {
    const tab = searchParams.get("tab");
    return tab === "stream" || tab === "people" || tab === "grades" ? tab : "classwork";
  });
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [classCodePopupOpen, setClassCodePopupOpen] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportingSubmissionId, setReportingSubmissionId] = useState<string | null>(null);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const tabsListRef = useRef<HTMLDivElement | null>(null);
  const tabTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({
    classwork: null,
    stream: null,
    people: null,
    grades: null,
  });
  const [tabIndicator, setTabIndicator] = useState({
    left: 0,
    width: 0,
    ready: false,
  });
  const { data: subData } = useSubscriptionData();

  const classId = (params.classId as string) || serverClassId;

  const userPlan = subData?.subscription ?? null;
  const isFreePlan = userPlan === "FREE";

  const fetchClassDetails = useCallback(async () => {
    try {
      const data = await cachedFetch(`/api/classes/${classId}`);
      if (!data) throw new Error("Class not found");
      setClassData(data.class);
    } catch {
      toast({
        title: language === "uz" ? "Xatolik" : language === "ru" ? "Ошибка" : "Error",
        description: language === "uz" ? "Sinf ma'lumotlarini yuklab bo'lmadi" : language === "ru" ? "Не удалось загрузить данные класса" : "Failed to load class details",
        variant: "destructive",
      });
      router.push("/classes");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  useEffect(() => {
    if (!initialData) {
      fetchClassDetails();
    }
  }, [fetchClassDetails, initialData]);

  useEffect(() => {
    cachedFetch(`/api/classes/${classId}/stream`).catch(() => {});
  }, [classId]);

  useEffect(() => {
    if (classData?.viewerCanViewTeacherData) {
      cachedFetch(`/api/classes/${classId}/grades`).catch(() => {});
    }
  }, [classId, classData?.viewerCanViewTeacherData]);

  useEffect(() => {
    if (!classData?.assessments) return;
    for (const a of classData.assessments) {
      prefetch(`/api/assessments/${a.id}`);
    }
  }, [classData?.assessments]);

  const markedViewRef = useRef(false);
  useEffect(() => {
    if (!classData || markedViewRef.current) return;
    const newIds = classData.assessments
      .filter((a) => a.isNew)
      .map((a) => a.id);
    if (newIds.length === 0) return;
    markedViewRef.current = true;

    fetch("/api/assessments/mark-viewed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assessmentIds: newIds }),
    })
      .then(() => invalidateCache(`/api/classes/${classId}`))
      .catch(() => {});
  }, [classData, classId]);

  const updateTabIndicator = useCallback(() => {
    const container = tabsListRef.current;
    const activeTrigger = tabTriggerRefs.current[activeTab];
    if (!container || !activeTrigger) return;

    const containerRect = container.getBoundingClientRect();
    const triggerRect = activeTrigger.getBoundingClientRect();

    setTabIndicator({
      left: triggerRect.left - containerRect.left,
      width: triggerRect.width,
      ready: true,
    });
  }, [activeTab]);

  useLayoutEffect(() => {
    updateTabIndicator();
    const raf = requestAnimationFrame(() => updateTabIndicator());
    return () => cancelAnimationFrame(raf);
  }, [updateTabIndicator]);

  useEffect(() => {
    if (!loading) {
      const raf = requestAnimationFrame(() => updateTabIndicator());
      return () => cancelAnimationFrame(raf);
    }
  }, [loading, updateTabIndicator]);

  useEffect(() => {
    window.addEventListener("resize", updateTabIndicator);
    return () => window.removeEventListener("resize", updateTabIndicator);
  }, [updateTabIndicator]);

  useEffect(() => {
    if (searchParams.get("edit") === "true" && classData) {
      setEditDialogOpen(true);
      router.replace(`/classes/${classId}`, { scroll: false });
    }
  }, [searchParams, classData, classId, router]);

  // --- Mobile swipe-to-switch-tabs ---
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeHandled = useRef(false);
  const hasTeacherAccessRef = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    swipeHandled.current = false;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current || swipeHandled.current) return;
      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaY = touch.clientY - touchStartRef.current.y;
      touchStartRef.current = null;

      // Ignore if vertical scroll is dominant
      if (Math.abs(deltaY) > Math.abs(deltaX)) return;
      // Minimum horizontal swipe distance
      if (Math.abs(deltaX) < 50) return;

      swipeHandled.current = true;

      setActiveTab((prev) => {
        const tabs = hasTeacherAccessRef.current
          ? ["classwork", "stream", "people", "grades"]
          : ["classwork", "stream", "people"];
        const currentIndex = tabs.indexOf(prev);
        if (currentIndex === -1) return prev;

        let nextIndex: number;
        if (deltaX < 0) {
          // Swipe left → next tab
          nextIndex = Math.min(currentIndex + 1, tabs.length - 1);
        } else {
          // Swipe right → previous tab
          nextIndex = Math.max(currentIndex - 1, 0);
        }

        if (nextIndex === currentIndex) return prev;

        const nextTab = tabs[nextIndex];
        // Update URL to match
        const url = new URL(window.location.href);
        if (nextTab === "classwork") {
          url.searchParams.delete("tab");
        } else {
          url.searchParams.set("tab", nextTab);
        }
        window.history.replaceState(null, "", url.toString());

        return nextTab;
      });
    },
    []
  );

  const copyClassCode = () => {
    if (classData?.code) {
      navigator.clipboard.writeText(classData.code);
      toast({
        title: language === "uz" ? "Nusxalandi!" : language === "ru" ? "Скопировано!" : "Copied!",
        description: language === "uz" ? "Sinf kodi nusxalandi" : language === "ru" ? "Код класса скопирован" : "Class code copied to clipboard",
      });
    }
  };

  if (loading) return <ClassDetailSkeleton />;
  if (!classData) return null;

  const isDirectorViewer = classData.viewerRole === "DIRECTOR";
  const isTeacher = classData.teacher.id === session?.user?.id || isDirectorViewer;
  const isCoTeacher =
    !isTeacher &&
    (classData.viewerRole === "CO_TEACHER" ||
      classData.enrollments.some(
        (e) => e.student.id === session?.user?.id && e.role === "TEACHER"
      ));
  const hasTeacherAccess =
    classData.viewerCanViewTeacherData ?? (isTeacher || isCoTeacher);
  hasTeacherAccessRef.current = hasTeacherAccess;
  const canManageGrades =
    isDirectorViewer ? false : (classData.viewerCanManage ?? (isTeacher || isCoTeacher));
  const canManageClass =
    classData.viewerCanManage ??
    (classData.viewerRole ? classData.viewerRole !== "STUDENT" : (isTeacher || isCoTeacher));

  const bannerColor = classData.headerColor || BANNER_COLORS[0];

  return (
    <div className="min-h-screen">
      <Tabs value={activeTab} onValueChange={(tab) => {
        setActiveTab(tab);
        const url = new URL(window.location.href);
        if (tab === "classwork") {
          url.searchParams.delete("tab");
        } else {
          url.searchParams.set("tab", tab);
        }
        window.history.replaceState(null, "", url.toString());
      }}>
        <div className="-mx-4 sm:-mx-4 md:-mx-6 -mt-3 sm:-mt-4 md:-mt-6 sticky top-16 z-30 bg-background">
          <TabsList
            ref={tabsListRef}
            className="relative h-auto p-0 pl-3 sm:pl-4 md:pl-6 bg-background border-0 gap-0 w-full justify-start rounded-none overflow-visible border-b border-border"
          >
            <div
              className="pointer-events-none absolute -bottom-px z-30 h-[3px] rounded-full bg-primary transition-all duration-300 ease-out"
              style={{
                left: `${tabIndicator.left}px`,
                width: `${tabIndicator.width}px`,
                opacity: tabIndicator.ready ? 1 : 0,
              }}
            />
            {(hasTeacherAccess ? ["classwork", "stream", "people", "grades"] as const : ["classwork", "stream", "people"] as const).map((tab) => (
              <TabsTrigger
                key={tab}
                ref={(el) => {
                  tabTriggerRefs.current[tab] = el;
                }}
                data-guide={`class-${tab}-tab`}
                value={tab}
                className={cn(
                  "relative z-20 bg-transparent shadow-none rounded-none px-5 py-3.5 text-base transition-colors duration-200 hover:bg-muted/60",
                  activeTab === tab
                    ? "text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground font-normal"
                )}
              >
                {t(tab)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div
          className="py-6"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <TabsContent value="stream" className="mt-0 data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-bottom-1 data-[state=active]:duration-300">
            <StreamTab
              classId={classId}
              classData={classData as any}
              hasTeacherAccess={hasTeacherAccess}
              canManageClass={canManageClass}
              onEditDialogOpen={() => setEditDialogOpen(true)}
              onCopyClassCode={copyClassCode}
              onClassCodePopupOpen={() => setClassCodePopupOpen(true)}
            />
          </TabsContent>

          <TabsContent value="classwork" className="mt-0 data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-bottom-1 data-[state=active]:duration-300">
            <ClassworkTab
              classId={classId}
              classData={classData as any}
              hasTeacherAccess={hasTeacherAccess}
              bannerColor={bannerColor}
              onClassDataChange={(updater) => setClassData(updater as any)}
              onReportSubmission={(submissionId) => {
                setReportingSubmissionId(submissionId);
                setReportReason("");
                setReportDialogOpen(true);
              }}
            />
          </TabsContent>

          <TabsContent value="people" className="mt-0 data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-bottom-1 data-[state=active]:duration-300">
            <PeopleTab
              classId={classId}
              classData={classData as any}
              hasTeacherAccess={hasTeacherAccess}
              isTeacher={isTeacher}
              bannerColor={bannerColor}
              onClassDataChange={(updater) => setClassData(updater as any)}
            />
          </TabsContent>

          {hasTeacherAccess && (
            <TabsContent value="grades" className="mt-0 data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-bottom-1 data-[state=active]:duration-300">
              <GradesTab
                classId={classId}
                classData={classData as any}
                canManageGrades={canManageGrades}
                isFreePlan={isFreePlan}
              />
            </TabsContent>
          )}
        </div>
      </Tabs>

      {/* Assessment Submissions Dialog */}
      <Dialog open={!!selectedAssessment} onOpenChange={() => setSelectedAssessment(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {selectedAssessment?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto -mx-6 px-6">
            {selectedAssessment && (
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm text-muted-foreground">
                    {selectedAssessment._count.submissions} / {classData.enrollments.filter((e) => e.role !== "TEACHER").length} {language === "uz" ? "topshirildi" : language === "ru" ? "сдали" : "submitted"}
                  </span>
                  <div className="flex gap-2">
                    <Link href={`/assessments/${selectedAssessment.id}`}>
                      <Button variant="outline" size="sm">
                        <Eye className="h-3.5 w-3.5 mr-1.5" />
                        {t("view")}
                      </Button>
                    </Link>
                    <Link href={`/assessments/${selectedAssessment.id}/submit`}>
                      <Button size="sm">
                        <Plus className="h-3.5 w-3.5 mr-1.5" />
                        {language === "uz" ? "Ish topshirish" : language === "ru" ? "Сдать работу" : "Submit Work"}
                      </Button>
                    </Link>
                  </div>
                </div>
                {selectedAssessment.submissions.some((s) => s.status === "PENDING" || s.status === "ERROR") && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2"
                    disabled={batchGrading}
                    onClick={async () => {
                      if (!selectedAssessment) return;
                      setBatchGrading(true);
                      try {
                        const res = await fetch(`/api/assessments/${selectedAssessment.id}/batch-grade`, { method: "POST" });
                        const data = await res.json();
                        if (!res.ok) {
                          toast({ title: data.error || "Failed", variant: "destructive" });
                          return;
                        }
                        toast({ title: data.message });
                        setTimeout(() => {
                          invalidateCache(`/api/classes/${classId}`);
                          fetchClassDetails();
                        }, 2000);
                      } catch {
                        toast({ title: "Failed to start batch grading", variant: "destructive" });
                      } finally {
                        setBatchGrading(false);
                      }
                    }}
                  >
                    {batchGrading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {language === "uz" ? "Barchasini AI baholash" : language === "ru" ? "Оценить все через AI" : "AI Grade All"}
                    {" "}({selectedAssessment.submissions.filter((s) => s.status === "PENDING" || s.status === "ERROR").length})
                  </Button>
                )}
                {selectedAssessment.submissions.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground">
                    <FileText className="h-10 w-10 mx-auto mb-3 opacity-50" />
                    <p>{t("noSubmissions")}</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {selectedAssessment.submissions.map((submission) => (
                      <Link
                        key={submission.id}
                        href={`/assessments/${selectedAssessment.id}/submissions/${submission.id}`}
                        className="flex items-center justify-between py-3 hover:bg-muted/50 -mx-2 px-2 rounded-lg transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="text-sm font-medium text-primary">
                              {submission.student?.name?.charAt(0) || "?"}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium">{submission.student?.name}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {submission.status === "GRADED" && (() => {
                            const fMax = extractMaxFromFeedback(submission.feedback);
                            const eMax = fMax || submission.maxScore || 100;
                            return (
                              <span className={`font-semibold ${getScoreColor(submission.score || 0, eMax)}`}>
                                {submission.score}/{eMax}
                              </span>
                            );
                          })()}
                          <Badge
                            variant={
                              submission.status === "GRADED"
                                ? "success"
                                : submission.status === "PROCESSING"
                                  ? "warning"
                                  : submission.status === "ERROR"
                                    ? "destructive"
                                    : "secondary"
                            }
                          >
                            {submission.status === "GRADED" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                            {submission.status === "PROCESSING" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                            {submission.status === "ERROR" && <AlertCircle className="h-3 w-3 mr-1" />}
                            {submission.status === "GRADED" ? t("graded") : submission.status === "PROCESSING" ? t("processing") : submission.status === "ERROR" ? t("error") : t("pending")}
                          </Badge>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Class Dialog (lazy-loaded) */}
      {editDialogOpen && (
        <EditClassDialog
          classId={classId}
          classData={classData as any}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          onClassDataChange={(updater) => setClassData(updater as any)}
        />
      )}

      {/* Class Code Fullscreen Popup */}
      {!isMaktab && <Dialog open={classCodePopupOpen} onOpenChange={setClassCodePopupOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              {language === "uz" ? "Sinf kodi" : language === "ru" ? "Код класса" : "Class code"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center py-8 gap-6">
            <div
              className="text-[96px] font-black tracking-widest leading-none select-all cursor-pointer text-foreground"
              onClick={() => {
                navigator.clipboard.writeText(classData?.code || "");
                toast({ title: language === "uz" ? "Nusxalandi!" : language === "ru" ? "Скопировано!" : "Copied!" });
              }}
            >
              {classData?.code}
            </div>
            <p className="text-sm text-muted-foreground">
              {language === "uz" ? "Kodga bosing — nusxalanadi" : language === "ru" ? "Нажмите на код — скопируется" : "Click the code to copy it"}
            </p>
          </div>
          <div className="flex items-center justify-between pt-2 border-t">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{classData?.name}</span>
              {classData?.subject && <span>{classData.subject}</span>}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => {
                  const inviteLink = `${window.location.origin}/join/${classData?.code}`;
                  navigator.clipboard.writeText(inviteLink);
                  toast({ title: language === "uz" ? "Havola nusxalandi!" : language === "ru" ? "Ссылка скопирована!" : "Invite link copied!" });
                }}
              >
                <Link2 className="h-4 w-4" />
                {language === "uz" ? "Taklif havolasi" : language === "ru" ? "Ссылка" : "Copy invite link"}
              </Button>
              <Button
                size="sm"
                className="gap-2"
                onClick={() => {
                  navigator.clipboard.writeText(classData?.code || "");
                  toast({ title: language === "uz" ? "Nusxalandi!" : language === "ru" ? "Скопировано!" : "Copied!" });
                }}
              >
                <Copy className="h-4 w-4" />
                {language === "uz" ? "Nusxalash" : language === "ru" ? "Скопировать" : "Copy code"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>}

      {/* Report Dialog */}
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("reportFeedback")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("reportFeedbackDesc")}</p>
          <Textarea
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            placeholder={t("reportReasonPlaceholder")}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportDialogOpen(false)} disabled={reportSubmitting}>
              {t("cancel")}
            </Button>
            <Button
              disabled={reportSubmitting || !reportReason.trim()}
              onClick={async () => {
                if (!reportingSubmissionId || !reportReason.trim()) return;
                setReportSubmitting(true);
                try {
                  const res = await fetch(`/api/submissions/${reportingSubmissionId}/report`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ reason: reportReason.trim() }),
                  });
                  if (res.ok) {
                    toast({ title: t("reportSubmitted"), description: t("reportSubmittedDesc") });
                    setReportDialogOpen(false);
                    fetchClassDetails();
                  } else {
                    const data = await res.json();
                    throw new Error(data.error || "Failed");
                  }
                } catch (error) {
                  toast({ title: t("error"), description: error instanceof Error ? error.message : "Failed to report", variant: "destructive" });
                } finally {
                  setReportSubmitting(false);
                }
              }}
            >
              {reportSubmitting ? t("submitting") : t("submitReport")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ClassDetailSkeleton() {
  return (
    <div className="min-h-screen">
      <div className="border-b">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <div className="flex items-start gap-4">
            <Skeleton className="h-10 w-10 rounded" />
            <div>
              <Skeleton className="h-8 w-64 mb-2" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
        </div>
      </div>
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
