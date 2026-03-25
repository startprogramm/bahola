"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n/language-context";
import { notifyClassesChanged } from "@/lib/fetch-cache";
import Link from "next/link";

export default function NewClassPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { t, language } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast({
        title: language === "uz" ? "Nom kerak" : language === "ru" ? "Требуется название" : "Name required",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast({
          title: language === "uz" ? "Xato yuz berdi" : language === "ru" ? "Ошибка" : "Failed to create class",
          description: data?.error || `Error ${response.status}`,
          variant: "destructive",
        });
        return;
      }

      sessionStorage.removeItem("classes-cache");
      notifyClassesChanged();
      router.push(`/classes/${data.class.id}`);
    } catch (error) {
      console.error("Failed to create class:", error);
      toast({
        title: language === "uz" ? "Xato yuz berdi" : language === "ru" ? "Ошибка" : "Failed to create class",
        description: language === "uz" ? "Tarmoq xatosi" : language === "ru" ? "Ошибка сети" : "Network error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/classes">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("createClass")}
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("className")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">{t("className")}</Label>
              <Input
                id="name"
                placeholder={language === "uz" ? "masalan, Matematika 9-sinf" : language === "ru" ? "напр., Математика 9 класс" : "e.g., Math Grade 9"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="flex gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" loading={loading}>
                {t("createClass")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
