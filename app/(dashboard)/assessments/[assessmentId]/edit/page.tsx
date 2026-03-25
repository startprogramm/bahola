"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  ArrowLeft,
  FileText,
  Upload,
  X,
  File as FileIcon,
  Image as ImageIcon,
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  Calendar,
  Mic,
  MicOff,
  MessageSquare,
  Loader2,
  Camera,
  Check,
  Languages,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { isImageFile, generatePreviewUrl } from "@/lib/utils/image-utils";
import { useLanguage } from "@/lib/i18n/language-context";
import { normalizeImageUrl } from "@/lib/utils";

const SUPPORTED_TYPES = {
  "application/pdf": { ext: ".pdf", icon: FileText, label: "PDF" },
  "image/png": { ext: ".png", icon: ImageIcon, label: "Image" },
  "image/jpeg": { ext: ".jpg", icon: ImageIcon, label: "Image" },
  "image/jpg": { ext: ".jpg", icon: ImageIcon, label: "Image" },
  "image/gif": { ext: ".gif", icon: ImageIcon, label: "Image" },
  "image/webp": { ext: ".webp", icon: ImageIcon, label: "Image" },
  "image/heic": { ext: ".heic", icon: ImageIcon, label: "Image" },
  "image/heif": { ext: ".heif", icon: ImageIcon, label: "Image" },
  "image/bmp": { ext: ".bmp", icon: ImageIcon, label: "Image" },
  "image/tiff": { ext: ".tiff", icon: ImageIcon, label: "Image" },
  "image/svg+xml": { ext: ".svg", icon: ImageIcon, label: "Image" },
  "application/msword": { ext: ".doc", icon: FileIcon, label: "Word" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: ".docx", icon: FileIcon, label: "Word" },
  "application/vnd.ms-excel": { ext: ".xls", icon: FileSpreadsheet, label: "Excel" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: ".xlsx", icon: FileSpreadsheet, label: "Excel" },
};

const ACCEPT_STRING = Object.entries(SUPPORTED_TYPES)
  .map(([mime, { ext }]) => `${mime},${ext}`)
  .join(",");

interface MarkSchemeFile {
  id: string;
  file?: File;
  url?: string;
  preview?: string;
  name: string;
  isExisting?: boolean;
}

interface QuestionMark {
  id: string;
  questionNumber: string;
  marks: string;
}

export default function EditAssessmentPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { language, t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [fetchingData, setFetchingData] = useState(true);
  const [uploadProgress, setUploadProgress] = useState(0);
  const assessmentId = params.assessmentId as string;
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const assessmentFileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [markSchemeFiles, setMarkSchemeFiles] = useState<MarkSchemeFile[]>([]);
  const [markSchemeText, setMarkSchemeText] = useState("");
  const [assessmentFiles, setAssessmentFiles] = useState<MarkSchemeFile[]>([]);
  const [questionPaperText, setQuestionPaperText] = useState("");
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [enableMarkSchemeOcr, setEnableMarkSchemeOcr] = useState(true);
  const [questionMarks, setQuestionMarks] = useState<QuestionMark[]>([]);

  // Configurations
  const [showTextInput, setShowTextInput] = useState(false);
  const [showAIFeedback, setShowAIFeedback] = useState(true);
  const [studentsCanUpload, setStudentsCanUpload] = useState(true);
  const [studentsSeeMarkScheme, setStudentsSeeMarkScheme] = useState(false);
  const [studentsSeeQP, setStudentsSeeQP] = useState(true);

  const [focusedUpload, setFocusedUpload] = useState<"assessment" | "markScheme" | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [feedbackLanguageOverride, setFeedbackLanguageOverride] = useState("");

  // Camera state
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [capturedCount, setCapturedCount] = useState(0);
  const [cameraFlash, setCameraFlash] = useState(false);

  // feedbackLanguageOverride: empty string = "auto" (LLM detects from content)

  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    if (!focusedUpload) return;
    
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
      const newFiles: MarkSchemeFile[] = [];
      for (const file of imageFiles) {
        const newItem: MarkSchemeFile = {
          id: `${focusedUpload}-pasted-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          file,
          name: `pasted-image-${Date.now()}.jpg`,
        };
        try { newItem.preview = await generatePreviewUrl(file); } catch {}
        newFiles.push(newItem);
      }

      if (newFiles.length > 0) {
        if (focusedUpload === "assessment") setAssessmentFiles(prev => [...prev, ...newFiles]);
        else setMarkSchemeFiles(prev => [...prev, ...newFiles]);
        
        toast({
          title: language === "uz" ? "Rasm joylandi" : "Image pasted",
          description: `${newFiles.length} ta rasm`,
          duration: 2000,
        });
      }
    }
  }, [focusedUpload, language, toast]);

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  useEffect(() => {
    const fetchAssessment = async () => {
      try {
        const response = await fetch(`/api/assessments/${assessmentId}`);
        if (!response.ok) throw new Error("Failed to fetch assessment");
        const data = await response.json();
        const assessment = data.assessment;

        setTitle(assessment.title || "");
        if (assessment.dueDate) {
          const date = new Date(assessment.dueDate);
          setDueDate(date.toISOString().slice(0, 10));
        }

        setShowAIFeedback(assessment.showAIFeedback ?? true);
        setShowTextInput(assessment.showTextInput ?? false);
        setStudentsCanUpload(assessment.studentsCanUpload ?? true);
        setStudentsSeeMarkScheme(assessment.studentsSeeMarkScheme ?? false);
        setStudentsSeeQP(assessment.studentsSeeQP ?? true);

        setMarkSchemeText(assessment.markScheme || "");
        setQuestionPaperText(assessment.questionPaper || "");
        setCustomPrompt(assessment.customPrompt || "");
        // Load saved feedback language
        const savedLang = assessment.feedbackLanguage || "";
        setFeedbackLanguageOverride(savedLang);

        if (assessment.markSchemeFileUrls) {
          try {
            const urls = JSON.parse(assessment.markSchemeFileUrls);
            setMarkSchemeFiles(urls.map((url: string, idx: number) => ({
              id: `existing-ms-${idx}`,
              url,
              name: url.split('/').pop() || `File ${idx + 1}`,
              isExisting: true
            })));
          } catch {}
        }

        if (assessment.questionPaperFileUrls) {
          try {
            const urls = JSON.parse(assessment.questionPaperFileUrls);
            setAssessmentFiles(urls.map((url: string, idx: number) => ({
              id: `existing-qp-${idx}`,
              url,
              name: url.split('/').pop() || `File ${idx + 1}`,
              isExisting: true
            })));
          } catch {}
        }

        if (assessment.questionMarks) {
          try {
            const parsed = JSON.parse(assessment.questionMarks);
            setQuestionMarks(parsed.map((q: any, idx: number) => ({
              id: `q-${idx}`,
              questionNumber: q.question,
              marks: String(q.marks),
            })));
          } catch {}
        }

        setFetchingData(false);
      } catch (error) {
        toast({ title: "Error", description: "Failed to load assessment", variant: "destructive" });
        router.back();
      }
    };
    fetchAssessment();
  }, [assessmentId, router, toast]);

  const isSupportedFile = useCallback((file: File) => {
    if (file.type in SUPPORTED_TYPES) return true;
    const ext = file.name.toLowerCase().substring(file.name.lastIndexOf("."));
    return Object.values(SUPPORTED_TYPES).some(t => t.ext === ext);
  }, []);

  const processFiles = useCallback(async (files: FileList | File[], target: "assessment" | "markScheme") => {
    const newFiles: MarkSchemeFile[] = [];
    for (const file of Array.from(files)) {
      if (isSupportedFile(file)) {
        const newItem: MarkSchemeFile = {
          id: `${target}-${file.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          file,
          name: file.name,
        };
        if (isImageFile(file)) {
           try { newItem.preview = await generatePreviewUrl(file); } catch {}
        }
        newFiles.push(newItem);
      }
    }
    if (newFiles.length > 0) {
      if (target === "assessment") setAssessmentFiles(prev => [...prev, ...newFiles]);
      else setMarkSchemeFiles(prev => [...prev, ...newFiles]);
    }
  }, [isSupportedFile]);

  // Camera functions
  const startCamera = (target: "assessment" | "markScheme") => {
    setFocusedUpload(target);
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    }).then(stream => {
      setCameraStream(stream);
      setIsCameraOpen(true);
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      }, 100);
    }).catch(() => {
      toast({ title: "Camera Error", description: "Could not access camera", variant: "destructive" });
    });
  };

  const stopCamera = () => {
    console.log("Stopping camera...");
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => {
        track.stop();
        console.log("Track stopped:", track.label);
      });
      setCameraStream(null);
    }
    setIsCameraOpen(false);
    setCapturedCount(0);
    setFocusedUpload(null);
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current || !focusedUpload) return;

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

    canvas.toBlob(blob => {
      if (!blob) return;
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
      const preview = canvas.toDataURL("image/jpeg");
      const newItem = { id: `camera-${Date.now()}`, file, name: file.name, preview };

      if (focusedUpload === "assessment") setAssessmentFiles(prev => [...prev, newItem]);
      else setMarkSchemeFiles(prev => [...prev, newItem]);

      setCapturedCount(prev => prev + 1);
      toast({ title: language === "uz" ? "Rasmga olindi" : "Captured", duration: 2000 });
    }, "image/jpeg", 0.95);
  };

  const addQuestionMark = () => {
    const nextNum = questionMarks.length + 1;
    setQuestionMarks(prev => [...prev, { id: `q-${Date.now()}`, questionNumber: nextNum.toString(), marks: "" }]);
  };

  const updateQuestionMark = (id: string, field: "questionNumber" | "marks", value: string) => {
    setQuestionMarks(prev => prev.map(q => q.id === id ? { ...q, [field]: value } : q));
  };

  const removeQuestionMark = (id: string) => {
    setQuestionMarks(prev => prev.filter(q => q.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setUploadProgress(0);
    const progressInterval = setInterval(() => setUploadProgress(p => p >= 90 ? p : p + 10), 300);

    try {
      const formData = new FormData();
      formData.append("title", title);
      formData.append("feedbackLanguage", feedbackLanguageOverride.trim() || "auto");
      formData.append("enableMarkSchemeOcr", enableMarkSchemeOcr.toString());
      formData.append("showTextInput", showTextInput.toString());
      formData.append("showAIFeedback", showAIFeedback.toString());
      formData.append("studentsCanUpload", studentsCanUpload.toString());
      formData.append("studentsSeeMarkScheme", studentsSeeMarkScheme.toString());
      formData.append("studentsSeeQP", studentsSeeQP.toString());
      const instructionText = showTextInput ? customPrompt.trim() : "";
      formData.append("markSchemeText", instructionText);
      formData.append("questionPaperText", instructionText);
      if (dueDate) formData.append("dueDate", new Date(dueDate).toISOString());
      if (customPrompt.trim()) formData.append("customPrompt", customPrompt.trim());

      markSchemeFiles.filter(f => f.isExisting).forEach(f => formData.append("keepMarkSchemeUrls", f.url!));
      assessmentFiles.filter(f => f.isExisting).forEach(f => formData.append("keepAssessmentUrls", f.url!));
      markSchemeFiles.filter(f => !f.isExisting).forEach(f => formData.append("markSchemeFiles", f.file!));
      assessmentFiles.filter(f => !f.isExisting).forEach(f => formData.append("assessmentFiles", f.file!));

      const response = await fetch(`/api/assessments/${assessmentId}`, { method: "PATCH", body: formData });
      if (!response.ok) throw new Error();

      clearInterval(progressInterval);
      setUploadProgress(100);
      // Invalidate all class-detail caches since we don't have classId here
      if (typeof window !== "undefined") {
        Object.keys(sessionStorage).filter(k => k.startsWith("class-detail-")).forEach(k => sessionStorage.removeItem(k));
      }
      toast({ title: language === "uz" ? "Yangilandi" : "Updated", variant: "success" });
      router.push(`/assessments/${assessmentId}`);
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (fetchingData) return <div className="max-w-2xl mx-auto p-10 text-center"><Loader2 className="animate-spin mx-auto h-10 w-10 text-primary" /></div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/assessments/${assessmentId}`}><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-bold tracking-tight">{language === "uz" ? "Topshiriqni tahrirlash" : "Edit Assessment"}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="title">{t("assessmentTitleRequired")}</Label>
          <Input id="title" value={title} onChange={e => setTitle(e.target.value)} required />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 border rounded-lg bg-muted/30">
          {[
            { id: "ai-feedback-edit", label: t("aiFeedback"), state: showAIFeedback, set: setShowAIFeedback },
          ].map((item) => (
            <div key={item.id} className="flex items-center justify-between space-x-2 p-2 rounded-md hover:bg-background/50 transition-colors cursor-pointer" onClick={() => item.set(!item.state)}>
              <Label className="text-sm font-bold cursor-pointer flex-1">{item.label}</Label>
              <Switch checked={item.state} onCheckedChange={item.set} onClick={(e) => e.stopPropagation()} />
            </div>
          ))}
        </div>

        {showTextInput && (
          <div className="space-y-2">
            <Label className="font-bold">{language === "uz" ? "Yo'riqnoma (MS va QP uchun umumiy)" : "Instructions (shared for MS and QP)"}</Label>
            <Textarea value={customPrompt} onChange={e => setCustomPrompt(e.target.value)} className="min-h-[100px]" />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="dueDate" className="flex items-center gap-2 font-bold"><Calendar className="h-4 w-4" />{t("dueDate")}</Label>
          <Input id="dueDate" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full max-w-xs" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div 
            className="space-y-4"
            onMouseEnter={() => setFocusedUpload("assessment")}
          >
            <Label className="text-lg font-bold">{t("questionPaper")}</Label>
            <div className={`space-y-4 p-4 border rounded-xl bg-card transition-colors ${focusedUpload === "assessment" ? "ring-2 ring-primary/20 border-primary/50" : ""}`}>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => { setFocusedUpload("assessment"); assessmentFileInputRef.current?.click(); }} className="gap-2"><Upload className="h-4 w-4" /> {t("upload")}</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => startCamera("assessment")} className="gap-2"><Camera className="h-4 w-4" /> {language === "uz" ? "Kamera" : "Camera"}</Button>
              </div>
              <input ref={assessmentFileInputRef} type="file" accept={ACCEPT_STRING} onChange={e => { if (e.target.files) processFiles(e.target.files, "assessment"); e.target.value = ""; }} className="hidden" multiple />
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {assessmentFiles.map(f => (
                  <div key={f.id} className="flex items-center gap-2 p-2 border rounded-lg bg-muted/30 text-xs font-bold">
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="flex-1 truncate">{f.name}</span>
                    {f.isExisting && <Badge variant="outline" className="text-[8px] h-4">Existing</Badge>}
                    <button type="button" onClick={() => setAssessmentFiles(prev => prev.filter(x => x.id !== f.id))} className="text-destructive"><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div 
            className="space-y-4"
            onMouseEnter={() => setFocusedUpload("markScheme")}
          >
            <Label className="text-lg font-bold">{t("markScheme")}</Label>
            <div className={`space-y-4 p-4 border rounded-xl bg-card transition-colors ${focusedUpload === "markScheme" ? "ring-2 ring-primary/20 border-primary/50" : ""}`}>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => { setFocusedUpload("markScheme"); fileInputRef.current?.click(); }} className="gap-2"><Upload className="h-4 w-4" /> {t("upload")}</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => startCamera("markScheme")} className="gap-2"><Camera className="h-4 w-4" /> {language === "uz" ? "Kamera" : "Camera"}</Button>
              </div>
              <input ref={fileInputRef} type="file" accept={ACCEPT_STRING} onChange={e => { if (e.target.files) processFiles(e.target.files, "markScheme"); e.target.value = ""; }} className="hidden" multiple />
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {markSchemeFiles.map(f => (
                  <div key={f.id} className="flex items-center gap-2 p-2 border rounded-lg bg-muted/30 text-xs font-bold">
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="flex-1 truncate">{f.name}</span>
                    {f.isExisting && <Badge variant="outline" className="text-[8px] h-4">Existing</Badge>}
                    <button type="button" onClick={() => setMarkSchemeFiles(prev => prev.filter(x => x.id !== f.id))} className="text-destructive"><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <button type="button" onClick={() => setShowAdvancedOptions(!showAdvancedOptions)} className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors bg-muted/10">
            <span className="font-bold">{t("advancedOptions")}</span>
            {showAdvancedOptions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showAdvancedOptions && (
            <div className="p-4 space-y-6 border-t">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 border rounded-lg bg-muted/30">
                {[
                  { id: "write-instructions-edit", label: language === "uz" ? "Yo'riqnoma yozish" : "Write Instructions", state: showTextInput, set: setShowTextInput },
                  { id: "students-upload-edit", label: t("studentsCanUpload"), state: studentsCanUpload, set: setStudentsCanUpload },
                  { id: "students-markscheme-edit", label: t("studentsSeeMarkScheme"), state: studentsSeeMarkScheme, set: setStudentsSeeMarkScheme },
                  { id: "students-qp-edit", label: t("studentsSeeQP"), state: studentsSeeQP, set: setStudentsSeeQP },
                ].map((item) => (
                  <div key={item.id} className="flex items-center justify-between space-x-2 p-2 rounded-md hover:bg-background/50 transition-colors cursor-pointer" onClick={() => item.set(!item.state)}>
                    <Label className="text-sm font-bold cursor-pointer flex-1">{item.label}</Label>
                    <Switch checked={item.state} onCheckedChange={item.set} onClick={(e) => e.stopPropagation()} />
                  </div>
                ))}
              </div>

              {/* Feedback language override */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2 font-bold">
                  <Languages className="h-4 w-4" />
                  {language === "uz" ? "Sharh tili" : language === "ru" ? "Язык обратной связи" : "Language of feedback"}
                </Label>
                <Select value={feedbackLanguageOverride || "auto"} onValueChange={v => setFeedbackLanguageOverride(v === "auto" ? "" : v)}>
                  <SelectTrigger className="max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{language === "uz" ? "Avtomatik (savolnoma tili)" : language === "ru" ? "Авто (язык вопросов)" : "Auto (language of questions)"}</SelectItem>
                    <SelectItem value="english">English</SelectItem>
                    <SelectItem value="uzbek">O&apos;zbekcha</SelectItem>
                    <SelectItem value="russian">Русский</SelectItem>
                    <SelectItem value="french">Français</SelectItem>
                    <SelectItem value="german">Deutsch</SelectItem>
                    <SelectItem value="arabic">العربية</SelectItem>
                    <SelectItem value="ukrainian">Українська</SelectItem>
                    <SelectItem value="japanese">日本語</SelectItem>
                    <SelectItem value="chinese">中文</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {language === "uz"
                    ? "\"Avtomatik\" — AI savolnoma tilini aniqlaydi va shu tilda javob beradi"
                    : language === "ru"
                    ? "\"Авто\" — AI определит язык вопросов и ответит на нём"
                    : "\"Auto\" — AI detects the language of questions and responds in it"}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-4 pt-4">
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={loading}>{t("cancel")}</Button>
          <Button type="submit" disabled={loading} className="flex-1 shadow-lg">
            {loading ? (
              <div className="flex items-center gap-2 w-full">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span>{language === "uz" ? "Saqlanmoqda..." : "Saving..."}</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-primary transition-[width] duration-300 ease-linear" style={{ width: `${uploadProgress}%` }} />
                  </div>
                </div>
              </div>
            ) : t("saveChanges")}
          </Button>
        </div>
      </form>

      {/* Camera Interface Overlay */}
      {isCameraOpen && (
          <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-between p-4 pb-10 animate-in fade-in duration-200">
            <div className="w-full flex justify-between items-center text-white mb-4">
              <span className="font-bold text-lg">Camera</span>
              <Badge variant="outline" className="text-white border-white">{capturedCount} captured</Badge>
              <Button variant="ghost" size="icon" onClick={stopCamera} className="text-white hover:bg-white/20"><X className="h-6 w-6" /></Button>
            </div>
            <div className="relative flex-1 w-full max-w-md mx-auto rounded-2xl overflow-hidden bg-zinc-900 border border-white/10 flex items-center justify-center">
              <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
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
              <button onClick={capturePhoto} className="h-20 w-20 rounded-full border-4 border-white p-1 active:scale-90 transition-transform">
                <div className="h-full w-full rounded-full bg-white" />
              </button>
              <Button variant="ghost" className="flex flex-col gap-1 text-white hover:bg-white/10 h-auto p-2" onClick={stopCamera}><Check className="h-6 w-6" /><span className="text-[10px] uppercase font-bold">{language === "uz" ? "Tayyor" : "Done"}</span></Button>
            </div>
          </div>
      )}
    </div>
  );
}
