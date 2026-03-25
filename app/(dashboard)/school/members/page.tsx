"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Users, Search, Loader2, Trash2, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLanguage } from "@/lib/i18n/language-context";
import { useToast } from "@/hooks/use-toast";
import { getInitials, getUserAvatarColor, formatDate } from "@/lib/utils";
import Link from "next/link";

interface Member {
  membershipId: string;
  userId: string;
  role: "STUDENT" | "TEACHER";
  joinedAt: string;
  user: { id: string; name: string; email: string | null; avatar: string | null };
}

interface School { id: string; name: string; code: string }

export default function SchoolMembersPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { toast } = useToast();
  const [school, setSchool] = useState<School | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | "STUDENT" | "TEACHER">("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Member | null>(null);

  const load = useCallback(async (schoolId: string) => {
    const params = new URLSearchParams({ limit: "200" });
    if (roleFilter) params.set("role", roleFilter);
    const res = await fetch(`/api/schools/${schoolId}/members?${params}`);
    if (res.ok) {
      const data = await res.json();
      setMembers(data.members);
    }
  }, [roleFilter]);

  useEffect(() => {
    const init = async () => {
      const schoolRes = await fetch("/api/schools");
      const schoolData = await schoolRes.json();
      if (!schoolRes.ok || !schoolData.school) { router.push("/school/create"); return; }
      setSchool(schoolData.school);
      await load(schoolData.school.id);
      setLoading(false);
    };
    init();
  }, [router, load]);

  const handleRemove = async (member: Member) => {
    if (!school) return;
    setRemoving(member.userId);
    try {
      const res = await fetch(`/api/schools/${school.id}/members`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.userId }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: t("success") });
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
    } catch {
      toast({ title: "Failed to remove member", variant: "destructive" });
    } finally {
      setRemoving(null);
      setConfirmRemove(null);
    }
  };

  const filtered = members.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return m.user.name.toLowerCase().includes(q) || (m.user.email ?? "").toLowerCase().includes(q);
  });

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/school/dashboard"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold">{t("schoolMembers")}</h1>
          <p className="text-sm text-muted-foreground">{school?.name}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchMembers")}
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          {(["", "STUDENT", "TEACHER"] as const).map((r) => (
            <Button
              key={r}
              variant={roleFilter === r ? "default" : "outline"}
              size="sm"
              onClick={() => setRoleFilter(r)}
            >
              {r === "" ? t("allRoles") : r === "STUDENT" ? t("student") : t("teacher")}
            </Button>
          ))}
        </div>
      </div>

      {/* Members list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "member" : "members"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">{t("noMembersFound")}</p>
          ) : (
            <div className="divide-y">
              {filtered.map((member) => (
                <div key={member.userId} className="flex items-center gap-3 px-6 py-3">
                  {/* Avatar */}
                  <div
                    className="h-9 w-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                    style={{ backgroundColor: getUserAvatarColor(member.user.name) }}
                  >
                    {getInitials(member.user.name)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{member.user.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {member.user.email ?? "—"} · {t("joinedOn")} {formatDate(member.joinedAt)}
                    </p>
                  </div>

                  <Badge variant={member.role === "TEACHER" ? "default" : "secondary"} className="shrink-0 text-xs">
                    {member.role === "TEACHER" ? t("teacher") : t("student")}
                  </Badge>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => setConfirmRemove(member)}
                    disabled={removing === member.userId}
                  >
                    {removing === member.userId ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirm remove dialog */}
      <Dialog open={!!confirmRemove} onOpenChange={(o) => { if (!o) setConfirmRemove(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("removeFromSchool")}</DialogTitle>
            <DialogDescription>{t("confirmRemoveMember")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(null)}>{t("cancel")}</Button>
            <Button
              variant="destructive"
              onClick={() => confirmRemove && handleRemove(confirmRemove)}
            >
              {t("removeFromSchool")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
