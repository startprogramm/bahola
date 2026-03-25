"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { invalidateCache } from "@/lib/fetch-cache";
import { useDropzone } from "react-dropzone";
import {
  ArrowLeft,
  Upload,
  X,
  Loader2,
  User,
  RefreshCw,
  RotateCw,
  ScanText,
  Camera,
  Check,
  FileText,
  Plus,
  UserPlus,
  Maximize2,
  Search,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

import { rotateImage, generatePreviewUrl, isImageFile } from "@/lib/utils/image-utils";
import { normalizeImageUrl } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/language-context";
import { SortableGrid } from "@/components/ui/sortable-grid";

interface Student {
  id: string;
  name: string;
  email: string;
}

interface Assessment {
  id: string;
  title: string;
  studentsCanUpload: boolean;
  showAIFeedback: boolean;
  viewerRole?: string;
  class: {
    id: string;
    teacher: {
      id: string;
    };
    enrollments: {
      student: Student;
    }[];
  };
  submissions: {
    studentId: string;
  }[];
}

interface PageItem {
  id: string;
  type: "new" | "reuse";
  file?: File;
  preview: string;
  reuseUrl?: string; // Original /uploads/ URL for sending back to server
  rotation: number;
}

export default function SubmitAssessmentPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { toast } = useToast();
  const { language, t } = useLanguage();
  // Upload is fire-and-forget - redirects immediately
  const [pages, setPages] = useState<PageItem[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [fileLimit, setFileLimit] = useState<number>(5 * 1024 * 1024); // Default 5MB
  const [subscriptionTier, setSubscriptionTier] = useState<string>("FREE");

  // Camera state
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [capturedCount, setCapturedCount] = useState(0);
  const [cameraFlash, setCameraFlash] = useState(false);

  const feedbackLanguage = language === "uz" ? "uzbek" : language === "ru" ? "russian" : "english";

  const assessmentId = params.assessmentId as string;
  const resubmitId = searchParams.get("resubmit");
  const isResubmit = !!resubmitId;

  const fetchAssessment = useCallback(async () => {
    try {
      const response = await fetch(`/api/assessments/${assessmentId}`);
      if (!response.ok) throw new Error("Failed to fetch assessment");
      const data = await response.json();
      setAssessment(data.assessment);
    } catch {
      toast({
        title: "Error",
        description: "Failed to load assessment details",
        variant: "destructive",
      });
      router.push("/classes");
    } finally {
      setLoading(false);
    }
  }, [assessmentId, toast, router]);

  const fetchExistingSubmission = useCallback(async (submissionId: string) => {
    try {
      const response = await fetch(`/api/submissions/${submissionId}`);
      if (!response.ok) throw new Error("Failed to fetch submission");
      const data = await response.json();
      const submission = data.submission;

      setSelectedStudentId(submission.student.id);

      const imageUrls = JSON.parse(submission.imageUrls) as string[];
      setPages(
        imageUrls.map((url, index) => ({
          id: `reuse-${index}-${Date.now()}`,
          type: "reuse",
          preview: normalizeImageUrl(url),
          reuseUrl: url,
          rotation: 0,
        }))
      );

      toast({
        title: "Resubmitting",
        description: `Loaded previous submission. You can add more images or remove existing ones.`,
      });
    } catch {
      toast({
        title: "Error",
        description: "Failed to load existing submission",
        variant: "destructive",
      });
    }
  }, [toast]);

  useEffect(() => {
    fetchAssessment();
    if (resubmitId) {
      fetchExistingSubmission(resubmitId);
    }
    
    // Fetch user file limit
    fetch("/api/user/profile")
      .then(res => res.json())
      .then(data => {
        if (data.user?.fileLimit) {
          setFileLimit(data.user.fileLimit);
        }
        if (data.user?.subscription) {
          setSubscriptionTier(data.user.subscription);
        }
      })
      .catch(() => console.error("Failed to fetch file limit"));
  }, [fetchAssessment, fetchExistingSubmission, resubmitId]);

  useEffect(() => {
    // Wait for assessment to load before making permission decisions
    if (!assessment) return;

    const isClassTeacher = assessment.viewerRole === "OWNER" || assessment.viewerRole === "CO_TEACHER";
    if (!isClassTeacher && session?.user?.id) {
      setSelectedStudentId(session.user.id);
    }

    // Redirect students away if they already have a submission and can't resubmit
    if (!isClassTeacher && session?.user?.id && !isResubmit) {
      fetch(`/api/assessments/${assessmentId}/my-submission`)
        .then(res => {
          if (res.ok && !assessment.studentsCanUpload) {
            // Student already has a submission and uploads are disabled — redirect to feedback page
            router.push(`/assessments/${assessmentId}/feedback`);
          }
        })
        .catch(() => {});
    }
    // Block students from using the ?resubmit param if uploads are disabled
    if (!isClassTeacher && isResubmit && !assessment.studentsCanUpload) {
      toast({
        title: language === "uz" ? "Ruxsat yo'q" : language === "ru" ? "Нет доступа" : "Not allowed",
        description: language === "uz" ? "Qayta topshirish yopilgan" : language === "ru" ? "Повторная сдача закрыта" : "Resubmission is closed for this assessment",
        variant: "destructive",
      });
      router.push(`/assessments/${assessmentId}/feedback`);
    }
  }, [assessment, session?.user?.id, assessmentId, isResubmit, router, toast, language]);

  const [extraStudents, setExtraStudents] = useState<Student[]>([]);
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [newStudentName, setNewStudentName] = useState("");
  const [addingStudent, setAddingStudent] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [studentDropdownOpen, setStudentDropdownOpen] = useState(false);

  const allStudents = [
    ...(assessment?.class.enrollments.map((e) => e.student) || []),
    ...extraStudents,
  ];

  const filteredStudents = studentSearch.trim()
    ? allStudents.filter((s) => s.name.toLowerCase().includes(studentSearch.trim().toLowerCase()))
    : allStudents;

  const studentDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!studentDropdownOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (studentDropdownRef.current && !studentDropdownRef.current.contains(e.target as Node)) {
        setStudentDropdownOpen(false);
        setStudentSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [studentDropdownOpen]);

  const handleAddStudent = async () => {
    if (!newStudentName.trim() || !assessment) return;
    setAddingStudent(true);
    try {
      const res = await fetch(`/api/classes/${assessment.class.id}/students/${encodeURIComponent("placeholder")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newStudentName.trim() }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setExtraStudents((prev) => [...prev, { id: data.student.id, name: data.student.name, email: "" }]);
      setSelectedStudentId(data.student.id);
      setNewStudentName("");
      setShowAddStudent(false);
    } catch {
      toast({ title: language === "uz" ? "Xato" : "Error", description: language === "uz" ? "O'quvchi qo'shib bo'lmadi" : "Failed to add student", variant: "destructive" });
    } finally {
      setAddingStudent(false);
    }
  };

  const isDocFile = (file: File) =>
    file.type === "application/msword" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.name.toLowerCase().endsWith(".doc") ||
    file.name.toLowerCase().endsWith(".docx");

  const isPdfFile = (file: File) =>
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");

  const fileLimitUpgradeHint = useCallback(() => {
    if (subscriptionTier === "FREE") return "Upgrade to Basic (20MB) or Pro (50MB) for larger files.";
    if (subscriptionTier === "PLUS") return "Upgrade to Pro for up to 50MB per file.";
    return "";
  }, [subscriptionTier]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const newItems: PageItem[] = [];
    let rejectedCount = 0;

    for (const file of acceptedFiles) {
      if (file.size > fileLimit) {
        rejectedCount++;
        continue;
      }

      try {
        // Doc/PDF files can't be previewed as images — use empty string, render icon instead
        const preview = (isDocFile(file) || isPdfFile(file)) ? "" : await generatePreviewUrl(file);
        newItems.push({
          id: `new-${file.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: "new",
          file,
          preview,
          rotation: 0,
        });
      } catch {
        // Fallback or error handling
      }
    }

    if (rejectedCount > 0) {
      const limitMb = (fileLimit / (1024 * 1024)).toFixed(0);
      const hint = fileLimitUpgradeHint();
      toast({
        title: `File size limit exceeded (${limitMb}MB)`,
        description: `${rejectedCount} file(s) were skipped because they exceed your plan's ${limitMb}MB limit.${hint ? ` ${hint}` : ""}`,
        variant: "destructive",
      });
    }

    setPages((prev) => [...prev, ...newItems]);
  }, [fileLimit, fileLimitUpgradeHint, toast]);

  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      const newItems: PageItem[] = [];
      let rejectedCount = 0;

      for (const file of imageFiles) {
        if (file.size > fileLimit) {
          rejectedCount++;
          continue;
        }

        try {
          const preview = await generatePreviewUrl(file);
          newItems.push({
            id: `pasted-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: "new",
            file,
            preview,
            rotation: 0,
          });
        } catch {
          // Fallback
        }
      }

      if (rejectedCount > 0) {
        const limitMb = (fileLimit / (1024 * 1024)).toFixed(0);
        const hint = fileLimitUpgradeHint();
        toast({
          title: `File size limit exceeded (${limitMb}MB)`,
          description: `${rejectedCount} pasted file(s) exceed your plan's ${limitMb}MB limit.${hint ? ` ${hint}` : ""}`,
          variant: "destructive",
        });
      }

      if (newItems.length > 0) {
        setPages((prev) => [...prev, ...newItems]);
        toast({
          title: "Images pasted",
          description: `${newItems.length} image(s) added`,
        });
      }
    }
  }, [fileLimit, fileLimitUpgradeHint, toast]);

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".heif", ".bmp", ".tiff", ".svg"],
      "application/pdf": [".pdf"],
      "application/msword": [".doc"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
    },
    // We check size manually to provide better error messages
  });

  const removePage = (id: string) => {
    setPages((prev) => prev.filter((p) => p.id !== id));
  };

  const handleRotateImage = async (id: string) => {
    const page = pages.find((p) => p.id === id);
    if (!page) return;

    try {
      let file = page.file;

      // For reuse images, fetch the URL and convert to File
      if (!file && page.type === "reuse") {
        const response = await fetch(page.preview);
        const blob = await response.blob();
        file = new File([blob], `existing-${Date.now()}.jpg`, { type: blob.type || "image/jpeg" });
      }

      if (!file) return;

      const newRotation = ((page.rotation + 90) % 360) as 0 | 90 | 180 | 270;
      const rotatedFile = newRotation === 0
        ? file
        : await rotateImage(file, newRotation as 90 | 180 | 270);

      const newPreview = await generatePreviewUrl(rotatedFile);

      setPages((prev) =>
        prev.map((p) =>
          p.id === id
            ? { ...p, type: "new", file: rotatedFile, rotation: newRotation, preview: newPreview }
            : p
        )
      );
    } catch {
      toast({
        title: "Rotation failed",
        description: "Could not rotate the image",
        variant: "destructive",
      });
    }
  };

  const clearAllFiles = () => {
    setPages([]);
  };

  // Camera functions
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      setCameraStream(stream);
      setIsCameraOpen(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
    } catch (err) {
      toast({
        title: "Camera Error",
        description: "Could not access camera. Please check permissions.",
        variant: "destructive",
      });
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setIsCameraOpen(false);
    setCapturedCount(0);
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;

    // Trigger flash effect
    setCameraFlash(true);
    setTimeout(() => setCameraFlash(false), 200);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      
      const file = new File([blob], `camera-capture-${Date.now()}.jpg`, { type: "image/jpeg" });
      
      if (file.size > fileLimit) {
        const limitMb = (fileLimit / (1024 * 1024)).toFixed(0);
        const hint = fileLimitUpgradeHint();
        toast({
          title: `File size limit exceeded (${limitMb}MB)`,
          description: `The captured photo exceeds your plan's ${limitMb}MB limit.${hint ? ` ${hint}` : ""}`,
          variant: "destructive",
        });
        return;
      }

      const preview = canvas.toDataURL("image/jpeg");
      
      const newPage: PageItem = {
        id: `camera-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: "new",
        file,
        preview,
        rotation: 0,
      };

      setPages(prev => [...prev, newPage]);
      setCapturedCount(prev => prev + 1);
      
      toast({
        title: language === "uz" ? "Rasmga olindi" : "Photo captured",
        description: `#${capturedCount + 1}`,
        duration: 2000,
      });
    }, "image/jpeg", 0.95);
  };

  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = () => {
    const studentId = isTeacher ? selectedStudentId : session?.user?.id;

    if (!studentId) {
      toast({
        title: "No student selected",
        description: "Please select which student's work you are uploading",
        variant: "destructive",
      });
      return;
    }

    if (pages.length === 0) {
      toast({
        title: "No files selected",
        description: "Please upload images of your work",
        variant: "destructive",
      });
      return;
    }

    // Build FormData before navigating
    const formData = new FormData();
    formData.append("assessmentId", assessmentId);
    formData.append("studentId", studentId);
    formData.append("feedbackLanguage", feedbackLanguage);

    const newFiles: File[] = [];
    const reuseUrls: string[] = [];
    const pageOrder: { type: 'file' | 'reuse', index: number }[] = [];

    let newCount = 0;
    let reuseCount = 0;

    for (const page of pages) {
      if (page.type === "new" && page.file) {
        newFiles.push(page.file);
        pageOrder.push({ type: 'file', index: newCount++ });
      } else if (page.type === "reuse") {
        reuseUrls.push(page.reuseUrl || page.preview);
        pageOrder.push({ type: 'reuse', index: reuseCount++ });
      }
    }

    newFiles.forEach((file) => formData.append("files", file));
    if (reuseUrls.length > 0) {
      formData.append("reuseImageUrls", JSON.stringify(reuseUrls));
    }
    formData.append("pageOrder", JSON.stringify(pageOrder));

    setIsSubmitting(true);

    // Instant: show toast, invalidate cache, and redirect immediately
    toast({
      title: isResubmit
        ? (language === "uz" ? "Yuborilmoqda..." : language === "ru" ? "Отправляется..." : "Submitting...")
        : (language === "uz" ? "Yuborilmoqda..." : language === "ru" ? "Отправляется..." : "Submitting..."),
      description: language === "uz" ? "Ish fonda yuklanmoqda." : language === "ru" ? "Работа загружается в фоне." : "Work is uploading in the background.",
    });

    invalidateCache(`/api/assessments/${assessmentId}`);
    if (assessment?.class?.id) {
      invalidateCache(`/api/classes/${assessment.class.id}`);
    }

    // Signal the assessment page to poll until the upload completes
    sessionStorage.setItem(`submission-pending-${assessmentId}`, String(Date.now()));

    router.push(`/assessments/${assessmentId}`);

    // Fire-and-forget: upload runs in background after redirect
    fetch("/api/submissions/upload", {
      method: "POST",
      body: formData,
    }).then(async (response) => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        toast({
          title: language === "uz" ? "Yuklash xatosi" : "Upload failed",
          description: data.error || "Something went wrong",
          variant: "destructive",
        });
      }
    }).catch(() => {
      toast({
        title: language === "uz" ? "Yuklash xatosi" : "Upload failed",
        description: language === "uz" ? "Serverga ulanib bo'lmadi" : language === "ru" ? "Не удалось подключиться к серверу" : "Could not reach the server",
        variant: "destructive",
      });
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const isTeacher = assessment?.viewerRole === "OWNER" || assessment?.viewerRole === "CO_TEACHER";
  const limitMb = (fileLimit / (1024 * 1024)).toFixed(0);

  if (!isTeacher && assessment && !assessment.studentsCanUpload) {
    return (
      <div className="max-w-3xl mx-auto py-12 px-4">
        <Card className="border-destructive/20 bg-destructive/5">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <X className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle className="text-xl">{language === "uz" ? "Topshirish yopilgan" : "Submissions Closed"}</CardTitle>
            <CardDescription>{language === "uz" ? "O'qituvchi ushbu topshiriq uchun o'quvchilar tomonidan yuklashni o'chirib qo'ygan." : "The teacher has disabled student uploads."}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center pb-6">
            <Link href={`/assessments/${assessmentId}`}><Button variant="outline"><ArrowLeft className="h-4 w-4 mr-2" />{t("back")}</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/assessments/${assessmentId}`}><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            {isResubmit && <RefreshCw className="h-6 w-6" />}
            {isResubmit ? t("resubmit") || "Resubmit Work" : t("submit")}
          </h1>
          <p className="text-muted-foreground">{assessment?.title}</p>
        </div>
      </div>

      {isTeacher && (
        <Card>
          <CardHeader><CardTitle>{language === "uz" ? "O'quvchini tanlang" : "Select Student"}</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Label htmlFor="student">{language === "uz" ? "O'quvchi *" : "Student *"}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1" ref={studentDropdownRef}>
                  {studentDropdownOpen ? (
                    <>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder={language === "uz" ? "O'quvchi qidirish..." : language === "ru" ? "Поиск ученика..." : "Search students..."}
                          value={studentSearch}
                          onChange={(e) => setStudentSearch(e.target.value)}
                          className="pl-9"
                          autoFocus
                        />
                      </div>
                      <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md">
                        <div className="max-h-60 overflow-y-auto p-1">
                          {filteredStudents.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">
                              {language === "uz" ? "O'quvchi topilmadi" : language === "ru" ? "Ученик не найден" : "No students found"}
                            </p>
                          ) : (
                            filteredStudents.map((student) => {
                              const hasSubmission = assessment?.submissions.some(sub => sub.studentId === student.id);
                              const isSelected = selectedStudentId === student.id;
                              return (
                                <button
                                  key={student.id}
                                  type="button"
                                  className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-sm cursor-pointer hover:bg-accent hover:text-accent-foreground ${isSelected ? "bg-accent" : ""}`}
                                  onClick={() => {
                                    setSelectedStudentId(student.id);
                                    setStudentDropdownOpen(false);
                                    setStudentSearch("");
                                  }}
                                >
                                  {isSelected ? <Check className="h-4 w-4 text-primary" /> : <User className="h-4 w-4 opacity-50" />}
                                  <span>{student.name}</span>
                                  {!student.email && <span className="text-xs text-muted-foreground ml-1">({language === "uz" ? "qo'lda" : "manual"})</span>}
                                  {hasSubmission && <span className="text-xs text-muted-foreground ml-auto">{language === "uz" ? "(oldingi o'rniga)" : "(replace)"}</span>}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-between font-normal"
                      onClick={() => setStudentDropdownOpen(true)}
                    >
                      {selectedStudentId
                        ? allStudents.find((s) => s.id === selectedStudentId)?.name || (language === "uz" ? "O'quvchini tanlang" : "Select a student")
                        : (language === "uz" ? "O'quvchini tanlang" : "Select a student")}
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  )}
                </div>
                <Button type="button" variant="outline" size="icon" onClick={() => setShowAddStudent(!showAddStudent)} title={language === "uz" ? "Yangi o'quvchi qo'shish" : "Add new student"}>
                  <UserPlus className="h-4 w-4" />
                </Button>
              </div>
              {showAddStudent && (
                <div className="flex gap-2">
                  <Input
                    placeholder={language === "uz" ? "O'quvchi ismi" : "Student name"}
                    value={newStudentName}
                    onChange={(e) => setNewStudentName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddStudent(); }}
                    autoFocus
                  />
                  <Button type="button" size="sm" onClick={handleAddStudent} disabled={addingStudent || !newStudentName.trim()}>
                    {addingStudent ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="bg-transparent">
        <div className="mb-4 text-center sm:text-left">
          <h2 className="text-xl font-semibold">{language === "uz" ? "Ish fayllari" : "Submission Files"}</h2>
          <p className="text-sm text-muted-foreground">{language === "uz" ? "Rasm, PDF yoki Word hujjat (.doc/.docx) yuklang." : "Upload images, PDF, or Word documents (.doc/.docx)."}</p>
        </div>
        
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div {...getRootProps()} data-guide="submit-file-upload" className={`dropzone cursor-pointer border-2 border-dashed rounded-xl p-8 transition-all duration-200 h-full flex flex-col items-center justify-center ${isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/20 bg-muted/10"}`}>
              <input {...getInputProps()} />
              <Upload className="h-8 w-8 text-primary mb-4" />
              <div className="text-center">
                <p className="font-medium">{language === "uz" ? "Fayllarni tanlash" : "Select Files"}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {language === "uz" ? `Limit: ${limitMb}MB` : `Limit: ${limitMb}MB`}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{language === "uz" ? "yoki sudrab keling" : "or drag & drop"}</p>
              </div>
            </div>

            <button
              type="button"
              className="h-full border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-8 gap-4 cursor-pointer transition-all duration-200 border-border hover:border-primary/50 hover:bg-muted/20 bg-muted/10"
              onClick={startCamera}
            >
              <div className="p-4 rounded-full bg-primary/10">
                <Camera className="h-8 w-8 text-primary" />
              </div>
              <div className="text-center">
                <p className="font-medium">{language === "uz" ? "Kamera orqali olish" : "Take Picture"}</p>
                <p className="text-xs text-muted-foreground mt-1">{language === "uz" ? "Telefon kamerasidan foydalanish" : "Use your device camera"}</p>
              </div>
            </button>
          </div>

          {isCameraOpen && (
              <div
                className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-between p-4 pb-10 animate-in fade-in duration-200"
              >
                <div className="w-full flex justify-between items-center text-white mb-4">
                  <span className="font-bold text-lg">Camera</span>
                  <Badge variant="outline" className="text-white border-white">
                    {capturedCount} {language === "uz" ? "ta rasm" : "captured"}
                  </Badge>
                  <Button variant="ghost" size="icon" onClick={stopCamera} className="text-white hover:bg-white/20">
                    <X className="h-6 w-6" />
                  </Button>
                </div>

                <div className="relative flex-1 w-full max-w-md mx-auto rounded-2xl overflow-hidden bg-zinc-900 shadow-2xl border border-white/10 flex items-center justify-center">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  <canvas ref={canvasRef} className="hidden" />
                  {/* Camera flash overlay */}
                  {cameraFlash && (
                      <div
                        className="absolute inset-0 bg-white z-10 pointer-events-none animate-out fade-out duration-200"
                      />
                  )}
                </div>

                <div className="w-full max-w-md flex justify-around items-center mt-8 px-4">
                  <div className="w-12 h-12" />
                  <button
                    onClick={capturePhoto}
                    className="h-20 w-20 rounded-full border-4 border-white p-1 active:scale-90 transition-transform"
                  >
                    <div className="h-full w-full rounded-full bg-white" />
                  </button>
                  <Button
                    variant="ghost"
                    className="flex flex-col gap-1 text-white hover:bg-white/10 h-auto p-2"
                    onClick={stopCamera}
                  >
                    <Check className="h-6 w-6" />
                    <span className="text-[10px] uppercase font-bold">{language === "uz" ? "Tayyor" : "Done"}</span>
                  </Button>
                </div>
              </div>
          )}

          {pages.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium flex items-center gap-2"><ScanText className="h-4 w-4" />{language === "uz" ? `Barcha rasmlar (${pages.length})` : `All Images (${pages.length})`}</h4>
                <Button variant="outline" size="sm" onClick={clearAllFiles} className="text-destructive hover:bg-destructive/10">{language === "uz" ? "Barchasini tozalash" : "Clear All"}</Button>
              </div>

              <SortableGrid
                items={pages}
                onReorder={setPages}
                columns={3}
                gap={16}
                renderItem={(item, index, isDragging) => (
                  <div className="relative w-full h-full group bg-background rounded-lg border overflow-hidden">
                    <div className="absolute top-2 right-2 z-10 flex gap-1">
                      {!(item.file && (isDocFile(item.file) || isPdfFile(item.file))) && (
                        <>
                          <Button
                            variant="secondary"
                            size="icon"
                            className="h-6 w-6 transition-opacity bg-black/60 hover:bg-black/80"
                            onClick={(e) => { e.stopPropagation(); setZoomImage(item.preview); }}
                          >
                            <Maximize2 className="h-3 w-3 text-white" />
                          </Button>
                          <Button
                            variant="secondary"
                            size="icon"
                            className="h-6 w-6 transition-opacity bg-black/60 hover:bg-black/80"
                            onClick={(e) => { e.stopPropagation(); handleRotateImage(item.id); }}
                          >
                            <RotateCw className="h-3 w-3 text-white" />
                          </Button>
                        </>
                      )}
                      <Button
                        variant="destructive"
                        size="icon"
                        className="h-6 w-6 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); removePage(item.id); }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>

                    {item.file && (isDocFile(item.file) || isPdfFile(item.file)) ? (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-2 bg-blue-50 dark:bg-blue-950/30">
                        <FileText className="h-10 w-10 text-blue-600" />
                        <span className="text-[10px] text-center text-blue-700 dark:text-blue-400 font-medium break-all px-1 leading-tight">{item.file.name}</span>
                      </div>
                    ) : (
                      <img
                        src={item.preview}
                        alt="Page"
                        className="w-full h-full object-cover"
                        draggable={false}
                      />
                    )}

                    {item.type === "reuse" ? (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <Badge variant="outline" className="bg-background/80 text-[8px] uppercase tracking-tighter">Existing</Badge>
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <Badge variant="default" className="text-[8px] uppercase tracking-tighter">New</Badge>
                      </div>
                    )}
                  </div>
                )}
              />
            </div>
          )}

          <div className="flex gap-4 pt-4">
            <Button variant="outline" onClick={() => router.back()} disabled={isSubmitting}>{t("cancel")}</Button>
            <Button onClick={handleSubmit} disabled={isSubmitting || (isTeacher && !selectedStudentId) || pages.length === 0} className="flex-1 shadow-lg" data-guide="submit-btn">
              {isSubmitting ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{language === "uz" ? "Yuklanmoqda..." : language === "ru" ? "Загрузка..." : "Uploading..."}</>
              ) : (
                <><Upload className="h-4 w-4 mr-2" />{isResubmit ? t("resubmit") : t("submit")} ({pages.length})</>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Image zoom dialog */}
      <Dialog open={!!zoomImage} onOpenChange={() => setZoomImage(null)}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-2 sm:p-4">
          <DialogTitle className="sr-only">Image preview</DialogTitle>
          {zoomImage && (
            <img
              src={zoomImage}
              alt="Zoomed preview"
              className="w-full h-full max-h-[85vh] object-contain rounded"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
