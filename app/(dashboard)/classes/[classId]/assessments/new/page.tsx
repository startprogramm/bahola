"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useSubscriptionData } from "@/hooks/use-subscription";
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
  Coins,
  Languages,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { rotateImage, isImageFile, generatePreviewUrl } from "@/lib/utils/image-utils";
import { useLanguage } from "@/lib/i18n/language-context";
import { invalidateCachePrefix } from "@/lib/fetch-cache";

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
  file: File;
  preview?: string;
  name: string;
}

interface QuestionMark {
  id: string;
  questionNumber: string;
  marks: string;
}

export default function NewAssessmentPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { language, t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const classId = params.classId as string;
  
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

  const [showTextInput, setShowTextInput] = useState(false);
  const [showAIFeedback, setShowAIFeedback] = useState(true);
  const [studentsCanUpload, setStudentsCanUpload] = useState(false);
  const [studentsSeeMarkScheme, setStudentsSeeMarkScheme] = useState(true);
  const [studentsSeeQP, setStudentsSeeQP] = useState(true);

  const [focusedUpload, setFocusedUpload] = useState<"assessment" | "markScheme" | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [feedbackLanguageOverride, setFeedbackLanguageOverride] = useState("");
  // totalMarks: "" means auto (AI decides), a number means teacher-set explicit limit
  const [totalMarksInput, setTotalMarksInput] = useState<string>("");
  const [credits, setCredits] = useState<number | null>(null);
  const [subscriptionPlan, setSubscriptionPlan] = useState("FREE");

  const { data: subData } = useSubscriptionData();
  useEffect(() => {
    if (subData) {
      setCredits(subData.credits);
      setSubscriptionPlan(subData.subscription);
    }
  }, [subData]);

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

  const isSupportedFile = useCallback((file: File) => {
    if (file.type in SUPPORTED_TYPES) return true;
    // Fallback: match by file extension (mobile browsers may have empty/unusual MIME types)
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

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
      // totalMarks: 0 means auto (AI decides); positive number means teacher-set limit
      const parsedTotalMarks = totalMarksInput.trim() !== "" ? parseInt(totalMarksInput, 10) : 0;
      formData.append("totalMarks", String(isNaN(parsedTotalMarks) || parsedTotalMarks < 0 ? 0 : parsedTotalMarks));

      markSchemeFiles.forEach(f => formData.append("markSchemeFiles", f.file));
      assessmentFiles.forEach(f => formData.append("assessmentFiles", f.file));

      const response = await fetch(`/api/classes/${classId}/assessments`, { method: "POST", body: formData });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const msg = data?.error || "Creation failed";
        const isCredits = response.status === 402;
        toast({
          title: isCredits
            ? (language === "uz" ? "Kredit yetarli emas" : language === "ru" ? "Недостаточно кредитов" : "Insufficient credits")
            : (language === "uz" ? "Xato yuz berdi" : language === "ru" ? "Ошибка" : "Creation failed"),
          description: isCredits
            ? (language === "uz" ? "AI baholashni o'chiring yoki tarifni oshiring" : language === "ru" ? "Отключите AI оценку или обновите тариф" : "Disable AI feedback or upgrade your plan")
            : msg,
          variant: "destructive",
        });
        return;
      }

      const createdAssessmentId = data?.assessment?.id;
      if (!createdAssessmentId) throw new Error("No assessment ID in response");

      sessionStorage.removeItem(`class-detail-${classId}`);
      sessionStorage.removeItem("classes-cache");
      sessionStorage.setItem(`assessment-created-${createdAssessmentId}`, "1");
      invalidateCachePrefix(`/api/classes/${classId}`);
      router.replace(`/assessments/${createdAssessmentId}`);
    } catch (err) {
      console.error("Assessment creation error:", err);
      toast({ title: language === "uz" ? "Xato yuz berdi" : "Creation failed", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/classes/${classId}`}><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <h1 className="text-2xl font-bold tracking-tight">{t("createNewAssessment")}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="title">{t("assessmentTitleRequired")}</Label>
          <Input id="title" value={title} onChange={e => setTitle(e.target.value)} required data-guide="create-title-input" />
        </div>

        {/* Credits remaining */}
        {credits !== null && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 border text-sm">
            <Coins className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              {subscriptionPlan === "PRO" ? (language === "uz" ? "Cheksiz kreditlar" : "Unlimited credits") : `${credits} ${language === "uz" ? "kredit qoldi" : "credits remaining"}`}
            </span>
            {subscriptionPlan === "FREE" && credits <= 10 && (
              <span className="text-xs text-amber-700 dark:text-amber-500 ml-auto">{language === "uz" ? "Kam qoldi!" : "Running low!"}</span>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 border rounded-lg bg-muted/30" data-guide="create-toggles">
          {[
            { id: "ai-feedback", label: t("aiFeedback"), state: showAIFeedback, set: setShowAIFeedback },
            { id: "write-instructions", label: language === "uz" ? "Yo'riqnoma yozish" : "Write Instructions", state: showTextInput, set: setShowTextInput },
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

        {/* Total marks */}
        <div className="space-y-2">
          <Label className="font-bold">
            {language === "uz" ? "Jami ball" : language === "ru" ? "Максимальный балл" : "Total marks"}
          </Label>
          <div className="flex items-center gap-3 flex-wrap">
            {showAIFeedback && (
              <div className="flex rounded-md border overflow-hidden text-sm">
                <button
                  type="button"
                  onClick={() => setTotalMarksInput("")}
                  className={`px-3 py-1.5 transition-colors ${totalMarksInput === "" ? "bg-primary text-primary-foreground font-semibold" : "bg-background text-muted-foreground hover:bg-muted"}`}
                >
                  {language === "uz" ? "Avtomatik (AI)" : language === "ru" ? "Авто (ИИ)" : "Auto (AI)"}
                </button>
                <button
                  type="button"
                  onClick={() => { if (totalMarksInput === "") setTotalMarksInput("100"); }}
                  className={`px-3 py-1.5 transition-colors border-l ${totalMarksInput !== "" ? "bg-primary text-primary-foreground font-semibold" : "bg-background text-muted-foreground hover:bg-muted"}`}
                >
                  {language === "uz" ? "Belgilash" : language === "ru" ? "Указать" : "Set manually"}
                </button>
              </div>
            )}
            {totalMarksInput !== "" || !showAIFeedback ? (
              <Input
                type="number"
                min={1}
                max={1000}
                value={totalMarksInput !== "" ? totalMarksInput : showAIFeedback ? "" : "100"}
                onChange={e => setTotalMarksInput(e.target.value)}
                className="w-24"
                placeholder="e.g. 100"
              />
            ) : (
              <span className="text-sm text-muted-foreground">
                {language === "uz" ? "AI baholash asosida aniqlaydi" : language === "ru" ? "ИИ определит по критериям" : "AI will determine from the mark scheme"}
              </span>
            )}
          </div>
          {!showAIFeedback && (
            <p className="text-xs text-muted-foreground">
              {language === "uz" ? "AI baholash o'chirilgan — maksimal ballni qo'lda belgilang" : language === "ru" ? "ИИ оценка отключена — укажите максимальный балл вручную" : "AI grading is off — set the maximum mark manually"}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6" data-guide="create-upload-section">
          <div
            className="space-y-4"
            onMouseEnter={() => setFocusedUpload("assessment")}
          >
            <Label className="text-lg font-bold">{t("questionPaper")}</Label>
            <div className={`space-y-4 p-4 border rounded-xl bg-card transition-colors ${focusedUpload === "assessment" ? "ring-2 ring-primary/20 border-primary/50" : ""}`}>
              <p className="text-[10px] text-muted-foreground mb-1">
                {language === "uz" ? "Maxsus limit: Free - 5MB, Plus - 20MB, Pro - 50MB" : "Tier limits: Free - 5MB, Plus - 20MB, Pro - 50MB"}
              </p>
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
              <p className="text-[10px] text-muted-foreground mb-1">
                {language === "uz" ? "Maxsus limit: Free - 5MB, Plus - 20MB, Pro - 50MB" : "Tier limits: Free - 5MB, Plus - 20MB, Pro - 50MB"}
              </p>
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
                  { id: "students-upload", label: t("studentsCanUpload"), state: studentsCanUpload, set: setStudentsCanUpload },
                  { id: "students-markscheme", label: t("studentsSeeMarkScheme"), state: studentsSeeMarkScheme, set: setStudentsSeeMarkScheme },
                  { id: "students-qp", label: t("studentsSeeQP"), state: studentsSeeQP, set: setStudentsSeeQP },
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
          <Button type="submit" disabled={loading} className="flex-1 shadow-lg" data-guide="create-submit-btn">
            {loading ? (
              <div className="flex items-center gap-2 text-xs">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{language === "uz" ? "Yaratilmoqda..." : language === "ru" ? "Создается..." : "Creating..."}</span>
              </div>
            ) : t("createAssessment")}
          </Button>
        </div>
      </form>

      {/* Camera Interface Overlay */}
      {isCameraOpen && (
          <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-between p-4 pb-10 animate-in fade-in duration-200">
            <div className="w-full flex justify-between items-center text-white mb-4">
              <span className="font-bold text-lg">Camera ({getFileLabel(focusedUpload || "")})</span>
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

function getFileLabel(type: string) {
  if (type === "assessment") return "Question Paper";
  if (type === "markScheme") return "Mark Scheme";
  return "File";
}
