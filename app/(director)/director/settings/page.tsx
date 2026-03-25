"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, Save, Check, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useLanguage } from "@/lib/i18n/language-context";
import { invalidateCache } from "@/lib/director/use-cached-fetch";
import type { Language } from "@/lib/i18n/translations";

interface SchoolSettings {
  school: { id: string; name: string; address: string; phone: string; email: string };
  director: { name: string; email: string };
}

const LANGUAGES: { code: Language; label: string; flag: string }[] = [
  { code: "en", label: "English", flag: "EN" },
  { code: "uz", label: "O'zbek", flag: "UZ" },
  { code: "ru", label: "Русский", flag: "RU" },
];

export default function DirectorSettingsPage() {
  const router = useRouter();
  const { t, language, setLanguage } = useLanguage();
  const [data, setData] = useState<SchoolSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // Form fields
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [directorName, setDirectorName] = useState("");

  useEffect(() => {
    fetch("/api/director/school-settings", { cache: "no-store", credentials: "same-origin" })
      .then(r => r.json())
      .then((d: SchoolSettings) => {
        if (!d || !d.school || !d.director) throw new Error("Invalid data");
        setData(d);
        setName(d.school.name || "");
        setAddress(d.school.address || "");
        setPhone(d.school.phone || "");
        setEmail(d.school.email || "");
        setDirectorName(d.director.name || "");
      })
      .catch(() => setError(t("dirSettingsLoadError")))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!name.trim() || name.trim().length < 2) {
      setError(t("dirSettingsNameValidation"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/director/school-settings", {
        method: "PATCH",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, address, phone, email, directorName }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || t("dirSettingsSaveError"));
        return;
      }
      // Invalidate client-side cache so the sidebar refetches the updated school name
      invalidateCache("/api/schools");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError(t("dirSettingsSaveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-6 py-6 space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">{t("dirSettingsTitle")}</h1>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <>
          {/* Language selector */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">{t("dirSettingsLanguage")}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => setLanguage(lang.code)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      language === lang.code
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-input hover:bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span className="font-bold text-xs">{lang.flag}</span>
                    {lang.label}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* School info form */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("dirSettingsSchoolInfo")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="school-name">{t("dirSettingsSchoolName")}</Label>
                <Input
                  id="school-name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t("dirSettingsSchoolNamePlaceholder")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="school-address">{t("dirSettingsAddress")}</Label>
                <Input
                  id="school-address"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  placeholder={t("dirSettingsAddressPlaceholder")}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="school-phone">{t("dirSettingsPhone")}</Label>
                  <Input
                    id="school-phone"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+998 90 123 45 67"
                    type="tel"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="school-email">Email</Label>
                  <Input
                    id="school-email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="maktab@example.com"
                    type="email"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Director info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("dirSettingsDirectorInfo")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="director-name">{t("dirSettingsDirectorName")}</Label>
                <Input
                  id="director-name"
                  value={directorName}
                  onChange={e => setDirectorName(e.target.value)}
                  placeholder={t("dirPlaceholderFullName")}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("dirSettingsEmailReadOnly")}</Label>
                <Input
                  value={data?.director?.email || ""}
                  readOnly
                  disabled
                  className="opacity-60"
                />
              </div>
            </CardContent>
          </Card>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          {/* Save button */}
          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saved ? (
                <>
                  <Check className="h-4 w-4" />
                  {t("dirSaved")}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {saving ? t("dirSaving") : t("dirSave")}
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
