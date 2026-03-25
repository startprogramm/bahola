"use client";

import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { clearUserCache } from "@/lib/clear-user-cache";
import { useRouter } from "next/navigation";
import { Shield, Palette, Globe, Sun, Moon, Monitor, CreditCard, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { normalizeImageUrl } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/language-context";
import { useTheme } from "@/lib/theme-provider";
import type { Language } from "@/lib/i18n/translations";
import { useSubscriptionData } from "@/hooks/use-subscription";

const isMaktab = process.env.NEXT_PUBLIC_APP_MODE === "maktab";

const languages: { code: Language; name: string; flag: string }[] = [
  { code: "en", name: "English", flag: "EN" },
  { code: "uz", name: "O'zbek", flag: "UZ" },
  { code: "ru", name: "Русский", flag: "RU" },
];

export default function SettingsPage() {
  const { data: session, update } = useSession();
  const { toast } = useToast();
  const { language, setLanguage, t } = useLanguage();
  const { theme, setTheme } = useTheme();
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [name, setName] = useState(session?.user?.name || "");
  const [email, setEmail] = useState(session?.user?.email || "");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [optimisticAvatar, setOptimisticAvatar] = useState<string | null>(null);
  const [avatarBroken, setAvatarBroken] = useState(false);

  const { data: subData } = useSubscriptionData();

  const sessionAvatar = (session?.user as any)?.avatar || null;
  const avatar = optimisticAvatar || sessionAvatar;
  const rawCredits = Number((session?.user as any)?.credits ?? 0);
  const isUnlimitedCredits = rawCredits < 0 || rawCredits >= 999999;

  useEffect(() => {
    if (session?.user) {
      if (!name && session.user.name) setName(session.user.name);
      if (!email && session.user.email) setEmail(session.user.email);
    }
  }, [session, name, email]);

  useEffect(() => {
    if (session?.user) {
      const nameChanged = name !== (session.user.name || "");
      const emailChanged = email !== (session.user.email || "");
      setHasUnsavedChanges(nameChanged || emailChanged);
    }
  }, [name, email, session]);

  const handleSaveAllChanges = async () => {
    if (!name.trim()) {
      toast({ title: t("nameRequired"), description: t("nameRequired"), variant: "destructive" });
      return;
    }
    if (!email.trim()) {
      toast({ title: t("emailRequired"), description: t("emailRequired"), variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("updateFailed"));

      await update({ name, email });
      setHasUnsavedChanges(false);
      toast({ title: t("changesSaved"), description: t("allSettingsSaved") });
    } catch (error) {
      toast({ title: t("updateFailed"), description: error instanceof Error ? error.message : t("updateFailed"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: t("invalidFile"), description: t("pleaseSelectImage"), variant: "destructive" });
      return;
    }

    // Show preview instantly — no server round-trip needed
    const reader = new FileReader();
    reader.onload = (ev) => {
      setOptimisticAvatar(ev.target?.result as string);
      setAvatarBroken(false);
    };
    reader.readAsDataURL(file);
    setAvatarUploading(true);

    // Save to DB lazily in the background
    const formData = new FormData();
    formData.append("avatar", file);
    fetch("/api/user/avatar", { method: "POST", body: formData })
      .then((res) => {
        if (!res.ok) throw new Error("Upload failed");
        return res.json();
      })
      .then((data) => {
        setOptimisticAvatar(null); // session will take over
        update({ avatar: data.avatar });
      })
      .catch(() => {
        setOptimisticAvatar(null);
        toast({ title: t("updateFailed"), variant: "destructive" });
      })
      .finally(() => setAvatarUploading(false));
  };

  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    try {
      const response = await fetch("/api/user/profile", { method: "DELETE" });
      if (!response.ok) throw new Error(t("deleteFailed"));
      toast({ title: t("accountDeleted"), description: t("accountDeleted") });
      clearUserCache();
      await signOut({ callbackUrl: "/" });
    } catch {
      toast({ title: t("deleteFailed"), description: t("deleteFailed"), variant: "destructive" });
    } finally {
      setDeleteLoading(false);
      setShowDeleteDialog(false);
    }
  };

  const subscriptionTitle = t("subscriptionSection");
  const manageSubscription = t("manageSubscription");
  const manageSubscriptionHint = t("manageSubscriptionHint");

  const initials = (session?.user?.name || "?")
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="mx-auto w-full max-w-3xl py-2">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("settings")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settingsDescription")}
        </p>
      </div>

      {/* Profile Section */}
      <div className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">{t("profile")}</h2>

        <div className="flex items-center gap-5 mb-6">
          <div className="relative group">
            {avatar && !avatarBroken ? (
              <img src={normalizeImageUrl(avatar)} alt="Avatar" className="h-16 w-16 rounded-full object-cover ring-2 ring-border" onError={() => setAvatarBroken(true)} />
            ) : (
              <div className="h-16 w-16 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-bold ring-2 ring-border">
                {initials}
              </div>
            )}
            <label className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
              {avatarUploading ? (
                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
              <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} disabled={avatarUploading} />
            </label>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground truncate">{session?.user?.name || ""}</p>
            <p className="text-sm text-muted-foreground truncate">{session?.user?.email || ""}</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-xs font-medium text-muted-foreground">{t("fullName")}</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("yourFullName")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs font-medium text-muted-foreground">{t("email")}</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("yourEmail")} />
          </div>
        </div>
      </div>

      <hr className="border-border mb-8" />

      {/* Appearance */}
      <div className="mb-8">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          <Palette className="h-3.5 w-3.5" />
          {t("appearance")}
        </h2>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium text-foreground">{t("theme")}</span>
            <div className="flex gap-2">
              {([
                { value: "light", icon: Sun, labelKey: "light" as const },
                { value: "dark", icon: Moon, labelKey: "dark" as const },
                { value: "system", icon: Monitor, labelKey: "system" as const },
              ] as const).map(({ value, icon: Icon, labelKey }) => (
                <Button key={value} variant={theme === value ? "default" : "outline"} size="sm" onClick={() => setTheme(value)} className="gap-1.5">
                  <Icon className="h-4 w-4" />
                  {t(labelKey)}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">{t("displayLanguage")}</span>
            </div>
            <div className="flex gap-2">
              {languages.map((lang) => (
                <Button key={lang.code} variant={language === lang.code ? "default" : "outline"} size="sm" onClick={() => setLanguage(lang.code)} className="min-w-[54px]">
                  {lang.flag}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <hr className="border-border mb-8" />

      {/* Subscription / Credits */}
      <div className="mb-8">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          <CreditCard className="h-3.5 w-3.5" />
          {isMaktab
            ? (language === "uz" ? "AI kreditlar" : language === "ru" ? "AI кредиты" : "AI Credits")
            : subscriptionTitle}
        </h2>
        {isMaktab ? (
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold text-foreground">{isUnlimitedCredits ? "∞" : rawCredits}</span>
            <span className="text-sm text-muted-foreground">
              {language === "uz" ? "kredit qoldi" : language === "ru" ? "кредитов осталось" : "credits left"}
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            {subData && (
              <div className="text-sm space-y-0.5">
                <p className="font-medium text-foreground">
                  {t("currentPlan")}: {subData.subscription ?? "FREE"}
                </p>
                {subData.subscriptionExpiresAt && (() => {
                  const expiresAt = new Date(subData.subscriptionExpiresAt);
                  const isPast = expiresAt.getTime() < Date.now();
                  if (isPast) {
                    return (
                      <p className="text-destructive font-medium">
                        {t("subscriptionExpired")}
                      </p>
                    );
                  }
                  const formatted = expiresAt.toLocaleDateString(
                    language === "uz" ? "uz-Latn-UZ" : language === "ru" ? "ru-RU" : "en-GB",
                    { day: "numeric", month: "long", year: "numeric" }
                  );
                  return (
                    <p className="text-muted-foreground">
                      {t("subscriptionExpires")}: {formatted}
                    </p>
                  );
                })()}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">{manageSubscriptionHint}</span>
              <Button variant="outline" size="sm" onClick={() => router.push("/shop")} className="gap-2">
                <CreditCard className="h-4 w-4" />
                {manageSubscription}
              </Button>
            </div>
          </div>
        )}
      </div>

      {!isMaktab && (
        <>
          <hr className="border-border mb-8" />

          {/* Security / Delete Account */}
          <div className="mb-8">
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-destructive mb-4">
              <Shield className="h-3.5 w-3.5" />
              {t("security")}
            </h2>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium text-destructive/80">{t("deleteAccount")}</span>
              <Button variant="destructive" size="sm" onClick={() => setShowDeleteDialog(true)}>
                {t("deleteAccount")}
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Save Button */}
      <div className="flex justify-end border-t border-border pt-4">
        <Button onClick={handleSaveAllChanges} disabled={loading || !hasUnsavedChanges} className="min-w-[150px]">
          {loading ? t("loading") : t("saveChanges")}
        </Button>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteAccount")}</DialogTitle>
            <DialogDescription>{t("deleteAccountConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)} disabled={deleteLoading}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={handleDeleteAccount} disabled={deleteLoading}>
              {deleteLoading ? t("loading") : t("deleteAccount")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
