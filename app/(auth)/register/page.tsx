"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { AlertCircle, Loader2, ArrowRight, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/language-context";
import type { Language } from "@/lib/i18n/translations";
import { LogoIcon, LogoText } from "@/components/logo";

const isMaktab = process.env.NEXT_PUBLIC_APP_MODE === "maktab";

interface FieldErrors {
  name?: string;
  email?: string;
  general?: string;
}

interface AndroidBridge {
  triggerGoogleSignIn?: () => void;
  getIdToken?: () => string;
}

interface AndroidWindow extends Window {
  onGoogleSignIn?: (idToken: string) => void;
  handleGoogleToken?: (idToken: string) => void;
  androidGoogleIdToken?: string;
  AndroidBridge?: AndroidBridge;
}

export default function RegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteCode = searchParams.get("code");
  const { t, language, setLanguage } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const processedAndroidTokenRef = useRef<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
  });

  useEffect(() => {
    if (isMaktab) {
      router.replace("/login");
    }
  }, [router]);

  // After successful sign-in, try to join the class if invite code present, then redirect
  const joinAndRedirect = useCallback(async () => {
    if (inviteCode) {
      try {
        const res = await fetch("/api/classes/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: inviteCode }),
        });
        const data = await res.json();
        if (res.ok && data.class?.id) {
          router.push(`/classes/${data.class.id}`);
          router.refresh();
          return;
        }
      } catch {
        // If join fails, just go to classes page
      }
    }
    router.push("/classes");
    router.refresh();
  }, [inviteCode, router]);

  const handleAndroidGoogleSignIn = useCallback(
    async (idToken: string) => {
      if (!idToken || processedAndroidTokenRef.current === idToken) {
        return;
      }

      processedAndroidTokenRef.current = idToken;
      setGoogleLoading(true);
      setErrors({});

      try {
        const result = await signIn("google-id-token", {
          idToken,
          redirect: false,
          callbackUrl: "/classes",
        });

        if (result?.error) {
          processedAndroidTokenRef.current = null;
          setErrors({ general: result.error });
          return;
        }

        await joinAndRedirect();
      } catch {
        processedAndroidTokenRef.current = null;
        setErrors({ general: t("somethingWentWrong") || "Something went wrong" });
      } finally {
        setGoogleLoading(false);
      }
    },
    [inviteCode, joinAndRedirect, router, t]
  );

  useEffect(() => {
    const androidWindow = window as AndroidWindow;

    const processToken = (idToken: string) => {
      void handleAndroidGoogleSignIn(idToken);
    };

    const onTokenEvent: EventListener = (event) => {
      const customEvent = event as CustomEvent<{ idToken?: string }>;
      const token = customEvent.detail?.idToken;
      if (token) {
        processToken(token);
      }
    };

    androidWindow.onGoogleSignIn = processToken;
    androidWindow.handleGoogleToken = processToken;
    window.addEventListener("androidGoogleSignIn", onTokenEvent);

    if (androidWindow.androidGoogleIdToken) {
      processToken(androidWindow.androidGoogleIdToken);
    }

    if (androidWindow.AndroidBridge?.getIdToken) {
      try {
        const tokenFromBridge = androidWindow.AndroidBridge.getIdToken();
        if (tokenFromBridge) {
          processToken(tokenFromBridge);
        }
      } catch {
        // Ignore bridge read failures and keep web fallback sign-in available.
      }
    }

    return () => {
      window.removeEventListener("androidGoogleSignIn", onTokenEvent);
      if (androidWindow.onGoogleSignIn === processToken) {
        delete androidWindow.onGoogleSignIn;
      }
      if (androidWindow.handleGoogleToken === processToken) {
        delete androidWindow.handleGoogleToken;
      }
    };
  }, [handleAndroidGoogleSignIn]);

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    setErrors({});
    try {
      const androidWindow = window as AndroidWindow;
      if (androidWindow.AndroidBridge?.triggerGoogleSignIn) {
        androidWindow.AndroidBridge.triggerGoogleSignIn();
        setGoogleLoading(false);
        return;
      }

      await signIn("google", { callbackUrl: inviteCode ? `/classes/join?code=${inviteCode}` : "/classes" });
    } catch {
      setErrors({ general: t("somethingWentWrong") || "Something went wrong" });
      setGoogleLoading(false);
    }
  };

  const clearFieldError = (field: keyof FieldErrors) => {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validate = (): boolean => {
    const newErrors: FieldErrors = {};
    if (!formData.name.trim()) {
      newErrors.name = t("nameRequired") || "Name is required";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    if (!validate()) return;

    setLoading(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email || undefined,
          language,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const errMsg = data.error || t("registrationFailed");
        const errLower = errMsg.toLowerCase();
        if (errLower.includes("email") || errLower.includes("exists") || errLower.includes("already")) {
          setErrors({ email: errMsg });
        } else if (errLower.includes("name")) {
          setErrors({ name: errMsg });
        } else {
          setErrors({ general: errMsg });
        }
        return;
      }

      // Auto-sign-in after registration
      const signInResult = await signIn("auto-login", {
        userId: data.user.id,
        token: data.autoLoginToken,
        redirect: false,
      });

      if (signInResult?.error) {
        // Fallback: redirect to login if auto-sign-in fails
        router.push(inviteCode ? `/login?code=${inviteCode}` : "/login");
        return;
      }

      await joinAndRedirect();
    } catch (error) {
      setErrors({
        general: error instanceof Error ? error.message : (t("somethingWentWrong") || "Something went wrong"),
      });
    } finally {
      setLoading(false);
    }
  };

  if (isMaktab) {
    return null;
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
      {/* Top accent bar */}
      <div className="h-1 bg-blue-600 w-full" />

      {/* Header */}
      <div className="space-y-4 text-center pt-8 pb-2 px-6">
        <div className="flex justify-center animate-scale-in">
          <div className="p-4 rounded-2xl bg-blue-50 ring-1 ring-blue-100">
            <LogoIcon size={40} className="text-blue-600" />
          </div>
        </div>
        <div className="space-y-1">
          <LogoText className="text-xl justify-center flex" textColor="text-gray-900" />
          <p className="text-sm text-gray-500 mt-2">
            {t("createAccount")}
          </p>
        </div>

        {/* Language selector */}
        <div className="flex items-center justify-center gap-2 mt-3">
          <Globe className="h-3.5 w-3.5 text-gray-400" />
          {(["en", "uz", "ru"] as Language[]).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setLanguage(code)}
              className={cn(
                "px-3 py-1 text-xs font-semibold rounded-md transition-colors",
                language === code
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* General error message */}
      {errors.general && (
        <div className="mx-6 mt-2 animate-fade-in-down">
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-100 text-red-600 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errors.general}</span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 pt-6 px-6">
        {/* Google Sign In Button - Primary */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={googleLoading || loading}
          className="w-full h-11 bg-white hover:bg-gray-50 text-gray-700 text-sm font-semibold rounded-lg border !border-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
        >
          {googleLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("signingIn")}
            </>
          ) : (
            <>
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              {t("continueWithGoogle")}
            </>
          )}
        </button>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white px-2 text-gray-500">
              {t("or")}
            </span>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="space-y-4 pt-4 px-6">
          {/* Name Field */}
          <div className="space-y-2">
            <label
              htmlFor="name"
              className={cn(
                "text-sm font-medium",
                errors.name ? "text-red-600" : "text-gray-700"
              )}
            >
              {t("fullName")}
            </label>
            <input
              id="name"
              type="text"
              placeholder={t("fullNamePlaceholder")}
              value={formData.name}
              onChange={(e) => {
                setFormData({ ...formData, name: e.target.value });
                clearFieldError("name");
              }}
              disabled={loading}
              className={cn(
                "w-full h-10 px-3 rounded-lg border bg-white text-gray-900 placeholder:text-gray-400 transition-all duration-200 outline-none focus:ring-2",
                errors.name
                  ? "!border-red-300 focus:!border-red-400 focus:ring-red-100"
                  : "!border-gray-200 focus:!border-blue-400 focus:ring-blue-100",
                loading && "opacity-50 cursor-not-allowed"
              )}
            />
            {errors.name && (
              <p className="text-xs text-red-600 flex items-center gap-1 animate-fade-in-down">
                <AlertCircle className="h-3 w-3" />
                {errors.name}
              </p>
            )}
          </div>

          {/* Email Field (Optional) */}
          <div className="space-y-2">
            <label
              htmlFor="email"
              className={cn(
                "text-sm font-medium",
                errors.email ? "text-red-600" : "text-gray-700"
              )}
            >
              {t("email")} <span className="text-gray-400 font-normal">({t("optional")})</span>
            </label>
            <input
              id="email"
              type="email"
              placeholder={t("emailPlaceholder")}
              value={formData.email}
              onChange={(e) => {
                setFormData({ ...formData, email: e.target.value });
                clearFieldError("email");
              }}
              disabled={loading}
              className={cn(
                "w-full h-10 px-3 rounded-lg border bg-white text-gray-900 placeholder:text-gray-400 transition-all duration-200 outline-none focus:ring-2",
                errors.email
                  ? "!border-red-300 focus:!border-red-400 focus:ring-red-100"
                  : "!border-gray-200 focus:!border-blue-400 focus:ring-blue-100",
                loading && "opacity-50 cursor-not-allowed"
              )}
            />
            {errors.email && (
              <p className="text-xs text-red-600 flex items-center gap-1 animate-fade-in-down">
                <AlertCircle className="h-3 w-3" />
                {errors.email}
              </p>
            )}
          </div>

        </div>

        <div className="flex flex-col gap-4 p-6 pt-6">
          <button
            type="submit"
            className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("creatingAccount")}
              </>
            ) : (
              <>
                {t("createAccount")}
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>

          <p className="text-sm text-center text-gray-500">
            {t("alreadyHaveAccount")}{" "}
            <Link
              href="/login"
              className="text-blue-600 hover:text-blue-700 hover:underline font-medium transition-colors"
            >
              {t("signIn")}
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}
