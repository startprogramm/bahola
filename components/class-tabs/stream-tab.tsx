"use client";

import Link from "next/link";
import {
  Copy,
  Clock,
  Maximize2,
  PencilLine,
} from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { useLanguage } from "@/lib/i18n/language-context";
import { ClassStream } from "@/components/class-stream";
import { getBannerStyle, getBannerShapeId } from "@/lib/class-banners";
import { normalizeImageUrl } from "@/lib/utils";
import type { ClassDetail, Assessment } from "./types";

const isMaktab = process.env.NEXT_PUBLIC_APP_MODE === "maktab";

const BANNER_COLORS = [
  "#1967d2",
  "#137333",
  "#a142f4",
  "#e37400",
  "#1a73e8",
  "#c5221f",
];

interface StreamTabProps {
  classId: string;
  classData: ClassDetail;
  hasTeacherAccess: boolean;
  canManageClass: boolean;
  onEditDialogOpen: () => void;
  onCopyClassCode: () => void;
  onClassCodePopupOpen: () => void;
}

export function StreamTab({
  classId,
  classData,
  hasTeacherAccess,
  canManageClass,
  onEditDialogOpen,
  onCopyClassCode,
  onClassCodePopupOpen,
}: StreamTabProps) {
  const { t, language } = useLanguage();

  const hasCustomAvatar = !!classData.classAvatar;

  const getBannerBackground = () => {
    if (classData.bannerStyle) {
      return getBannerStyle(classData.bannerStyle);
    }
    if (classData.headerColor) return classData.headerColor;
    const hash = classData.id.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return BANNER_COLORS[hash % BANNER_COLORS.length];
  };

  const bannerBackground = getBannerBackground();
  const bannerShapeId = classData.bannerStyle ? getBannerShapeId(classData.bannerStyle) : 1;

  const upcomingAssessments = classData.assessments
    .filter((a: Assessment) => a.dueDate && new Date(a.dueDate) > new Date())
    .sort((a: Assessment, b: Assessment) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())
    .slice(0, 3);

  return (
    <div className="mx-auto w-full max-w-5xl">
      {/* Google Classroom Style Banner */}
      <div
        className="relative overflow-hidden rounded-xl mb-6"
        style={hasCustomAvatar ? {} : { background: bannerBackground }}
      >
        {/* Custom uploaded banner image */}
        {hasCustomAvatar && (
          <img
            src={normalizeImageUrl(classData.classAvatar!)}
            alt="Class banner"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        {/* Gradient overlay for readability when using custom image */}
        {hasCustomAvatar && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        )}
        <div className="absolute inset-0 overflow-hidden">
          {!hasCustomAvatar && bannerShapeId === 1 && (
            <>
              <svg className="absolute right-8 top-4 opacity-20" width="120" height="100" viewBox="0 0 120 100">
                <polygon points="0,0 60,25 0,50" fill="white" />
                <polygon points="30,30 90,55 30,80" fill="white" />
                <polygon points="60,10 120,35 60,60" fill="white" />
              </svg>
              <div className="absolute -right-10 -bottom-10 w-40 h-40 rounded-full bg-white/10" />
            </>
          )}
          {!hasCustomAvatar && bannerShapeId === 2 && (
            <>
              <div className="absolute -right-20 -top-20 w-60 h-60 rounded-full bg-white/10" />
              <div className="absolute right-40 top-10 w-20 h-20 rounded-full bg-white/15" />
              <div className="absolute right-10 bottom-0 w-32 h-32 rounded-full bg-white/10" />
            </>
          )}
          {!hasCustomAvatar && bannerShapeId === 3 && (
            <>
              <svg className="absolute inset-0 w-full h-full opacity-10" preserveAspectRatio="none">
                <pattern id="diagonalLines" patternUnits="userSpaceOnUse" width="40" height="40">
                  <path d="M-10,10 l20,-20 M0,40 l40,-40 M30,50 l20,-20" stroke="white" strokeWidth="2" fill="none" />
                </pattern>
                <rect width="100%" height="100%" fill="url(#diagonalLines)" />
              </svg>
            </>
          )}
          {!hasCustomAvatar && bannerShapeId === 4 && (
            <>
              <svg className="absolute right-0 top-0 opacity-15" width="200" height="150" viewBox="0 0 200 150">
                <polygon points="100,10 140,35 140,85 100,110 60,85 60,35" fill="white" />
                <polygon points="160,40 200,65 200,115 160,140 120,115 120,65" fill="white" fillOpacity="0.5" />
              </svg>
              <div className="absolute -left-10 bottom-0 w-24 h-24 rotate-45 bg-white/10" />
            </>
          )}
          {!hasCustomAvatar && bannerShapeId === 5 && (
            <>
              <svg className="absolute bottom-0 left-0 right-0 opacity-20" height="60" preserveAspectRatio="none" viewBox="0 0 1200 60">
                <path d="M0,30 Q150,0 300,30 T600,30 T900,30 T1200,30 V60 H0 Z" fill="white" />
              </svg>
              <div className="absolute right-10 top-5 w-16 h-16 rounded-full bg-white/10" />
              <div className="absolute right-32 top-12 w-8 h-8 rounded-full bg-white/15" />
            </>
          )}
          {!hasCustomAvatar && bannerShapeId === 6 && (
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 800 120" preserveAspectRatio="xMinYMid slice" xmlns="http://www.w3.org/2000/svg">
              {/* LEFT ZONE: Math / Geometry */}

              {/* Coordinate grid */}
              <line x1="30" y1="0" x2="30" y2="120" stroke="white" strokeOpacity="0.30" strokeWidth="1" />
              <line x1="80" y1="0" x2="80" y2="120" stroke="white" strokeOpacity="0.30" strokeWidth="1" />
              <line x1="130" y1="0" x2="130" y2="120" stroke="white" strokeOpacity="0.30" strokeWidth="1" />
              <line x1="180" y1="0" x2="180" y2="120" stroke="white" strokeOpacity="0.30" strokeWidth="1" />
              <line x1="230" y1="0" x2="230" y2="120" stroke="white" strokeOpacity="0.30" strokeWidth="1" />
              <line x1="280" y1="0" x2="280" y2="120" stroke="white" strokeOpacity="0.30" strokeWidth="1" />
              <line x1="330" y1="0" x2="330" y2="120" stroke="white" strokeOpacity="0.30" strokeWidth="1" />
              <line x1="380" y1="0" x2="380" y2="120" stroke="white" strokeOpacity="0.30" strokeWidth="1" />
              <line x1="430" y1="0" x2="430" y2="120" stroke="white" strokeOpacity="0.30" strokeWidth="1" />
              <line x1="0" y1="30" x2="440" y2="30" stroke="white" strokeOpacity="0.30" strokeWidth="1" />
              <line x1="0" y1="60" x2="440" y2="60" stroke="white" strokeOpacity="0.30" strokeWidth="1" />
              <line x1="0" y1="90" x2="440" y2="90" stroke="white" strokeOpacity="0.30" strokeWidth="1" />

              {/* Ruler */}
              <rect x="20" y="8" width="200" height="18" rx="2" fill="white" fillOpacity="0.35" />
              <line x1="40" y1="8" x2="40" y2="16" stroke="white" strokeOpacity="0.70" strokeWidth="1" />
              <line x1="60" y1="8" x2="60" y2="16" stroke="white" strokeOpacity="0.70" strokeWidth="1" />
              <line x1="80" y1="8" x2="80" y2="16" stroke="white" strokeOpacity="0.70" strokeWidth="1" />
              <line x1="100" y1="8" x2="100" y2="16" stroke="white" strokeOpacity="0.70" strokeWidth="1" />
              <line x1="120" y1="8" x2="120" y2="20" stroke="white" strokeOpacity="0.80" strokeWidth="1.5" />
              <line x1="140" y1="8" x2="140" y2="16" stroke="white" strokeOpacity="0.70" strokeWidth="1" />
              <line x1="160" y1="8" x2="160" y2="16" stroke="white" strokeOpacity="0.70" strokeWidth="1" />
              <line x1="180" y1="8" x2="180" y2="16" stroke="white" strokeOpacity="0.70" strokeWidth="1" />
              <line x1="200" y1="8" x2="200" y2="16" stroke="white" strokeOpacity="0.70" strokeWidth="1" />

              {/* Triangle with angle arc */}
              <polygon points="60,100 200,100 60,42" fill="white" fillOpacity="0.28" stroke="white" strokeOpacity="0.60" strokeWidth="1.5" />
              <path d="M60,88 Q72,88 72,100" fill="none" stroke="white" strokeOpacity="0.70" strokeWidth="1.5" />

              {/* Compass */}
              <circle cx="290" cy="55" r="3" fill="white" fillOpacity="0.80" />
              <line x1="290" y1="55" x2="250" y2="100" stroke="white" strokeOpacity="0.65" strokeWidth="2" />
              <rect x="246" y="98" width="6" height="10" rx="1" fill="white" fillOpacity="0.60" transform="rotate(-40 249 103)" />
              <line x1="290" y1="55" x2="340" y2="100" stroke="white" strokeOpacity="0.65" strokeWidth="2" />
              <polygon points="340,100 336,110 344,110" fill="white" fillOpacity="0.60" />
              <path d="M248,97 A60,60 0 0,1 342,97" fill="none" stroke="white" strokeOpacity="0.50" strokeWidth="1.5" strokeDasharray="4 3" />

              {/* Protractor arc */}
              <path d="M130,115 A70,70 0 0,1 340,115" fill="none" stroke="white" strokeOpacity="0.40" strokeWidth="8" />

              {/* Parabola on grid with axis arrows */}
              <path d="M350,110 Q395,20 440,110" fill="none" stroke="white" strokeOpacity="0.55" strokeWidth="2" />
              <line x1="355" y1="20" x2="355" y2="112" stroke="white" strokeOpacity="0.45" strokeWidth="1.5" />
              <polygon points="355,16 351,24 359,24" fill="white" fillOpacity="0.45" />
              <line x1="352" y1="108" x2="440" y2="108" stroke="white" strokeOpacity="0.45" strokeWidth="1.5" />
              <polygon points="444,108 436,104 436,112" fill="white" fillOpacity="0.45" />

              {/* RIGHT ZONE: 2 faint ghost elements */}
              <circle cx="620" cy="60" r="28" fill="none" stroke="white" strokeOpacity="0.15" strokeWidth="1" />
              <line x1="550" y1="90" x2="750" y2="90" stroke="white" strokeOpacity="0.12" strokeWidth="1" />
            </svg>
          )}
        </div>
        {/* Edit button - absolute to banner edge */}
        {canManageClass && (
          <button
            onClick={onEditDialogOpen}
            className="absolute top-3 right-4 z-10 flex items-center gap-2 rounded-lg border border-border/60 bg-background/90 px-3 py-2 text-sm font-medium text-foreground shadow-sm backdrop-blur transition-all duration-150 hover:bg-background hover:shadow-md hover:scale-105"
          >
            <PencilLine className="h-4 w-4" />
            {language === "uz" ? "Tahrirlash" : language === "ru" ? "Редактировать" : "Customize"}
          </button>
        )}
        <div className="relative px-5 py-14 md:py-20">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl md:text-4xl font-bold text-white drop-shadow">
              {classData.name}
            </h1>
            {classData.subject && (
              <p className="text-white/80 text-sm md:text-lg">
                {classData.subject}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-center gap-6 lg:justify-start">
        {/* Left Sidebar - Class Code + Upcoming */}
        <div className="hidden lg:block w-56 shrink-0 space-y-4">
          {/* Class Code Card */}
          {hasTeacherAccess && !isMaktab && (
            <Card className="sticky top-24" data-guide="class-code-section">
              <CardContent className="pt-4">
                <h3 className="font-medium text-sm mb-3">{t("classCode")}</h3>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-2xl font-bold tracking-wide text-primary">{classData.code}</span>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={onClassCodePopupOpen}
                      className="p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title={language === "uz" ? "Kattalashtirish" : language === "ru" ? "Увеличить" : "Show fullscreen"}
                    >
                      <Maximize2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={onCopyClassCode}
                      className="p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      title={language === "uz" ? "Nusxalash" : language === "ru" ? "Скопировать" : "Copy"}
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Upcoming Widget */}
          <Card className={hasTeacherAccess ? "" : "sticky top-24"}>
            <CardContent className="pt-4">
              <h3 className="font-medium text-sm mb-3">{t("upcoming") || "Upcoming"}</h3>
              {upcomingAssessments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {language === "uz"
                    ? "Hozircha kutilayotgan ish yo'q"
                    : language === "ru"
                      ? "Нет предстоящих заданий"
                      : "No work due soon"}
                </p>
              ) : (
                <div className="space-y-3">
                  {upcomingAssessments.map((assessment) => (
                    <Link
                      key={assessment.id}
                      href={`/assessments/${assessment.id}`}
                      className="block group"
                    >
                      <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                        {assessment.title}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Clock className="h-3 w-3" />
                        {new Date(assessment.dueDate!).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                    </Link>
                  ))}
                  <Link
                    href="/todo"
                    className="text-xs text-primary hover:underline block mt-2"
                  >
                    {t("viewAll") || "View all"}
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Stream Content - Main */}
        <div className="w-full max-w-3xl flex-1 min-w-0">
          <ClassStream classId={classId} isTeacher={hasTeacherAccess} />
        </div>
      </div>
    </div>
  );
}
