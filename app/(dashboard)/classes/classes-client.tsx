"use client";

import { useEffect, useState, useCallback } from "react";
import { cachedFetch, invalidateCachePrefix, notifyClassesChanged } from "@/lib/fetch-cache";
import Link from "next/link";
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Archive,
  BookOpen,
  ClipboardList,
  Copy,
  Eye,
  EyeOff,
  Flag,
  Folder,
  LogOut,
  MoreVertical,
  Pencil,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n/language-context";
import { useTheme } from "@/lib/theme-provider";
import { TranslationKey } from "@/lib/i18n/translations";
import { EidBanner } from "@/components/eid-banner";
import { getInitials, getUserAvatarColor } from "@/lib/utils";
import { getBannerStyle } from "@/lib/class-banners";
const isMaktab = process.env.NEXT_PUBLIC_APP_MODE === "maktab";

const DEFAULT_COLORS = [
  "#1967d2",
  "#137333",
  "#a142f4",
  "#e37400",
  "#1a73e8",
  "#c5221f",
];

const HIDDEN_CLASSES_STORAGE_KEY = "hiddenClassIds";
const CLASS_ORDER_STORAGE_KEY = "classCardOrder";
const HIDE_CONFIRM_STORAGE_KEY = "skipHideClassConfirm";

interface ClassData {
  id: string;
  name: string;
  code: string;
  subject: string | null;
  headerColor?: string;
  bannerStyle?: string | null;
  classAvatar?: string | null;
  createdAt: string;
  _count?: {
    enrollments?: number;
    assessments?: number;
  };
}

interface EnrolledClass {
  id: string;
  role: "STUDENT" | "TEACHER";
  class: ClassData & {
    teacher: {
      name: string;
      avatar?: string;
    };
  };
}

interface ClassCardItem extends ClassData {
  isOwner: boolean;
  canManage: boolean;
  teacherName?: string;
  teacherAvatar?: string;
}

type ReportReason = "spam" | "personal_info" | "harmful_content" | "illegal_content";

const REPORT_REASON_META: Record<ReportReason, { label: string; section: "policy" | "legal" }> = {
  spam: { label: "Spam", section: "policy" },
  personal_info: { label: "Personal and confidential information", section: "policy" },
  harmful_content: { label: "Other harmful content", section: "policy" },
  illegal_content: { label: "Illegal content", section: "legal" },
};

const CLASSES_GRID_STYLE: React.CSSProperties = {
  gridTemplateColumns: "repeat(auto-fill, minmax(286px, 286px))",
  columnGap: 8,
  rowGap: 20,
  justifyContent: "start",
};

const CLASSES_GRID_STYLE_MOBILE: React.CSSProperties = {
  gridTemplateColumns: "1fr",
  rowGap: 12,
};

interface ClassesClientProps {
  initialMyClasses: ClassData[];
  initialEnrolledClasses: EnrolledClass[];
}

export default function ClassesClient({ initialMyClasses, initialEnrolledClasses }: ClassesClientProps) {
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === "dark";
  const [myClasses, setMyClasses] = useState<ClassData[]>(initialMyClasses);
  const [enrolledClasses, setEnrolledClasses] = useState<EnrolledClass[]>(initialEnrolledClasses);
  const [loading, setLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [hiddenClassIds, setHiddenClassIds] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [classOrder, setClassOrder] = useState<string[]>([]);
  const [skipHideConfirm, setSkipHideConfirm] = useState(false);
  const [pendingHideClass, setPendingHideClass] = useState<ClassCardItem | null>(null);
  const [hideDialogOpen, setHideDialogOpen] = useState(false);
  const [dontShowHideAgain, setDontShowHideAgain] = useState(false);
  const [pendingReportClass, setPendingReportClass] = useState<ClassCardItem | null>(null);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>("spam");
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Refresh classes on mount (picks up changes made while this page was unmounted)
  // and listen for class mutations from other pages (e.g., class creation) to refresh list.
  // cachedFetch returns instantly from cache if data is still fresh, so this is cheap.
  useEffect(() => {
    refreshClasses();
    const handler = () => refreshClasses(true);
    window.addEventListener("classes-changed", handler);
    return () => window.removeEventListener("classes-changed", handler);
  }, []);

  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 8 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 500, tolerance: 5 } });
  const sensors = useSensors(mouseSensor, touchSensor);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const hiddenRaw = localStorage.getItem(HIDDEN_CLASSES_STORAGE_KEY);
    if (hiddenRaw) {
      try {
        setHiddenClassIds(JSON.parse(hiddenRaw));
      } catch {
        setHiddenClassIds([]);
      }
    }

    const orderRaw = localStorage.getItem(CLASS_ORDER_STORAGE_KEY);
    if (orderRaw) {
      try {
        setClassOrder(JSON.parse(orderRaw));
      } catch {
        setClassOrder([]);
      }
    }

    setSkipHideConfirm(localStorage.getItem(HIDE_CONFIRM_STORAGE_KEY) === "1");
  }, []);

  const refreshClasses = async (forceRefresh = false) => {
    try {
      if (forceRefresh) {
        invalidateCachePrefix("/api/classes");
        invalidateCachePrefix("/api/student/classes");
      }
      const [myClassesData, enrolledData] = await Promise.all([
        cachedFetch("/api/classes", 60_000).then(d => d?.classes || []),
        cachedFetch("/api/student/classes", 60_000).then(d => d?.enrollments || []),
      ]);

      setMyClasses(myClassesData);
      setEnrolledClasses(enrolledData);
    } catch (error) {
      console.error("Error fetching classes:", error);
    } finally {
      setLoading(false);
    }
  };

  const archiveClass = async (classId: string) => {
    if (!confirm(t("archiveClassConfirm"))) return;

    try {
      const res = await fetch(`/api/classes/${classId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });

      if (res.ok) {
        toast({ title: t("classArchived") });
        setMyClasses((prev) => prev.filter((c) => c.id !== classId));
        sessionStorage.removeItem("classes-cache");
        notifyClassesChanged();
      }
    } catch {
      toast({ title: t("somethingWentWrong"), variant: "destructive" });
    }
  };

  const deleteClass = async (classId: string) => {
    const confirmMsg =
      language === "uz"
        ? "Sinfni butunlay o'chirib tashlamoqchimisiz? Bu amalni ortga qaytarib bo'lmaydi!"
        : language === "ru"
          ? "Вы уверены, что хотите полностью удалить этот класс? Это действие необратимо!"
          : "Are you sure you want to permanently delete this class? This action cannot be undone!";

    if (!confirm(confirmMsg)) return;

    try {
      const res = await fetch(`/api/classes/${classId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        toast({
          title:
            language === "uz"
              ? "Sinf o'chirildi"
              : language === "ru"
                ? "Класс удален"
                : "Class deleted",
        });
        setMyClasses((prev) => prev.filter((c) => c.id !== classId));
        sessionStorage.removeItem("classes-cache");
        notifyClassesChanged();
      } else {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to delete");
      }
    } catch (error) {
      toast({
        title: t("somethingWentWrong"),
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  const leaveClass = async (classId: string) => {
    const confirmMsg =
      language === "uz"
        ? "Sinfni tark etmoqchimisiz?"
        : language === "ru"
          ? "Покинуть класс?"
          : "Unenroll from this class?";

    if (!confirm(confirmMsg)) return;

    try {
      const res = await fetch(`/api/classes/${classId}/leave`, {
        method: "POST",
      });

      if (res.ok) {
        toast({
          title:
            language === "uz"
              ? "Sinf tark etildi"
              : language === "ru"
                ? "Вы покинули класс"
                : "You are now unenrolled",
        });
        setEnrolledClasses((prev) => prev.filter((e) => e.class.id !== classId));
        setHiddenClassIds((prev) => {
          const next = prev.filter((id) => id !== classId);
          localStorage.setItem(HIDDEN_CLASSES_STORAGE_KEY, JSON.stringify(next));
          return next;
        });
        sessionStorage.removeItem("classes-cache");
        notifyClassesChanged();
      }
    } catch {
      toast({ title: t("somethingWentWrong"), variant: "destructive" });
    }
  };

  const copyInviteLink = (classCode: string) => {
    navigator.clipboard.writeText(classCode);
    toast({
      title:
        language === "uz"
          ? "Sinf kodi nusxalandi"
          : language === "ru"
            ? "Код класса скопирован"
            : "Class code copied",
      description: classCode,
    });
  };

  const hideClass = (classId: string) => {
    setHiddenClassIds((prev) => {
      if (prev.includes(classId)) return prev;
      const next = [...prev, classId];
      localStorage.setItem(HIDDEN_CLASSES_STORAGE_KEY, JSON.stringify(next));
      return next;
    });

    toast({
      title:
        language === "uz" ? "Sinf yashirildi" : language === "ru" ? "Класс скрыт" : "Class hidden",
    });
  };

  const unhideClass = (classId: string) => {
    setHiddenClassIds((prev) => {
      const next = prev.filter((id) => id !== classId);
      localStorage.setItem(HIDDEN_CLASSES_STORAGE_KEY, JSON.stringify(next));
      return next;
    });

    toast({
      title:
        language === "uz"
          ? "Sinf ko'rsatildi"
          : language === "ru"
            ? "Класс показан"
            : "Class unhidden",
    });
  };

  const requestHideClass = (classItem: ClassCardItem) => {
    if (skipHideConfirm) {
      hideClass(classItem.id);
      return;
    }

    setPendingHideClass(classItem);
    setDontShowHideAgain(false);
    setHideDialogOpen(true);
  };

  const confirmHideClass = () => {
    if (!pendingHideClass) return;

    hideClass(pendingHideClass.id);
    setHideDialogOpen(false);
    setPendingHideClass(null);

    if (dontShowHideAgain) {
      localStorage.setItem(HIDE_CONFIRM_STORAGE_KEY, "1");
      setSkipHideConfirm(true);
    }
  };

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setClassOrder((prevOrder) => {
      // Reconstruct all class IDs from current state
      const allIds = [
        ...myClasses.map((c) => c.id),
        ...enrolledClasses.map((e) => e.class.id),
      ];
      const orderMap2 = new Map(prevOrder.map((id, index) => [id, index]));
      const sorted = [...allIds].sort((a, b) => {
        const aO = orderMap2.get(a);
        const bO = orderMap2.get(b);
        if (aO !== undefined && bO !== undefined) return aO - bO;
        if (aO !== undefined) return -1;
        if (bO !== undefined) return 1;
        return 0;
      });
      const visible = sorted.filter((id) => {
        const isOwner = myClasses.some((c) => c.id === id);
        return isOwner || !hiddenClassIds.includes(id);
      });
      const oldIndex = visible.indexOf(active.id as string);
      const newIndex = visible.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return prevOrder;
      const newVisible = arrayMove(visible, oldIndex, newIndex);
      localStorage.setItem(CLASS_ORDER_STORAGE_KEY, JSON.stringify(newVisible));
      return newVisible;
    });
  }, [myClasses, enrolledClasses, hiddenClassIds]);

  const openClassroomPage = (classId: string) => {
    window.location.href = `/classes/${classId}`;
  };

  const openDriveFolder = (classItem: ClassCardItem, schoolYear: string) => {
    const query = encodeURIComponent(`${classItem.name} ${schoolYear}`);
    window.open(`https://drive.google.com/drive/search?q=${query}`, "_blank", "noopener,noreferrer");
  };

  const openReportDialog = (classItem: ClassCardItem) => {
    setPendingReportClass(classItem);
    setReportReason("spam");
    setReportDialogOpen(true);
  };

  const submitReportAbuse = () => {
    if (!pendingReportClass) return;

    window.open("https://support.google.com/legal/troubleshooter/1114905", "_blank", "noopener,noreferrer");

    toast({
      title: "Report abuse form opened",
      description: `${pendingReportClass.name} - ${REPORT_REASON_META[reportReason].label}`,
    });

    setReportDialogOpen(false);
    setPendingReportClass(null);
  };

  const getClassColor = (classItem: ClassData, index: number) => {
    if (classItem.bannerStyle) {
      return getBannerStyle(classItem.bannerStyle);
    }
    return classItem.headerColor || DEFAULT_COLORS[index % DEFAULT_COLORS.length];
  };

  const getYear = (dateString: string) => new Date(dateString).getFullYear();
  const getSchoolYear = (dateString: string) => {
    const year = getYear(dateString);
    return `${year}-${year + 1}`;
  };

  if (loading) {
    return <DashboardSkeleton />;
  }

  const hasMyClasses = myClasses.length > 0;
  const hasEnrolledClasses = enrolledClasses.length > 0;
  const hasNoClasses = !hasMyClasses && !hasEnrolledClasses;

  const allClassesRaw: ClassCardItem[] = [
    ...myClasses.map((c) => ({
      ...c,
      isOwner: true,
      canManage: true,
      teacherName: undefined,
      teacherAvatar: undefined,
    })),
    ...enrolledClasses.map((e) => ({
      ...e.class,
      isOwner: e.role === "TEACHER",
      canManage: e.role === "TEACHER",
      teacherName: e.role === "TEACHER" ? undefined : e.class.teacher?.name,
      teacherAvatar: e.role === "TEACHER" ? undefined : e.class.teacher?.avatar,
    })),
  ];

  const orderMap = new Map(classOrder.map((id, index) => [id, index]));
  const orderedClasses = [...allClassesRaw].sort((a, b) => {
    const aOrder = orderMap.get(a.id);
    const bOrder = orderMap.get(b.id);

    if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder;
    if (aOrder !== undefined) return -1;
    if (bOrder !== undefined) return 1;

    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const visibleClasses = orderedClasses.filter(
    (classItem) => classItem.canManage || !hiddenClassIds.includes(classItem.id)
  );
  const hiddenClasses = orderedClasses.filter(
    (classItem) => !classItem.canManage && hiddenClassIds.includes(classItem.id)
  );

  // Used by handleDragEnd closure
  const visibleClassesForDnd = visibleClasses;

  return (
    <div className="space-y-6">
      <EidBanner variant="dashboard" />
      {hasNoClasses ? (
        <EmptyState
          icon={BookOpen}
          title={language === "uz" ? "Sinflar yo'q" : language === "ru" ? "Нет классов" : "No classes yet"}
          description={
            language === "uz"
              ? "Sinf yarating yoki mavjud sinfga qo'shiling"
              : language === "ru"
                ? "Создайте класс или присоединитесь к существующему"
                : "Create a class or join an existing one"
          }
        />
      ) : (
        <>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={visibleClassesForDnd.map((c) => c.id)} strategy={rectSortingStrategy}>
              <div className="grid" style={isMobile ? CLASSES_GRID_STYLE_MOBILE : CLASSES_GRID_STYLE}>
                {visibleClassesForDnd.map((classItem, idx) => (
                  <SortableClassCard
                    key={classItem.id}
                    classItem={classItem}
                    color={getClassColor(classItem, idx)}
                    schoolYear={getSchoolYear(classItem.createdAt)}
                    isDarkTheme={isDarkTheme}
                    isOwner={classItem.isOwner}
                    canManage={classItem.canManage}
                    isHidden={hiddenClassIds.includes(classItem.id)}
                    isDragging={activeId === classItem.id}
                    compact={isMobile}
                    teacherName={classItem.teacherName}
                    teacherAvatar={classItem.teacherAvatar}
                    onPrimaryAction={openClassroomPage}
                    onOpenDrive={openDriveFolder}
                    onArchive={classItem.canManage ? archiveClass : undefined}
                    onDelete={classItem.isOwner && !isMaktab ? deleteClass : undefined}
                    onLeave={!classItem.isOwner && !isMaktab ? leaveClass : undefined}
                    onCopyInvite={classItem.isOwner && !isMaktab ? copyInviteLink : undefined}
                    onHide={!classItem.canManage ? requestHideClass : undefined}
                    onUnhide={!classItem.canManage ? unhideClass : undefined}
                    onReportAbuse={!classItem.canManage ? openReportDialog : undefined}
                    language={language}
                    t={t}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeId ? (() => {
                const itemIdx = visibleClassesForDnd.findIndex((c) => c.id === activeId);
                const item = itemIdx >= 0 ? visibleClassesForDnd[itemIdx] : null;
                if (!item) return null;
                return (
                  <div style={{ transform: "scale(1.04)", boxShadow: "0 8px 40px rgba(0,0,0,0.22)", borderRadius: 20, opacity: 0.95 }}>
                    <ClassCard
                      classItem={item}
                      color={getClassColor(item, itemIdx)}
                      schoolYear={getSchoolYear(item.createdAt)}
                      isDarkTheme={isDarkTheme}
                      isOwner={item.isOwner}
                      canManage={item.canManage}
                      isHidden={hiddenClassIds.includes(item.id)}
                      isDragging={false}
                      compact={isMobile}
                      teacherName={item.teacherName}
                      teacherAvatar={item.teacherAvatar}
                      onPrimaryAction={openClassroomPage}
                      onOpenDrive={openDriveFolder}
                      language={language}
                      t={t}
                    />
                  </div>
                );
              })() : null}
            </DragOverlay>
          </DndContext>

          {hiddenClasses.length > 0 && (
            <div className="space-y-6 pt-2">
              <div className="flex justify-start sm:justify-center">
                <button
                  type="button"
                  onClick={() => setShowHidden((prev) => !prev)}
                  className="rounded-full border border-transparent bg-blue-100 px-6 py-3 text-base font-medium text-blue-700 transition-colors hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:hover:bg-blue-900/60"
                >
                  {showHidden
                    ? `Don't show hidden classes (${hiddenClasses.length})`
                    : `Show hidden classes (${hiddenClasses.length})`}
                </button>
              </div>

              {showHidden && (
                <div className="space-y-3">
                  <p className="px-1 text-sm text-muted-foreground">Hidden classes</p>
                  <div className="grid" style={isMobile ? CLASSES_GRID_STYLE_MOBILE : CLASSES_GRID_STYLE}>
                    {hiddenClasses.map((classItem, idx) => (
                      <ClassCard
                        key={classItem.id}
                        classItem={classItem}
                        color={getClassColor(classItem, visibleClassesForDnd.length + idx)}
                        schoolYear={getSchoolYear(classItem.createdAt)}
                        isDarkTheme={isDarkTheme}
                        isOwner={classItem.isOwner}
                        canManage={classItem.canManage}
                        isHidden
                        compact={isMobile}
                        teacherName={classItem.teacherName}
                        teacherAvatar={classItem.teacherAvatar}
                        onPrimaryAction={openClassroomPage}
                        onOpenDrive={openDriveFolder}
                        onArchive={classItem.canManage ? archiveClass : undefined}
                        onDelete={classItem.isOwner && !isMaktab ? deleteClass : undefined}
                        onLeave={!classItem.isOwner && !isMaktab ? leaveClass : undefined}
                        onCopyInvite={classItem.isOwner && !isMaktab ? copyInviteLink : undefined}
                        onHide={!classItem.canManage ? requestHideClass : undefined}
                        onUnhide={!classItem.canManage ? unhideClass : undefined}
                        onReportAbuse={!classItem.canManage ? openReportDialog : undefined}
                        language={language}
                        t={t}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <Dialog
        open={hideDialogOpen}
        onOpenChange={(open) => {
          setHideDialogOpen(open);
          if (!open) setPendingHideClass(null);
        }}
      >
        <DialogContent className="max-w-2xl rounded-[2rem] border border-[#bdc1c6] bg-[#dde3ec] p-8 text-[#202124] shadow-2xl [&>button]:hidden sm:p-10">
          <DialogHeader className="space-y-4 text-left">
            <DialogTitle className="text-4xl font-normal leading-tight">
              Hide {pendingHideClass?.name}?
            </DialogTitle>
            <DialogDescription className="text-xl leading-relaxed text-[#3c4043]">
              You&apos;ll still be enrolled in this class. To see your hidden classes, click
              &quot;Show hidden classes&quot; at the bottom of the page.
            </DialogDescription>
          </DialogHeader>

          <label className="mt-2 flex cursor-pointer items-center gap-4 text-[#202124]">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#c9d1dc]">
              <input
                type="checkbox"
                checked={dontShowHideAgain}
                onChange={(event) => setDontShowHideAgain(event.target.checked)}
                className="h-9 w-9 accent-[#1a73e8]"
              />
            </span>
            <span className="text-2xl">Don&apos;t show this message again</span>
          </label>

          <DialogFooter className="mt-4 flex-row justify-end gap-5 sm:space-x-0">
            <Button
              type="button"
              variant="ghost"
              className="text-2xl text-[#1967d2] hover:bg-[#ced6e2]"
              onClick={() => {
                setHideDialogOpen(false);
                setPendingHideClass(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-2xl text-[#1967d2] hover:bg-[#ced6e2]"
              onClick={confirmHideClass}
            >
              Hide
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={reportDialogOpen}
        onOpenChange={(open) => {
          setReportDialogOpen(open);
          if (!open) setPendingReportClass(null);
        }}
      >
        <DialogContent className="max-w-2xl rounded-[2rem] border border-[#5f6368] bg-[#202124] p-8 text-[#e8eaed] shadow-2xl [&>button]:hidden sm:p-10">
          <DialogHeader className="space-y-4 text-left">
            <DialogTitle className="text-4xl font-normal leading-tight text-[#e8eaed]">
              Please choose a next step:
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            <div className="space-y-2">
              <p className="text-3xl text-[#e8eaed]">Report content for a policy violation</p>
              <p className="text-xl text-[#bdc1c6]">
                Report violations relating to Google content and product policies, such as
                inappropriate content.
              </p>
            </div>

            <div className="space-y-4">
              {Object.entries(REPORT_REASON_META)
                .filter(([, option]) => option.section === "policy")
                .map(([value, option]) => (
                  <label key={value} className="flex cursor-pointer items-center gap-4 py-1 text-[#e8eaed]">
                    <input
                      type="radio"
                      name="report-reason"
                      value={value}
                      checked={reportReason === value}
                      onChange={() => setReportReason(value as ReportReason)}
                      className="h-9 w-9 accent-[#8ab4f8]"
                    />
                    <span className="text-2xl">{option.label}</span>
                  </label>
                ))}
            </div>

            <hr className="border-[#5f6368]" />

            <div className="space-y-2">
              <p className="text-3xl text-[#e8eaed]">Report content for legal reasons</p>
              <p className="text-xl text-[#bdc1c6]">
                Report content that you believe violates the law or your rights, like intellectual
                property rights or personal rights.
              </p>
            </div>

            <label className="flex cursor-pointer items-center gap-4 py-1 text-[#e8eaed]">
              <input
                type="radio"
                name="report-reason"
                value="illegal_content"
                checked={reportReason === "illegal_content"}
                onChange={() => setReportReason("illegal_content")}
                className="h-9 w-9 accent-[#8ab4f8]"
              />
              <span className="text-2xl">{REPORT_REASON_META.illegal_content.label}</span>
            </label>
          </div>

          <DialogFooter className="mt-6 flex-row justify-end gap-4 sm:space-x-0">
            <Button
              type="button"
              variant="ghost"
              className="text-2xl text-[#8ab4f8] hover:bg-[#2f333a]"
              onClick={() => {
                setReportDialogOpen(false);
                setPendingReportClass(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="rounded-full bg-[#8ab4f8] px-8 py-6 text-2xl text-[#0b2f66] hover:bg-[#9dc0f8]"
              onClick={submitReportAbuse}
            >
              Next
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface ClassCardProps {
  classItem: ClassCardItem;
  color: string;
  schoolYear: string;
  isDarkTheme: boolean;
  isDragging?: boolean;
  compact?: boolean;
  onPrimaryAction: (id: string) => void;
  onOpenDrive: (classItem: ClassCardItem, schoolYear: string) => void;
  onArchive?: (id: string) => void;
  onDelete?: (id: string) => void;
  onLeave?: (id: string) => void;
  onCopyInvite?: (code: string) => void;
  onHide?: (classItem: ClassCardItem) => void;
  onUnhide?: (id: string) => void;
  onReportAbuse?: (classItem: ClassCardItem) => void;
  isOwner: boolean;
  canManage: boolean;
  isHidden?: boolean;
  teacherName?: string;
  teacherAvatar?: string;
  language: string;
  t: (key: TranslationKey) => string;
}

function ClassCard({
  classItem,
  color,
  schoolYear,
  isDarkTheme,
  isDragging = false,
  compact = false,
  onPrimaryAction,
  onOpenDrive,
  onArchive,
  onDelete,
  onLeave,
  onCopyInvite,
  onHide,
  onUnhide,
  onReportAbuse,
  isOwner,
  canManage,
  isHidden,
  teacherName,
  teacherAvatar,
  language,
  t,
}: ClassCardProps) {
  const CARD_WIDTH = compact ? "100%" : 286;
  const CARD_HEIGHT = compact ? 220 : 252;
  const CARD_HEADER_HEIGHT = compact ? 104 : 108;
  const CARD_FOOTER_HEIGHT = compact ? 48 : 52;

  const showTeacherAvatar = Boolean(teacherName);
  const primaryTooltip = isOwner
    ? `Open gradebook for "${classItem.name}"`
    : `Open your work for "${classItem.name}"`;
  const driveTooltip = `Open folder for "${classItem.name} ${schoolYear}" in Google Drive`;
  const lowerLine = teacherName || classItem.subject || "\u00a0";
  const actionIconColor = isDarkTheme ? "#d4dae2" : "#5f6368";
  const actionIconHoverColor = isDarkTheme ? "#ffffff" : "#202124";
  const menuItemClass =
    "h-9 text-sm px-2 focus:bg-[#f2f4f7] focus:text-[#202124] data-[highlighted]:bg-[#f2f4f7] data-[highlighted]:text-[#202124]";
  const menuDangerItemClass =
    "h-9 text-sm px-2 text-destructive focus:bg-[#f6d9dc] focus:text-[#b3261e] data-[highlighted]:bg-[#f6d9dc] data-[highlighted]:text-[#b3261e]";

  const actionButtonStyle: React.CSSProperties = {
    width: 36,
    height: 36,
    borderRadius: "9999px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: actionIconColor,
    backgroundColor: "transparent",
    border: "none",
    opacity: 1,
    transition: "background-color 0.15s ease, color 0.15s ease",
  };

  const handleActionClick = (event: React.MouseEvent, callback: () => void) => {
    event.preventDefault();
    event.stopPropagation();
    callback();
  };

  const handleActionButtonHover = (
    event: React.MouseEvent<HTMLButtonElement>,
    isHovering: boolean
  ) => {
    event.currentTarget.style.backgroundColor = isHovering
      ? isDarkTheme
        ? "rgba(255, 255, 255, 0.14)"
        : "rgba(0, 0, 0, 0.12)"
      : "transparent";
    event.currentTarget.style.color = isHovering ? actionIconHoverColor : actionIconColor;
  };

  const dropdownMenuContent = (
    <DropdownMenuContent
      align="end"
      sideOffset={8}
      className="w-52 rounded-xl border border-[#d9dce1] bg-[#ffffff] p-1 text-[#202124] shadow-xl"
      style={{ backgroundColor: "#ffffff", borderColor: "#d9dce1", color: "#202124" }}
    >
      {canManage ? (
        <>
          {onCopyInvite && (
            <DropdownMenuItem
              className={menuItemClass}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onCopyInvite(classItem.code);
              }}
            >
              <Copy className="mr-2 h-5 w-5" />
              Copy invite code
            </DropdownMenuItem>
          )}

          <DropdownMenuItem
            className={menuItemClass}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              window.location.href = `/classes/${classItem.id}?edit=true`;
            }}
          >
            <Pencil className="mr-2 h-5 w-5" />
            Edit
          </DropdownMenuItem>

          {onArchive && (
            <DropdownMenuItem
              className={menuItemClass}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onArchive(classItem.id);
              }}
            >
              <Archive className="mr-2 h-5 w-5" />
              {t("archive")}
            </DropdownMenuItem>
          )}

          {onDelete && (
            <DropdownMenuItem
              className={menuDangerItemClass}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDelete(classItem.id);
              }}
            >
              <LogOut className="mr-2 h-5 w-5 rotate-180" />
              {language === "uz" ? "O'chirish" : language === "ru" ? "Удалить" : "Delete"}
            </DropdownMenuItem>
          )}
        </>
      ) : (
        <>
          {isHidden ? (
            <DropdownMenuItem
              className={menuItemClass}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onUnhide?.(classItem.id);
              }}
            >
              <Eye className="mr-2 h-5 w-5" />
              Unhide
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              className={menuItemClass}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onHide?.(classItem);
              }}
            >
              <EyeOff className="mr-2 h-5 w-5" />
              Hide
            </DropdownMenuItem>
          )}

          {onLeave && (
            <DropdownMenuItem
              className={menuItemClass}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onLeave(classItem.id);
              }}
            >
              <LogOut className="mr-2 h-5 w-5" />
              Unenroll
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className={menuItemClass}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onReportAbuse?.(classItem);
            }}
          >
            <Flag className="mr-2 h-5 w-5" />
            Report abuse
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  );

  const cardContent = compact ? (
    /* Mobile: compact card with overlay menu */
    <div
      className={`relative overflow-hidden rounded-[20px] border shadow-sm transition-shadow duration-200 hover:shadow-lg ${isHidden ? "opacity-80" : ""}`}
      style={{
        borderColor: "var(--class-card-border)",
        width: CARD_WIDTH,
        margin: "0 auto",
        cursor: "grab",
      }}
    >
      <div
        className="relative px-4 pt-3 pb-3"
        style={{ background: classItem.classAvatar ? undefined : color, height: CARD_HEADER_HEIGHT }}
      >
        {classItem.classAvatar && (
          <>
            <img
              src={classItem.classAvatar}
              alt={classItem.name}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/20 to-transparent" />
          </>
        )}

        {/* Triple dot menu — top right of banner (mobile only) */}
        <DropdownMenu>
          <DropdownMenuTrigger
            asChild
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <button
              type="button"
              className="absolute top-2 right-2 z-30 flex h-8 w-8 items-center justify-center rounded-full text-white/90 hover:text-white transition-colors"
            >
              <MoreVertical className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </DropdownMenuTrigger>
          {dropdownMenuContent}
        </DropdownMenu>

        {/* Text content */}
        <div className="relative z-10 pr-10 pt-4 text-white">
          <h3
            className="truncate font-normal leading-[1.08] drop-shadow-sm group-hover/card:underline group-hover/card:underline-offset-4"
            style={{ fontSize: "1.15rem" }}
          >
            {classItem.name}
          </h3>
          <p className="mt-1.5 text-[0.8rem] font-semibold tracking-[0.01em] text-white/95">
            {schoolYear}
          </p>
          <p className="mt-0.5 truncate text-[0.84rem] font-medium text-white/90">{lowerLine}</p>
        </div>

        {showTeacherAvatar && (
          <div className="absolute right-3 bottom-2 z-20">
            <Avatar className="border-2 border-white shadow-md" style={{ width: 48, height: 48 }}>
              <AvatarImage src={teacherAvatar} />
              <AvatarFallback
                className="text-xs text-white"
                style={{ backgroundColor: getUserAvatarColor(teacherName || "") }}
              >
                {getInitials(teacherName || "?")}
              </AvatarFallback>
            </Avatar>
          </div>
        )}
      </div>
    </div>
  ) : (
    /* Desktop: classic card with body + footer action buttons */
    <div
      className={`relative flex flex-col overflow-hidden rounded-[20px] border shadow-sm transition-shadow duration-200 hover:shadow-lg ${isHidden ? "opacity-80" : ""}`}
      style={{
        borderColor: "var(--class-card-border)",
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        margin: "0 auto",
        cursor: "grab",
      }}
    >
      <div
        className="relative px-4 pb-6 pt-3"
        style={{ background: classItem.classAvatar ? undefined : color, height: CARD_HEADER_HEIGHT }}
      >
        {classItem.classAvatar && (
          <>
            <img
              src={classItem.classAvatar}
              alt={classItem.name}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/20 to-transparent" />
          </>
        )}

        <div className="relative z-10 pr-20 text-white">
          <h3
            className="truncate font-normal leading-[1.08] drop-shadow-sm group-hover/card:underline group-hover/card:underline-offset-4"
            style={{ fontSize: "1.25rem" }}
          >
            {classItem.name}
          </h3>
          <p className="mt-2 text-[0.82rem] font-semibold tracking-[0.01em] text-white/95">
            {schoolYear}
          </p>
          <p className="mt-0.5 truncate text-[0.88rem] font-medium text-white/90">{lowerLine}</p>
        </div>

        {showTeacherAvatar && (
          <div className="absolute right-4 z-20" style={{ bottom: -20 }}>
            <Avatar className="border-2 border-white shadow-md" style={{ width: 64, height: 64 }}>
              <AvatarImage src={teacherAvatar} />
              <AvatarFallback
                className="text-xs text-white"
                style={{ backgroundColor: getUserAvatarColor(teacherName || "") }}
              >
                {getInitials(teacherName || "?")}
              </AvatarFallback>
            </Avatar>
          </div>
        )}
      </div>

      <div
        className="flex-1 border-t"
        style={{
          backgroundColor: "var(--class-card-body)",
          borderTopColor: "var(--class-card-border)",
        }}
      />

      <div
        className="flex items-center justify-center gap-6 border-t px-2"
        style={{
          backgroundColor: "var(--class-card-body)",
          borderTopColor: "var(--class-card-border)",
          height: CARD_FOOTER_HEIGHT,
        }}
      >
        <button
          type="button"
          title={primaryTooltip}
          style={actionButtonStyle}
          onClick={(event) => {
            handleActionClick(event, () => {
              if (isOwner) {
                window.location.href = `/to-review?classId=${classItem.id}`;
              } else {
                window.location.href = `/todo?tab=done&classId=${classItem.id}`;
              }
            });
          }}
          onMouseEnter={(event) => handleActionButtonHover(event, true)}
          onMouseLeave={(event) => handleActionButtonHover(event, false)}
        >
          {isOwner ? (
            <TrendingUp className="h-[18px] w-[18px]" strokeWidth={2.55} style={{ opacity: 1 }} />
          ) : (
            <ClipboardList className="h-[18px] w-[18px]" strokeWidth={2.55} style={{ opacity: 1 }} />
          )}
        </button>

        <button
          type="button"
          title={driveTooltip}
          style={actionButtonStyle}
          onClick={(event) => {
            handleActionClick(event, () => onOpenDrive(classItem, schoolYear));
          }}
          onMouseEnter={(event) => handleActionButtonHover(event, true)}
          onMouseLeave={(event) => handleActionButtonHover(event, false)}
        >
          <Folder className="h-[18px] w-[18px]" strokeWidth={2.55} style={{ opacity: 1 }} />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger
            asChild
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <button
              type="button"
              style={actionButtonStyle}
              onMouseEnter={(event) => handleActionButtonHover(event, true)}
              onMouseLeave={(event) => handleActionButtonHover(event, false)}
            >
              <MoreVertical className="h-[18px] w-[18px]" strokeWidth={3} style={{ opacity: 1 }} />
            </button>
          </DropdownMenuTrigger>
          {dropdownMenuContent}
        </DropdownMenu>
      </div>
    </div>
  );

  return (
    <Link
      href={`/classes/${classItem.id}`}
      className="group/card block"
      style={{ width: "100%" }}
    >
      {cardContent}
    </Link>
  );
}

function SortableClassCard(props: ClassCardProps & { classItem: ClassCardItem }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.classItem.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ClassCard {...props} isDragging={isDragging} />
    </div>
  );
}

function DashboardSkeleton() {
  const CARD_WIDTH = 286;
  const CARD_HEIGHT = 252;
  const CARD_HEADER_HEIGHT = 108;
  const CARD_FOOTER_HEIGHT = 52;

  return (
    <div className="space-y-6">
      <div className="grid" style={CLASSES_GRID_STYLE}>
        {[1, 2, 3, 4].map((item) => (
          <div
            key={item}
            className="overflow-hidden rounded-[20px] border"
            style={{ width: CARD_WIDTH, margin: "0 auto", height: CARD_HEIGHT }}
          >
            <Skeleton className="w-full" style={{ height: CARD_HEADER_HEIGHT }} />
            <Skeleton
              className="w-full rounded-none"
              style={{ height: CARD_HEIGHT - CARD_HEADER_HEIGHT - CARD_FOOTER_HEIGHT }}
            />
            <div
              className="flex items-center justify-center gap-6 px-3"
              style={{ height: CARD_FOOTER_HEIGHT }}
            >
              <Skeleton className="h-9 w-9 rounded-full" />
              <Skeleton className="h-9 w-9 rounded-full" />
              <Skeleton className="h-9 w-9 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
