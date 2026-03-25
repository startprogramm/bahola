"use client";

import { useState, useEffect, useRef } from "react";
import {
  Loader2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n/language-context";
import { getBannerStyle, CLASS_BANNERS, BANNER_SHAPES } from "@/lib/class-banners";
import { notifyClassesChanged } from "@/lib/fetch-cache";
import type { ClassDetail } from "./types";

interface EditClassDialogProps {
  classId: string;
  classData: ClassDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClassDataChange: (updater: (prev: ClassDetail | null) => ClassDetail | null) => void;
}

export function EditClassDialog({
  classId,
  classData,
  open,
  onOpenChange,
  onClassDataChange,
}: EditClassDialogProps) {
  const { toast } = useToast();
  const { t, language } = useLanguage();

  const [editName, setEditName] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editBannerStyle, setEditBannerStyle] = useState("1-1");
  const [editClassAvatar, setEditClassAvatar] = useState<string | null>(null);
  const [bannerTab, setBannerTab] = useState<"preset" | "upload">("preset");
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [loadingCrop, setLoadingCrop] = useState(false);
  const [pendingCroppedFile, setPendingCroppedFile] = useState<File | null>(null);
  const bannerFileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Crop state
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const cropImgRef = useRef<HTMLImageElement>(null);
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [dragMode, setDragMode] = useState<"draw" | "move" | "resize">("draw");
  const [moveOffset, setMoveOffset] = useState({ x: 0, y: 0 });
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const [dragStartRect, setDragStartRect] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const cropContainerRef = useRef<HTMLDivElement>(null);

  // Initialize edit form fields whenever the dialog opens
  useEffect(() => {
    if (open && classData) {
      setEditName(classData.name);
      setEditSubject(classData.subject || "");
      setEditBannerStyle(classData.bannerStyle || "1-1");
      setEditClassAvatar(classData.classAvatar || null);
      setBannerTab(classData.classAvatar ? "upload" : "preset");
      setPendingCroppedFile(null);
      setCropImageSrc(null);
      setLoadingCrop(false);
    }
  }, [open, classData]);

  // Banner aspect ratio: 21:9
  const BANNER_ASPECT = 21 / 9;

  const handleFileSelected = (file: File) => {
    setLoadingCrop(true);
    setBannerTab("upload");
    const reader = new FileReader();
    reader.onload = (e) => {
      setCropImageSrc(e.target?.result as string);
      setCropFile(file);
      setLoadingCrop(false);
    };
    reader.readAsDataURL(file);
  };

  const handleCropImageLoad = () => {
    const img = cropImgRef.current;
    const container = cropContainerRef.current;
    if (!img || !container) return;
    const iw = img.offsetWidth;
    const ih = img.offsetHeight;
    const selW = iw;
    const selH = Math.min(ih, Math.round(iw / BANNER_ASPECT));
    const selY = Math.round((ih - selH) / 2);
    setCropRect({ x: 0, y: selY, w: selW, h: selH });
  };

  const getContainerRelativePos = (e: React.MouseEvent | React.TouchEvent) => {
    const container = cropContainerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const getResizeHandle = (pos: { x: number; y: number }, rect: { x: number; y: number; w: number; h: number }) => {
    if (rect.w < 10 || rect.h < 10) return null;
    const HIT = 10;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const hits = (ax: number, ay: number) => Math.abs(pos.x - ax) <= HIT && Math.abs(pos.y - ay) <= HIT;
    if (hits(rect.x, rect.y)) return "nw";
    if (hits(rect.x + rect.w, rect.y)) return "ne";
    if (hits(rect.x, rect.y + rect.h)) return "sw";
    if (hits(rect.x + rect.w, rect.y + rect.h)) return "se";
    if (hits(cx, rect.y)) return "n";
    if (hits(cx, rect.y + rect.h)) return "s";
    if (hits(rect.x, cy)) return "w";
    if (hits(rect.x + rect.w, cy)) return "e";
    return null;
  };

  const handleCursorForHandle = (handle: string | null) => {
    const map: Record<string, string> = { nw: "nw-resize", ne: "ne-resize", sw: "sw-resize", se: "se-resize", n: "n-resize", s: "s-resize", w: "w-resize", e: "e-resize" };
    return handle ? map[handle] : null;
  };

  const handleCropMouseDown = (e: React.MouseEvent) => {
    const pos = getContainerRelativePos(e);
    setIsDragging(true);
    setDragStart(pos);

    const handle = getResizeHandle(pos, cropRect);
    if (handle) {
      setDragMode("resize");
      setResizeHandle(handle);
      setDragStartRect({ ...cropRect });
      return;
    }

    const inside =
      cropRect.w > 10 &&
      cropRect.h > 10 &&
      pos.x >= cropRect.x &&
      pos.x <= cropRect.x + cropRect.w &&
      pos.y >= cropRect.y &&
      pos.y <= cropRect.y + cropRect.h;

    if (inside) {
      setDragMode("move");
      setMoveOffset({ x: pos.x - cropRect.x, y: pos.y - cropRect.y });
    } else {
      setDragMode("draw");
      setCropRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
    }
  };

  const handleCropMouseMove = (e: React.MouseEvent) => {
    const img = cropImgRef.current;
    if (!img) return;
    const pos = getContainerRelativePos(e);
    const iw = img.offsetWidth;
    const ih = img.offsetHeight;

    if (!isDragging) {
      const handle = getResizeHandle(pos, cropRect);
      const cursor = handleCursorForHandle(handle);
      if (cursor) {
        (e.currentTarget as HTMLDivElement).style.cursor = cursor;
      } else if (cropRect.w > 10 && cropRect.h > 10 &&
        pos.x >= cropRect.x && pos.x <= cropRect.x + cropRect.w &&
        pos.y >= cropRect.y && pos.y <= cropRect.y + cropRect.h) {
        (e.currentTarget as HTMLDivElement).style.cursor = "grab";
      } else {
        (e.currentTarget as HTMLDivElement).style.cursor = "crosshair";
      }
      return;
    }

    if (dragMode === "resize" && resizeHandle) {
      let { x, y, w, h } = dragStartRect;
      const dx = pos.x - dragStart.x;
      const dy = pos.y - dragStart.y;

      if (resizeHandle.includes("e")) {
        w = Math.max(20, Math.min(iw - x, dragStartRect.w + dx));
        h = Math.round(w / BANNER_ASPECT);
      } else if (resizeHandle.includes("w")) {
        const newX = Math.max(0, Math.min(dragStartRect.x + dragStartRect.w - 20, dragStartRect.x + dx));
        w = Math.max(20, dragStartRect.x + dragStartRect.w - newX);
        w = Math.min(iw - newX, w);
        h = Math.round(w / BANNER_ASPECT);
        x = newX;
      } else if (resizeHandle === "s") {
        h = Math.max(10, Math.min(ih - y, dragStartRect.h + dy));
        w = Math.round(h * BANNER_ASPECT);
        w = Math.min(iw - x, w);
        h = Math.round(w / BANNER_ASPECT);
      } else if (resizeHandle === "n") {
        const newY = Math.max(0, Math.min(dragStartRect.y + dragStartRect.h - 10, dragStartRect.y + dy));
        h = Math.max(10, dragStartRect.y + dragStartRect.h - newY);
        w = Math.round(h * BANNER_ASPECT);
        w = Math.min(iw - x, w);
        h = Math.round(w / BANNER_ASPECT);
        y = newY;
      }

      w = Math.max(20, Math.min(iw - x, w));
      h = Math.round(w / BANNER_ASPECT);
      if (y + h > ih) { h = ih - y; w = Math.round(h * BANNER_ASPECT); }

      setCropRect({ x, y, w, h });

    } else if (dragMode === "move") {
      const newX = Math.max(0, Math.min(iw - cropRect.w, pos.x - moveOffset.x));
      const newY = Math.max(0, Math.min(ih - cropRect.h, pos.y - moveOffset.y));
      setCropRect((prev) => ({ ...prev, x: newX, y: newY }));
    } else {
      const x = Math.max(0, Math.min(dragStart.x, pos.x));
      const y = Math.max(0, Math.min(dragStart.y, pos.y));
      const rawW = Math.abs(pos.x - dragStart.x);
      const w = Math.min(iw - x, rawW);
      const h = Math.min(ih - y, Math.round(w / BANNER_ASPECT));
      setCropRect({ x, y, w, h });
    }
  };

  const handleCropMouseUp = () => {
    setIsDragging(false);
    setResizeHandle(null);
  };

  const handleCropDone = async () => {
    const img = cropImgRef.current;
    if (!img || !cropFile) return;

    const scaleX = img.naturalWidth / img.offsetWidth;
    const scaleY = img.naturalHeight / img.offsetHeight;

    const useFullImage = cropRect.w < 10 || cropRect.h < 10;

    const canvas = document.createElement("canvas");
    if (useFullImage) {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
    } else {
      const sx = cropRect.x * scaleX;
      const sy = cropRect.y * scaleY;
      const sw = cropRect.w * scaleX;
      const sh = cropRect.h * scaleY;
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    }

    canvas.toBlob((blob) => {
      if (!blob) return;
      const croppedFile = new File([blob], cropFile.name.replace(/\.[^.]+$/, ".png"), { type: "image/png" });
      const localUrl = URL.createObjectURL(croppedFile);
      setPendingCroppedFile(croppedFile);
      setEditClassAvatar(localUrl);
      setBannerTab("upload");
      setCropImageSrc(null);
    }, "image/png");
  };

  const handleRemoveBannerImage = async () => {
    if (pendingCroppedFile) {
      if (editClassAvatar?.startsWith("blob:")) URL.revokeObjectURL(editClassAvatar);
      setPendingCroppedFile(null);
      setEditClassAvatar(null);
      setBannerTab("preset");
      return;
    }
    try {
      await fetch(`/api/classes/${classId}/banner`, { method: "DELETE" });
      setEditClassAvatar(null);
      setBannerTab("preset");
      onClassDataChange((prev) => prev ? { ...prev, classAvatar: null } : prev);
      sessionStorage.removeItem(`class-detail-${classId}`);
      sessionStorage.removeItem("classes-cache");
      sessionStorage.removeItem("sidebar-classes-cache");
      notifyClassesChanged();
    } catch {
      toast({ title: "Failed to remove image", variant: "destructive" });
    }
  };

  const handleSaveEdit = async () => {
    if (!editName.trim()) {
      toast({
        title: language === "uz" ? "Nom kiritilishi shart" : language === "ru" ? "Введите название" : "Name is required",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      let savedAvatarUrl: string | null = editClassAvatar?.startsWith("blob:") ? null : (editClassAvatar || null);
      if (pendingCroppedFile) {
        setUploadingBanner(true);
        setUploadProgress(0);
        savedAvatarUrl = await new Promise<string>((resolve, reject) => {
          const formData = new FormData();
          formData.append("file", pendingCroppedFile);
          const xhr = new XMLHttpRequest();
          xhr.open("POST", `/api/classes/${classId}/banner`);
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              setUploadProgress(100);
              resolve(JSON.parse(xhr.responseText).classAvatar);
            } else {
              try { reject(new Error(JSON.parse(xhr.responseText).error || "Upload failed")); }
              catch { reject(new Error("Upload failed")); }
            }
          };
          xhr.onerror = () => reject(new Error("Network error"));
          xhr.send(formData);
        });
        if (editClassAvatar?.startsWith("blob:")) URL.revokeObjectURL(editClassAvatar);
        setPendingCroppedFile(null);
        setUploadingBanner(false);
        setUploadProgress(0);
      }

      const payload = {
        name: editName.trim(),
        subject: editSubject.trim() || null,
        bannerStyle: bannerTab === "preset" ? (editBannerStyle || null) : null,
      };
      const response = await fetch(`/api/classes/${classId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        onClassDataChange((prev) => prev ? {
          ...prev,
          name: data.class.name,
          subject: data.class.subject,
          bannerStyle: data.class.bannerStyle,
          classAvatar: savedAvatarUrl ?? data.class.classAvatar,
        } : prev);
        onOpenChange(false);
        sessionStorage.removeItem(`class-detail-${classId}`);
        sessionStorage.removeItem("classes-cache");
        sessionStorage.removeItem("sidebar-classes-cache");
        notifyClassesChanged();
        toast({ title: language === "uz" ? "Saqlandi" : language === "ru" ? "Сохранено" : "Saved" });
      } else {
        throw new Error("Failed to save");
      }
    } catch (err) {
      toast({
        title: language === "uz" ? "Xatolik" : language === "ru" ? "Ошибка" : "Error",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
      setUploadingBanner(false);
      setUploadProgress(0);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !cropImageSrc) onOpenChange(false); }}>
      <DialogContent className="max-w-lg p-0 overflow-hidden" onPointerDownOutside={(e: Event) => e.preventDefault()}>
        {cropImageSrc ? (
          /* INLINE CROP VIEW */
          <>
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="text-base font-semibold">
                {language === "uz" ? "Rasmni kesish" : language === "ru" ? "Обрезать фото" : "Adjust photo"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {language === "uz" ? "Kerakli qismni belgilang" : language === "ru" ? "Выделите нужную область" : "Drag to select area"}
              </p>
            </div>
            <div className="p-4 bg-muted/30">
              <div
                ref={cropContainerRef}
                className="relative inline-block w-full select-none overflow-hidden rounded-lg"
                style={{ cursor: "crosshair" }}
                onMouseDown={handleCropMouseDown}
                onMouseMove={handleCropMouseMove}
                onMouseUp={handleCropMouseUp}
                onMouseLeave={handleCropMouseUp}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={cropImgRef}
                  src={cropImageSrc}
                  alt="Crop preview"
                  className="w-full h-auto block max-h-[50vh] object-contain"
                  draggable={false}
                  onLoad={handleCropImageLoad}
                />
                {cropRect.w > 4 && cropRect.h > 4 && (() => {
                  const { x, y, w, h } = cropRect;
                  const cx = x + w / 2;
                  const cy = y + h / 2;
                  const handles = [
                    { id: "nw", hx: x, hy: y }, { id: "n", hx: cx, hy: y }, { id: "ne", hx: x + w, hy: y },
                    { id: "w", hx: x, hy: cy }, { id: "e", hx: x + w, hy: cy },
                    { id: "sw", hx: x, hy: y + h }, { id: "s", hx: cx, hy: y + h }, { id: "se", hx: x + w, hy: y + h },
                  ];
                  return (
                    <svg className="absolute inset-0 w-full h-full pointer-events-none">
                      <defs>
                        <mask id="cropMask">
                          <rect width="100%" height="100%" fill="white" />
                          <rect x={x} y={y} width={w} height={h} fill="black" />
                        </mask>
                      </defs>
                      <rect width="100%" height="100%" fill="rgba(0,0,0,0.5)" mask="url(#cropMask)" />
                      <rect x={x} y={y} width={w} height={h} fill="none" stroke="white" strokeWidth="2" strokeDasharray="6 3" />
                      <line x1={x + w / 3} y1={y} x2={x + w / 3} y2={y + h} stroke="white" strokeWidth="0.5" strokeOpacity="0.4" />
                      <line x1={x + 2 * w / 3} y1={y} x2={x + 2 * w / 3} y2={y + h} stroke="white" strokeWidth="0.5" strokeOpacity="0.4" />
                      <line x1={x} y1={y + h / 3} x2={x + w} y2={y + h / 3} stroke="white" strokeWidth="0.5" strokeOpacity="0.4" />
                      <line x1={x} y1={y + 2 * h / 3} x2={x + w} y2={y + 2 * h / 3} stroke="white" strokeWidth="0.5" strokeOpacity="0.4" />
                      {handles.map(({ id, hx, hy }) => (
                        <rect key={id} x={hx - 5} y={hy - 5} width={10} height={10} fill="white" stroke="rgba(0,0,0,0.3)" strokeWidth="1" rx="2" />
                      ))}
                    </svg>
                  );
                })()}
              </div>
            </div>
            <div className="flex justify-between items-center px-5 py-4 border-t bg-background">
              <button
                type="button"
                onClick={() => setCropImageSrc(null)}
                className="text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
              >
                {language === "uz" ? "Bekor qilish" : language === "ru" ? "Отмена" : "Cancel"}
              </button>
              <Button onClick={handleCropDone} disabled={uploadingBanner}>
                {uploadingBanner ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {language === "uz" ? "Tayyor" : language === "ru" ? "Готово" : "Done"}
              </Button>
            </div>
          </>
        ) : (
          /* NORMAL EDIT VIEW */
          <>
            {/* Live Banner Preview at top */}
            <div
              className="relative h-44 overflow-hidden"
              style={
                bannerTab === "upload" && editClassAvatar
                  ? {}
                  : { background: getBannerStyle(editBannerStyle) }
              }
            >
              {bannerTab === "upload" && editClassAvatar && (
                <>
                  <img src={editClassAvatar} alt="Banner" className="absolute inset-0 w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                </>
              )}
              {(bannerTab === "preset" || !editClassAvatar) && (() => {
                const sid = parseInt(editBannerStyle.split("-")[1]) || 1;
                return (
                  <>
                    {sid === 1 && <svg className="absolute right-8 top-4 opacity-20" width="80" height="60" viewBox="0 0 120 100"><polygon points="0,0 60,25 0,50" fill="white" /><polygon points="30,30 90,55 30,80" fill="white" /></svg>}
                    {sid === 2 && <><div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-white/10" /><div className="absolute right-28 top-5 w-12 h-12 rounded-full bg-white/15" /></>}
                    {sid === 3 && <svg className="absolute inset-0 w-full h-full opacity-10" preserveAspectRatio="none"><pattern id="pl" patternUnits="userSpaceOnUse" width="40" height="40"><path d="M-10,10 l20,-20 M0,40 l40,-40 M30,50 l20,-20" stroke="white" strokeWidth="2" fill="none" /></pattern><rect width="100%" height="100%" fill="url(#pl)" /></svg>}
                    {sid === 4 && <svg className="absolute right-0 top-0 opacity-15" width="120" height="100" viewBox="0 0 200 150"><polygon points="100,10 140,35 140,85 100,110 60,85 60,35" fill="white" /></svg>}
                    {sid === 5 && <svg className="absolute bottom-0 left-0 right-0 opacity-20" height="40" preserveAspectRatio="none" viewBox="0 0 1200 60"><path d="M0,30 Q150,0 300,30 T600,30 T900,30 T1200,30 V60 H0 Z" fill="white" /></svg>}
                    {sid === 6 && <svg className="absolute inset-0 w-full h-full" viewBox="0 0 800 120" preserveAspectRatio="xMinYMid slice" xmlns="http://www.w3.org/2000/svg"><line x1="30" y1="0" x2="30" y2="120" stroke="white" strokeOpacity="0.30" strokeWidth="1" /><line x1="80" y1="0" x2="80" y2="120" stroke="white" strokeOpacity="0.30" strokeWidth="1" /><line x1="130" y1="0" x2="130" y2="120" stroke="white" strokeOpacity="0.30" strokeWidth="1" /><line x1="180" y1="0" x2="180" y2="120" stroke="white" strokeOpacity="0.30" strokeWidth="1" /><line x1="230" y1="0" x2="230" y2="120" stroke="white" strokeOpacity="0.30" strokeWidth="1" /><line x1="280" y1="0" x2="280" y2="120" stroke="white" strokeOpacity="0.30" strokeWidth="1" /><line x1="330" y1="0" x2="330" y2="120" stroke="white" strokeOpacity="0.30" strokeWidth="1" /><line x1="380" y1="0" x2="380" y2="120" stroke="white" strokeOpacity="0.30" strokeWidth="1" /><line x1="430" y1="0" x2="430" y2="120" stroke="white" strokeOpacity="0.30" strokeWidth="1" /><line x1="0" y1="30" x2="440" y2="30" stroke="white" strokeOpacity="0.30" strokeWidth="1" /><line x1="0" y1="60" x2="440" y2="60" stroke="white" strokeOpacity="0.30" strokeWidth="1" /><line x1="0" y1="90" x2="440" y2="90" stroke="white" strokeOpacity="0.30" strokeWidth="1" /><rect x="20" y="8" width="200" height="18" rx="2" fill="white" fillOpacity="0.35" /><line x1="40" y1="8" x2="40" y2="16" stroke="white" strokeOpacity="0.70" strokeWidth="1" /><line x1="60" y1="8" x2="60" y2="16" stroke="white" strokeOpacity="0.70" strokeWidth="1" /><line x1="80" y1="8" x2="80" y2="16" stroke="white" strokeOpacity="0.70" strokeWidth="1" /><line x1="100" y1="8" x2="100" y2="16" stroke="white" strokeOpacity="0.70" strokeWidth="1" /><line x1="120" y1="8" x2="120" y2="20" stroke="white" strokeOpacity="0.80" strokeWidth="1.5" /><line x1="140" y1="8" x2="140" y2="16" stroke="white" strokeOpacity="0.70" strokeWidth="1" /><line x1="160" y1="8" x2="160" y2="16" stroke="white" strokeOpacity="0.70" strokeWidth="1" /><line x1="180" y1="8" x2="180" y2="16" stroke="white" strokeOpacity="0.70" strokeWidth="1" /><line x1="200" y1="8" x2="200" y2="16" stroke="white" strokeOpacity="0.70" strokeWidth="1" /><polygon points="60,100 200,100 60,42" fill="white" fillOpacity="0.28" stroke="white" strokeOpacity="0.60" strokeWidth="1.5" /><path d="M60,88 Q72,88 72,100" fill="none" stroke="white" strokeOpacity="0.70" strokeWidth="1.5" /><circle cx="290" cy="55" r="3" fill="white" fillOpacity="0.80" /><line x1="290" y1="55" x2="250" y2="100" stroke="white" strokeOpacity="0.65" strokeWidth="2" /><line x1="290" y1="55" x2="340" y2="100" stroke="white" strokeOpacity="0.65" strokeWidth="2" /><polygon points="340,100 336,110 344,110" fill="white" fillOpacity="0.60" /><path d="M248,97 A60,60 0 0,1 342,97" fill="none" stroke="white" strokeOpacity="0.50" strokeWidth="1.5" strokeDasharray="4 3" /><path d="M130,115 A70,70 0 0,1 340,115" fill="none" stroke="white" strokeOpacity="0.40" strokeWidth="8" /><path d="M350,110 Q395,20 440,110" fill="none" stroke="white" strokeOpacity="0.55" strokeWidth="2" /><line x1="355" y1="20" x2="355" y2="112" stroke="white" strokeOpacity="0.45" strokeWidth="1.5" /><polygon points="355,16 351,24 359,24" fill="white" fillOpacity="0.45" /><line x1="352" y1="108" x2="440" y2="108" stroke="white" strokeOpacity="0.45" strokeWidth="1.5" /><polygon points="444,108 436,104 436,112" fill="white" fillOpacity="0.45" /><circle cx="620" cy="60" r="28" fill="none" stroke="white" strokeOpacity="0.15" strokeWidth="1" /><line x1="550" y1="90" x2="750" y2="90" stroke="white" strokeOpacity="0.12" strokeWidth="1" /></svg>}
                  </>
                );
              })()}
              <div className="absolute inset-0 flex items-end px-5 pb-3">
                <span className="text-white font-semibold text-lg drop-shadow">{editName || classData?.name || "Class Name"}</span>
              </div>
            </div>

            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {language === "uz" ? "Sinfni sozlash" : language === "ru" ? "Настроить класс" : "Customize appearance"}
                </DialogTitle>
              </DialogHeader>

              {/* Name + Subject */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="editClassName" className="text-xs font-semibold">
                    {language === "uz" ? "Sinf nomi" : language === "ru" ? "Название" : "Class Name"}
                  </Label>
                  <Input
                    id="editClassName"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="e.g. Math 101"
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="editSubject" className="text-xs font-semibold">
                    {language === "uz" ? "Fan (ixtiyoriy)" : language === "ru" ? "Предмет (необязательно)" : "Subject (optional)"}
                  </Label>
                  <Input
                    id="editSubject"
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                    placeholder="e.g. Algebra"
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              {/* Banner section */}
              <div className="space-y-3">
                <div className="flex items-center gap-1 border-b pb-2">
                  <button
                    type="button"
                    onClick={() => setBannerTab("preset")}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${bannerTab === "preset" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                  >
                    {language === "uz" ? "Tayyor ranglar" : language === "ru" ? "Готовые темы" : "Preset themes"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBannerTab("upload")}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${bannerTab === "upload" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                  >
                    {language === "uz" ? "Rasm yuklash" : language === "ru" ? "Загрузить фото" : "Upload photo"}
                  </button>
                </div>

                {bannerTab === "preset" && (
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2">
                        {language === "uz" ? "Rang" : language === "ru" ? "Цвет" : "Select theme color"}
                      </p>
                      <div className="grid grid-cols-4 gap-3">
                        {CLASS_BANNERS.map((banner) => {
                          const currentBannerId = editBannerStyle.split("-")[0];
                          const isSelected = currentBannerId === banner.id;
                          return (
                            <button
                              key={banner.id}
                              type="button"
                              title={banner.name}
                              className={`relative h-12 rounded-xl transition-all shrink-0 ${isSelected ? "ring-3 ring-offset-2 ring-foreground scale-105 shadow-md" : "hover:scale-105 hover:shadow-sm"}`}
                              style={{ background: banner.gradient }}
                              onClick={() => {
                                const currentShape = editBannerStyle.split("-")[1] || "1";
                                setEditBannerStyle(`${banner.id}-${currentShape}`);
                                setBannerTab("preset");
                              }}
                            >
                              {isSelected && (
                                <span className="absolute inset-0 flex items-center justify-center text-white text-lg font-bold drop-shadow">✓</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2">
                        {language === "uz" ? "Shakl" : language === "ru" ? "Узор" : "Pattern"}
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        {BANNER_SHAPES.map((shapeId) => {
                          const currentShapeId = parseInt(editBannerStyle.split("-")[1]) || 1;
                          const isSelected = currentShapeId === shapeId;
                          const shapeLabels = ["Flags", "Circles", "Lines", "Hexagons", "Waves", "Math"];
                          return (
                            <button
                              key={shapeId}
                              type="button"
                              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${isSelected ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                              onClick={() => {
                                const currentBanner = editBannerStyle.split("-")[0] || "1";
                                setEditBannerStyle(`${currentBanner}-${shapeId}`);
                                setBannerTab("preset");
                              }}
                            >
                              {shapeLabels[shapeId - 1]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {bannerTab === "upload" && (
                  <div className="space-y-3">
                    {loadingCrop ? (
                      <div className="flex flex-col items-center justify-center gap-3 py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-xs text-muted-foreground">
                          {language === "uz" ? "Rasm o'qilmoqda..." : language === "ru" ? "Загрузка файла..." : "Loading image..."}
                        </p>
                      </div>
                    ) : uploadingBanner ? (
                      <div className="flex flex-col items-center justify-center gap-4 py-6 px-4">
                        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                          <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                        <div className="w-full space-y-2">
                          <div className="flex items-center justify-between text-xs font-semibold">
                            <span className="text-foreground">
                              {language === "uz" ? "Yuklanmoqda..." : language === "ru" ? "Загрузка..." : "Uploading..."}
                            </span>
                            <span className="text-primary font-bold">{uploadProgress}%</span>
                          </div>
                          <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                              style={{ width: `${uploadProgress}%` }}
                            />
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {language === "uz" ? "Iltimos kuting..." : language === "ru" ? "Пожалуйста подождите..." : "Please wait, uploading your photo..."}
                        </p>
                      </div>
                    ) : editClassAvatar ? (
                      <div className="space-y-2">
                        <div className="relative rounded-xl overflow-hidden bg-muted" style={{ height: "120px" }}>
                          <img src={editClassAvatar} alt="Current banner" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                          <button
                            type="button"
                            onClick={handleRemoveBannerImage}
                            className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full w-7 h-7 flex items-center justify-center text-sm transition-colors"
                            title="Remove image"
                          >
                            ✕
                          </button>
                          <span className="absolute bottom-2 left-3 text-white text-xs font-semibold drop-shadow">
                            {language === "uz" ? "Joriy rasm" : language === "ru" ? "Текущее фото" : "Current photo"}
                          </span>
                        </div>
                        <label
                          htmlFor="bannerFileInput"
                          className="w-full py-2 text-xs font-semibold text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors cursor-pointer flex items-center justify-center gap-2"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          {language === "uz" ? "Boshqa rasm tanlash" : language === "ru" ? "Выбрать другое фото" : "Choose different photo"}
                        </label>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-4 py-8 px-4 rounded-xl border-2 border-dashed border-border bg-muted/30 hover:border-primary/40 hover:bg-primary/5 transition-colors">
                        <svg width="80" height="56" viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-40">
                          <ellipse cx="60" cy="52" rx="50" ry="22" fill="currentColor" className="text-muted-foreground" />
                          <ellipse cx="40" cy="42" rx="28" ry="18" fill="currentColor" className="text-muted-foreground" />
                          <ellipse cx="82" cy="36" rx="24" ry="17" fill="currentColor" className="text-muted-foreground" />
                          <ellipse cx="34" cy="57" rx="18" ry="11" fill="currentColor" className="text-muted-foreground" />
                        </svg>
                        <label
                          htmlFor="bannerFileInput"
                          className="px-6 py-2 bg-primary text-primary-foreground rounded-full text-sm font-semibold cursor-pointer hover:opacity-90 transition-opacity flex items-center gap-2"
                        >
                          <Upload className="h-4 w-4" />
                          {language === "uz" ? "Fayl tanlash" : language === "ru" ? "Выбрать файл" : "Browse"}
                        </label>
                        <p className="text-xs text-muted-foreground">
                          {language === "uz" ? "yoki bu yerga rasm tashlang" : language === "ru" ? "или перетащите фото сюда" : "or drag a photo here"}
                        </p>
                        <p className="text-xs text-muted-foreground/60">PNG, JPG, WebP — max 5MB</p>
                      </div>
                    )}
                    <input
                      id="bannerFileInput"
                      ref={bannerFileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileSelected(file);
                        e.target.value = "";
                      }}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t bg-background">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {t("cancel")}
              </Button>
              <Button onClick={handleSaveEdit} disabled={saving || uploadingBanner}>
                {saving ? t("loading") : t("save")}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
