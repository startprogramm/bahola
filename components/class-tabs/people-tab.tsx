"use client";

import { useState, useMemo } from "react";
import {
  Users,
  Loader2,
  MoreVertical,
  UserMinus,
  Crown,
  Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n/language-context";
import type { ClassDetail } from "./types";

const isMaktab = process.env.NEXT_PUBLIC_APP_MODE === "maktab";

interface PeopleTabProps {
  classId: string;
  classData: ClassDetail;
  hasTeacherAccess: boolean;
  isTeacher: boolean;
  bannerColor: string;
  onClassDataChange: (updater: (prev: ClassDetail | null) => ClassDetail | null) => void;
}

export function PeopleTab({
  classId,
  classData,
  hasTeacherAccess,
  isTeacher,
  bannerColor,
  onClassDataChange,
}: PeopleTabProps) {
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const [removingStudentId, setRemovingStudentId] = useState<string | null>(null);
  const [transferringToId, setTransferringToId] = useState<string | null>(null);
  const [peopleSearch, setPeopleSearch] = useState("");
  const [peopleSortBy, setPeopleSortBy] = useState<"name" | "avgScore">("name");

  const removeStudent = async (studentId: string) => {
    if (!confirm(t("removeStudentConfirm"))) return;

    setRemovingStudentId(studentId);
    try {
      const response = await fetch(`/api/classes/${classId}/students/${studentId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        toast({
          title: t("studentRemoved"),
        });
        sessionStorage.removeItem(`class-detail-${classId}`);
        onClassDataChange((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            enrollments: prev.enrollments.filter((e) => e.student.id !== studentId),
          };
        });
      } else {
        throw new Error("Failed to remove student");
      }
    } catch {
      toast({
        title: t("failedToRemoveStudent"),
        variant: "destructive",
      });
    } finally {
      setRemovingStudentId(null);
    }
  };

  const transferOwnership = async (newTeacherId: string, studentName: string, currentRole?: "STUDENT" | "TEACHER") => {
    const isDemote = currentRole === "TEACHER";
    const confirmMsg = isDemote
      ? (language === "uz"
        ? `${studentName}ni o'quvchiga qaytarmoqchimisiz?`
        : language === "ru"
          ? `Понизить ${studentName} до ученика?`
          : `Demote ${studentName} back to student?`)
      : (language === "uz"
        ? `${studentName}ni o'qituvchiga ko'tarmoqchimisiz?`
        : language === "ru"
          ? `Сделать ${studentName} учителем?`
          : `Promote ${studentName} to teacher?`);

    if (!confirm(confirmMsg)) return;

    setTransferringToId(newTeacherId);
    try {
      const response = await fetch(`/api/classes/${classId}/transfer-ownership`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newTeacherId, demote: isDemote }),
      });

      if (response.ok) {
        toast({
          title: isDemote
            ? (language === "uz" ? "O'quvchiga qaytarildi" : language === "ru" ? "Понижен до ученика" : "Demoted to student")
            : (language === "uz" ? "O'qituvchiga ko'tarildi" : language === "ru" ? "Повышен до учителя" : "Promoted to teacher"),
        });
        onClassDataChange((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            enrollments: prev.enrollments.map((e) =>
              e.student.id === newTeacherId
                ? { ...e, role: isDemote ? "STUDENT" as const : "TEACHER" as const }
                : e
            ),
          };
        });
        sessionStorage.removeItem(`class-detail-${classId}`);
      } else {
        throw new Error("Failed to transfer ownership");
      }
    } catch {
      toast({
        title: language === "uz" ? "Xatolik" : language === "ru" ? "Ошибка" : "Error",
        variant: "destructive",
      });
    } finally {
      setTransferringToId(null);
    }
  };

  const sortedPeopleStudents = useMemo(() => {
    let studentEnrollments = classData.enrollments.filter((e) => e.role !== "TEACHER");

    if (peopleSearch.trim()) {
      const q = peopleSearch.trim().toLowerCase();
      studentEnrollments = studentEnrollments.filter((e) => e.student.name.toLowerCase().includes(q));
    }

    const getAvgScore = (enrollment: typeof studentEnrollments[0]) => {
      const subs = enrollment.student.submissions;
      if (!subs || subs.length === 0) return -1;
      let totalPct = 0, count = 0;
      for (const sub of subs) {
        if (sub.score != null && sub.maxScore != null && sub.maxScore > 0) {
          totalPct += (sub.score / sub.maxScore) * 100;
          count++;
        }
      }
      return count > 0 ? totalPct / count : -1;
    };

    return [...studentEnrollments].sort((a, b) => {
      if (peopleSortBy === "avgScore") {
        const avgA = getAvgScore(a);
        const avgB = getAvgScore(b);
        if (avgA !== avgB) return avgB - avgA;
        return a.student.name.localeCompare(b.student.name, undefined, { sensitivity: "base" });
      }
      return a.student.name.localeCompare(b.student.name, undefined, { sensitivity: "base" });
    });
  }, [classData, peopleSortBy, peopleSearch]);

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Teachers Section */}
      <div>
        <h3
          className="text-lg font-medium mb-4 pb-2 border-b border-border"
        >
          {t("teachers")}
        </h3>
        {/* Class owner */}
        <div className="flex items-center justify-between gap-3 py-3">
          <div
            className="h-10 w-10 rounded-full flex items-center justify-center text-white"
            style={{ backgroundColor: bannerColor }}
          >
            <span className="text-sm font-medium">
              {classData.teacher.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="flex-1">
            <p className="font-medium">{classData.teacher.name}</p>
          </div>
        </div>
        {/* Co-teachers */}
        {classData.enrollments.filter((e) => e.role === "TEACHER").map((enrollment) => (
          <div key={enrollment.id} className="flex items-center justify-between gap-3 py-3">
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
              <span className="text-sm font-medium">
                {enrollment.student.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1">
              <p className="font-medium">{enrollment.student.name}</p>
            </div>
            {isTeacher ? (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:pointer-events-none"
                    onClick={(e) => e.stopPropagation()}
                    disabled={removingStudentId === enrollment.student.id || transferringToId === enrollment.student.id}
                  >
                    {(removingStudentId === enrollment.student.id || transferringToId === enrollment.student.id) ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <MoreVertical className="h-4 w-4" />
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {!isMaktab && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={(e) => { e.preventDefault(); transferOwnership(enrollment.student.id, enrollment.student.name, enrollment.role); }}>
                        <Crown className="h-4 w-4 mr-2" />
                        {language === "uz" ? "O'quvchiga qaytarish" : language === "ru" ? "Понизить до ученика" : "Demote to Student"}
                      </DropdownMenuItem>
                    </>
                  )}
                  {!isMaktab && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={(e) => { e.preventDefault(); removeStudent(enrollment.student.id); }}
                      >
                        <UserMinus className="h-4 w-4 mr-2" />
                        {language === "uz" ? "Sinfdan chiqarish" : language === "ru" ? "Исключить из класса" : "Kick from Class"}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ))}
      </div>

      {/* Students Section */}
      <div>
        {(() => {
          const studentEnrollments = classData.enrollments.filter((e) => e.role !== "TEACHER");
          return (
            <>
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
                <h3 className="text-lg font-medium">
                  {hasTeacherAccess ? t("students") : (language === "uz" ? "Sinfdoshlar" : language === "ru" ? "Одноклассники" : "Classmates")}
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {studentEnrollments.length} {t("students").toLowerCase()}
                  </span>
                  <select
                    className="text-xs border border-border rounded-md px-2 py-1 bg-background text-foreground cursor-pointer"
                    value={peopleSortBy}
                    onChange={(e) => setPeopleSortBy(e.target.value as "name" | "avgScore")}
                  >
                    <option value="name">{language === "uz" ? "Ism bo'yicha" : language === "ru" ? "По имени" : "By name"}</option>
                    <option value="avgScore">{language === "uz" ? "O'rtacha ball" : language === "ru" ? "По среднему баллу" : "By avg score"}</option>
                  </select>
                </div>
              </div>
              {studentEnrollments.length > 0 && (
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={language === "uz" ? "O'quvchi qidirish..." : language === "ru" ? "Поиск ученика..." : "Search students..."}
                    value={peopleSearch}
                    onChange={(e) => setPeopleSearch(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
              )}
              {studentEnrollments.length === 0 ? (
                <div className="text-center py-12">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
                  <p className="text-muted-foreground">
                    {t("noStudentsEnrolled")}
                  </p>
                </div>
              ) : (
                <div>
                  {sortedPeopleStudents.map((enrollment) => (
                    <div
                      key={enrollment.id}
                      className="flex items-center justify-between py-3 group hover:bg-muted/30 -mx-2 px-2 rounded-lg transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                          <span className="text-sm font-medium">
                            {enrollment.student.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium">{enrollment.student.name}</p>
                          {(() => {
                            const subs = enrollment.student.submissions;
                            if (!subs || subs.length === 0) return null;
                            let totalPct = 0, count = 0;
                            for (const sub of subs) {
                              if (sub.score != null && sub.maxScore != null && sub.maxScore > 0) {
                                totalPct += (sub.score / sub.maxScore) * 100;
                                count++;
                              }
                            }
                            if (count === 0) return null;
                            const avg = Math.round(totalPct / count);
                            return <p className="text-xs text-muted-foreground">avg {avg}%</p>;
                          })()}
                        </div>
                      </div>
                      {isTeacher && (
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:pointer-events-none"
                              onClick={(e) => e.stopPropagation()}
                              disabled={removingStudentId === enrollment.student.id || transferringToId === enrollment.student.id}
                            >
                              {(removingStudentId === enrollment.student.id || transferringToId === enrollment.student.id) ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <MoreVertical className="h-4 w-4" />
                              )}
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {!isMaktab && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); transferOwnership(enrollment.student.id, enrollment.student.name, enrollment.role); }}>
                                  <Crown className="h-4 w-4 mr-2" />
                                  {language === "uz" ? "O'qituvchiga ko'tarish" : language === "ru" ? "Повысить до учителя" : "Promote to Teacher"}
                                </DropdownMenuItem>
                              </>
                            )}
                            {!isMaktab && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onSelect={(e) => { e.preventDefault(); removeStudent(enrollment.student.id); }}
                                >
                                  <UserMinus className="h-4 w-4 mr-2" />
                                  {language === "uz" ? "Sinfdan chiqarish" : language === "ru" ? "Исключить из класса" : "Kick from Class"}
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}
