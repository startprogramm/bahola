"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useLanguage } from "@/lib/i18n/language-context";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClipboardCheck, Sparkles, Eye, Clock, Flag, X } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";

interface Submission {
  id: string;
  status: "PENDING" | "PROCESSING" | "GRADED";
  score?: number | null;
  maxScore?: number | null;
  gradingProgress?: number;
  createdAt: string;
  reportReason?: string | null;
  reportedAt?: string | null;
  student: {
    id: string;
    name: string;
  };
  assessment: {
    id: string;
    title: string;
    class: {
      id: string;
      name: string;
      headerColor: string;
    };
  };
}

interface ToReviewClientProps {
  initialSubmissions: Submission[];
  initialClasses: { id: string; name: string }[];
}

export default function ToReviewClient({ initialSubmissions, initialClasses }: ToReviewClientProps) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [submissions, setSubmissions] = useState<Submission[]>(initialSubmissions);
  const [loading, setLoading] = useState(false);
  const [selectedClassId, setSelectedClassId] = useState<string>(searchParams.get("classId") || "all");
  const [classes] = useState<{ id: string; name: string }[]>(initialClasses);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isGrading, setIsGrading] = useState(false);
  const [simulatedProgress, setSimulatedProgress] = useState<Record<string, number>>({});

  // Re-fetch submissions when class filter changes (after initial load)
  const [hasChangedFilter, setHasChangedFilter] = useState(false);
  useEffect(() => {
    if (hasChangedFilter) {
      fetchSubmissions();
    }
  }, [selectedClassId]);

  const handleClassFilterChange = (value: string) => {
    setSelectedClassId(value);
    setHasChangedFilter(true);
  };

  // Poll for updates every 10 seconds when there are processing submissions
  useEffect(() => {
    const hasProcessing = submissions.some((s) => s.status === "PROCESSING");
    if (!hasProcessing) {
      setSimulatedProgress({});
      return;
    }

    const interval = setInterval(() => {
      fetchSubmissions();
    }, 10000);

    return () => clearInterval(interval);
  }, [submissions, selectedClassId]);

  // Simulate progress movement between points
  useEffect(() => {
    const processingSubmissions = submissions.filter(s => s.status === "PROCESSING");

    if (processingSubmissions.length > 0) {
      const interval = setInterval(() => {
        setSimulatedProgress(prev => {
          const next = { ...prev };
          processingSubmissions.forEach(s => {
            const currentReal = s.gradingProgress || 0;
            const currentSim = next[s.id] || currentReal || 10;

            if (currentSim < currentReal) {
              next[s.id] = currentReal;
            } else if (currentSim < currentReal + 10 && currentSim < 99) {
              next[s.id] = parseFloat((currentSim + 0.2).toFixed(1));
            }
          });
          return next;
        });
      }, 200);

      return () => clearInterval(interval);
    }
  }, [submissions]);

  const fetchSubmissions = async () => {
    setLoading(true);
    try {
      const classParam = selectedClassId !== "all" ? `?classId=${selectedClassId}` : "";
      const res = await fetch(`/api/to-review${classParam}`);
      if (res.ok) {
        const data = await res.json();
        setSubmissions(data.submissions || []);
      }
    } catch (error) {
      console.error("Failed to fetch submissions:", error);
    } finally {
      setLoading(false);
    }
  };

  // Split submissions into grading queue and reported
  const gradingSubmissions = submissions.filter(
    (s) => (s.status === "PENDING" || s.status === "PROCESSING") && !s.reportedAt
  );
  const reportedSubmissions = submissions.filter((s) => s.reportedAt);
  const pendingSubmissions = gradingSubmissions.filter((s) => s.status === "PENDING");

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === pendingSubmissions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingSubmissions.map((s) => s.id)));
    }
  };

  const handleGradeSelected = async () => {
    if (selectedIds.size === 0) return;

    setIsGrading(true);
    try {
      const res = await fetch("/api/to-review/bulk-grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionIds: Array.from(selectedIds) }),
      });

      const data = await res.json();

      if (res.ok) {
        toast({
          title: t("bulkGradingStarted"),
          description: `${data.count} ${t("submissionsGraded")}`,
        });
        setSelectedIds(new Set());
        fetchSubmissions();
      } else {
        throw new Error(data.error || "Failed to start grading");
      }
    } catch (error) {
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsGrading(false);
    }
  };

  const handleGradeAll = async () => {
    if (pendingSubmissions.length === 0) return;

    setIsGrading(true);
    try {
      const res = await fetch("/api/to-review/bulk-grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionIds: pendingSubmissions.map((s) => s.id) }),
      });

      const data = await res.json();

      if (res.ok) {
        toast({
          title: t("bulkGradingStarted"),
          description: `${data.count} ${t("submissionsGraded")}`,
        });
        fetchSubmissions();
      } else {
        throw new Error(data.error || "Failed to start grading");
      }
    } catch (error) {
      toast({
        title: t("error"),
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsGrading(false);
    }
  };

  const handleDismissReport = async (submissionId: string) => {
    try {
      const res = await fetch(`/api/submissions/${submissionId}/report`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast({ title: t("reportDismissed"), description: t("reportDismissedDesc") });
        fetchSubmissions();
      } else {
        throw new Error("Failed to dismiss");
      }
    } catch {
      toast({ title: t("error"), variant: "destructive" });
    }
  };

  const formatTimeAgo = (date: string) => {
    const now = new Date();
    const then = new Date(date);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 60) {
      return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else {
      return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    }
  };
  const totalCount = gradingSubmissions.length + reportedSubmissions.length;

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <ClipboardCheck className="h-4 w-4 text-primary" />
          <span>{gradingSubmissions.length} {t("submissions")}</span>
          {reportedSubmissions.length > 0 && (
            <span className="text-amber-800 dark:text-amber-500 font-medium">· {reportedSubmissions.length} {t("reported").toLowerCase()}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Class Filter */}
          <Select value={selectedClassId} onValueChange={handleClassFilterChange}>
            <SelectTrigger className="w-[190px] h-9">
              <SelectValue placeholder={t("filterByClass")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allClasses")}</SelectItem>
              {classes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Grade All Button */}
          {pendingSubmissions.length > 0 && (
            <Button
              onClick={handleGradeAll}
              disabled={isGrading}
              variant="default"
              className="gap-2"
            >
              <Sparkles className="h-4 w-4" />
              {isGrading ? t("gradingSubmissions") : t("gradeAllWithAI")}
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="space-y-4">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : totalCount === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 flex items-center justify-center mx-auto mb-4">
              <ClipboardCheck className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">{t("allSubmissionsGraded")}</p>
          </div>
        ) : (
          <>
            {/* Grading Submissions List */}
            {gradingSubmissions.length > 0 && (
              <div className="space-y-2">
                {gradingSubmissions.map((submission) => {
                  const isProcessing = submission.status === "PROCESSING";
                  const isSelected = selectedIds.has(submission.id);

                  return (
                    <Card
                      key={submission.id}
                      className={cn(
                        "transition-all",
                        isProcessing && "opacity-60",
                        isSelected && "ring-2 ring-primary"
                      )}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center gap-4">
                          {/* Checkbox */}
                          {!isProcessing && (
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => handleToggleSelect(submission.id)}
                            />
                          )}

                          {/* Color Bar */}
                          <div
                            className="w-1 h-12 rounded-full shrink-0"
                            style={{ backgroundColor: submission.assessment.class.headerColor }}
                          />

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <h4 className="font-medium truncate">
                                  {submission.assessment.title} - {submission.student.name}
                                </h4>
                                <p className="text-sm text-muted-foreground truncate">
                                  {submission.assessment.class.name} • {formatTimeAgo(submission.createdAt)}
                                </p>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {/* Status Badge & Progress */}
                                {isProcessing ? (
                                  <div className="flex flex-col items-end gap-1 min-w-[100px]">
                                    <Badge
                                      variant="secondary"
                                      className="text-xs bg-blue-100 text-blue-700 border-blue-200 gap-1"
                                    >
                                      <Clock className="h-3 w-3 animate-spin" />
                                      {t("processing")}
                                    </Badge>
                                    <div className="w-full h-1 bg-secondary rounded-full overflow-hidden mt-1">
                                      <div
                                        className="h-full bg-primary transition-[width] duration-200 ease-linear"
                                        style={{ width: `${simulatedProgress[submission.id] || submission.gradingProgress || 10}%` }}
                                      />
                                    </div>
                                    <span className="text-[10px] text-muted-foreground">{Math.floor(simulatedProgress[submission.id] || submission.gradingProgress || 10)}%</span>
                                  </div>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className="text-xs bg-yellow-100 text-yellow-700 border-yellow-200"
                                  >
                                    {t("pending")}
                                  </Badge>
                                )}

                                {/* View Button */}
                                <Link
                                  href={`/assessments/${submission.assessment.id}/submissions/${submission.id}`}
                                >
                                  <Button variant="ghost" size="sm" className="gap-2">
                                    <Eye className="h-4 w-4" />
                                    {t("view")}
                                  </Button>
                                </Link>
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Reported Submissions Section */}
            {reportedSubmissions.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-500 flex items-center gap-2 px-1">
                  <Flag className="h-4 w-4" />
                  {t("reportedSubmissions")} ({reportedSubmissions.length})
                </h2>
                <div className="space-y-2">
                  {reportedSubmissions.map((submission) => (
                    <Card
                      key={submission.id}
                      className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/10"
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center gap-4">
                          {/* Amber Bar */}
                          <div className="w-1 h-12 rounded-full shrink-0 bg-amber-400" />

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <h4 className="font-medium truncate">
                                  {submission.assessment.title} - {submission.student.name}
                                </h4>
                                <p className="text-sm text-muted-foreground truncate">
                                  {submission.assessment.class.name}{submission.score != null && submission.maxScore != null ? ` • ${submission.score}/${submission.maxScore}` : ""}
                                </p>
                                {submission.reportReason && (
                                  <p className="text-xs text-amber-900 dark:text-amber-500 mt-1 italic line-clamp-2">
                                    &ldquo;{submission.reportReason}&rdquo;
                                  </p>
                                )}
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <Link href={`/assessments/${submission.assessment.id}/submissions/${submission.id}`}>
                                  <Button variant="ghost" size="sm" className="gap-2">
                                    <Eye className="h-4 w-4" />
                                    {t("view")}
                                  </Button>
                                </Link>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="gap-1 text-muted-foreground hover:text-foreground"
                                  onClick={() => handleDismissReport(submission.id)}
                                >
                                  <X className="h-4 w-4" />
                                  {t("dismissReport")}
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Grade Selected Button (Sticky Bottom) */}
            {selectedIds.size > 0 && (
              <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
                <Button
                  onClick={handleGradeSelected}
                  disabled={isGrading}
                  size="lg"
                  className="gap-2 shadow-lg"
                >
                  <Sparkles className="h-4 w-4" />
                  {isGrading
                    ? t("gradingSubmissions")
                    : `${t("gradeSelected")} (${selectedIds.size})`}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
