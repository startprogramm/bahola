"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Clock,
  FileText,
  ChevronRight,
  BookOpen,
  Loader2,
  MoreVertical,
  Flag,
  Trash2,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n/language-context";
import { formatDate, getScoreColor } from "@/lib/utils";
import { invalidateCache } from "@/lib/fetch-cache";
import type { ClassDetail, Assessment } from "./types";
import { extractMaxFromFeedback } from "./types";

interface ClassworkTabProps {
  classId: string;
  classData: ClassDetail;
  hasTeacherAccess: boolean;
  bannerColor: string;
  onClassDataChange: (updater: (prev: ClassDetail | null) => ClassDetail | null) => void;
  onReportSubmission: (submissionId: string) => void;
}

export function ClassworkTab({
  classId,
  classData,
  hasTeacherAccess,
  bannerColor,
  onClassDataChange,
  onReportSubmission,
}: ClassworkTabProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const [deletingAssessmentId, setDeletingAssessmentId] = useState<string | null>(null);
  const isDirectorViewer = classData.viewerRole === "DIRECTOR";
  const canManage = hasTeacherAccess && !isDirectorViewer;

  const getSubmissionStatus = (assessment: Assessment) => {
    if (!assessment.submissions || assessment.submissions.length === 0) {
      return { status: "NOT_SUBMITTED", label: language === "uz" ? "Topshirilmagan" : language === "ru" ? "Не сдано" : "Not submitted", variant: "outline" as const };
    }
    const submission = assessment.submissions[0];
    switch (submission.status) {
      case "GRADED":
        return { status: "GRADED", label: t("graded"), variant: "success" as const, submission };
      case "PROCESSING":
        return { status: "PROCESSING", label: t("processing"), variant: "warning" as const, submission };
      case "ERROR":
        return { status: "ERROR", label: t("error"), variant: "destructive" as const, submission };
      default:
        return { status: "PENDING", label: t("pending"), variant: "secondary" as const, submission };
    }
  };

  const deleteAssessment = async (assessmentId: string, assessmentTitle: string) => {
    const confirmMsg = language === "uz"
      ? `"${assessmentTitle}" topshirig'ini o'chirishni xohlaysizmi?`
      : language === "ru"
        ? `Удалить задание "${assessmentTitle}"?`
        : `Delete assessment "${assessmentTitle}"?`;
    if (!confirm(confirmMsg)) return;

    setDeletingAssessmentId(assessmentId);
    try {
      const res = await fetch(`/api/assessments/${assessmentId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete assessment");
      }
      onClassDataChange((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          assessments: prev.assessments.filter((a) => a.id !== assessmentId),
        };
      });
      invalidateCache(`/api/classes/${classId}`);
      invalidateCache(`/api/classes/${classId}/grades`);
      sessionStorage.removeItem(`class-detail-${classId}`);
      sessionStorage.removeItem("classes-cache");
      toast({
        title: language === "uz" ? "Topshiriq o'chirildi" : language === "ru" ? "Задание удалено" : "Assessment deleted",
      });
    } catch (error) {
      toast({
        title: language === "uz" ? "Xatolik" : language === "ru" ? "Ошибка" : "Error",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setDeletingAssessmentId(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Create button for teachers (not directors — read-only) */}
      {canManage && (
        <div className="flex justify-start mb-4">
          <Link href={`/classes/${classId}/assessments/new`} data-guide="create-assessment-btn">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              {language === "uz" ? "Topshiriq yaratish" : language === "ru" ? "Создать задание" : "Create Assignment"}
            </Button>
          </Link>
        </div>
      )}
      {classData.assessments.length === 0 ? (
        <div className="py-16 text-center">
          <BookOpen className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold mb-2">
            {language === "uz" ? "Hali topshiriqlar yo'q" : language === "ru" ? "Пока нет заданий" : "No assessments yet"}
          </h3>
          <p className="text-muted-foreground max-w-sm mx-auto">
            {canManage
              ? (language === "uz" ? "Birinchi topshiriqni yarating" : language === "ru" ? "Создайте первое задание" : "Create your first assessment to start grading student work.")
              : (language === "uz" ? "Bu sinfda hali topshiriqlar yo'q" : language === "ru" ? "В этом классе пока нет заданий" : "No assessments have been posted in this class yet.")}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {classData.assessments.map((assessment) => {
            const submissionInfo = getSubmissionStatus(assessment);
            const hasGradedSubmission = submissionInfo.status === "GRADED" && submissionInfo.submission;
            const hasSubmission = assessment.submissions && assessment.submissions.length > 0;

            return (
              <Link
                key={assessment.id}
                href={
                  hasTeacherAccess
                    ? `/assessments/${assessment.id}`
                    : hasGradedSubmission
                      ? `/assessments/${assessment.id}/feedback`
                      : `/assessments/${assessment.id}`
                }
                className="flex items-center gap-4 p-4 rounded-lg hover:bg-muted/50 transition-all group border border-border shadow-sm dark:shadow-none hover:shadow-md dark:hover:shadow-none hover:border-border/80 dark:hover:bg-muted mb-2"
              >
                {/* Icon */}
                <div
                  className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: bannerColor }}
                >
                  <FileText className="h-5 w-5 text-white" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium truncate group-hover:text-primary transition-colors flex items-center gap-2">
                    {assessment.title}
                    {assessment.isNew && (
                      <Badge variant="default" size="sm">{t("new")}</Badge>
                    )}
                  </h3>
                  <div className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                    <span>{formatDate(assessment.createdAt)}</span>
                    {assessment.dueDate && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {language === "uz" ? "Muddat" : language === "ru" ? "Срок" : "Due"}:{" "}
                        {new Date(assessment.dueDate).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    )}
                    {hasTeacherAccess && assessment._count.submissions === 0 && (
                      <span className="text-xs text-muted-foreground">{language === "uz" ? "Hali topshiriqlar yo'q" : language === "ru" ? "Нет работ" : "No submissions"}</span>
                    )}
                  </div>
                </div>

                {/* Status / Action */}
                <div className="flex items-center gap-2 shrink-0">
                  {hasTeacherAccess && assessment._count.submissions > 0 && (() => {
                    const graded = typeof assessment.gradedSubmissionsCount === "number"
                      ? assessment.gradedSubmissionsCount
                      : (assessment.submissions?.filter((s: any) => s.status === "GRADED").length || 0);
                    const total = assessment._count.submissions;
                    return (
                      <span className="text-xs font-medium text-muted-foreground">{graded}/{total}</span>
                    );
                  })()}
                  {canManage && (
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          disabled={deletingAssessmentId === assessment.id}
                        >
                          {deletingAssessmentId === assessment.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <MoreVertical className="h-4 w-4" />
                          )}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            router.push(`/assessments/${assessment.id}/edit`);
                          }}
                        >
                          <Pencil className="h-4 w-4 mr-2" />
                          {language === "uz" ? "Tahrirlash" : language === "ru" ? "Редактировать" : "Edit"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            deleteAssessment(assessment.id, assessment.title);
                          }}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          {language === "uz" ? "Topshiriqni o'chirish" : language === "ru" ? "Удалить задание" : "Delete Assessment"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  {!hasTeacherAccess && (
                    <>
                      {submissionInfo.status === "GRADED" && submissionInfo.submission && (() => {
                        const feedbackMax = extractMaxFromFeedback(submissionInfo.submission.feedback);
                        const effectiveMax = feedbackMax || submissionInfo.submission.maxScore || 100;
                        return <>
                          <span className={`font-semibold text-sm ${getScoreColor(submissionInfo.submission.score || 0, effectiveMax)}`}>
                            {submissionInfo.submission.score}/{effectiveMax}
                          </span>
                          {submissionInfo.submission.reportedAt ? (
                            <span className="ml-1 p-1 text-amber-600">
                              <Flag className="h-3.5 w-3.5" />
                            </span>
                          ) : (
                            <button
                              className="ml-1 p-1 rounded hover:bg-muted text-muted-foreground hover:text-amber-600 transition-colors opacity-0 group-hover:opacity-100"
                              title={t("reportFeedback")}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onReportSubmission(submissionInfo.submission!.id);
                              }}
                            >
                              <Flag className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </>;
                      })()}
                      {submissionInfo.status === "PROCESSING" && (
                        <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                      )}
                      {submissionInfo.status === "NOT_SUBMITTED" && !hasSubmission && (
                        <Badge variant="outline" className="text-xs">
                          {t("assigned") || "Assigned"}
                        </Badge>
                      )}
                    </>
                  )}
                  <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
