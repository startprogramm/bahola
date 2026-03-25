"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn, getSession } from "next-auth/react";
import { Eye, EyeOff, AlertCircle, Loader2, ArrowRight, Building2, Send, ArrowLeft, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/language-context";
import type { Language } from "@/lib/i18n/translations";
import { LogoIcon, LogoText } from "@/components/logo";

const isMaktab = process.env.NEXT_PUBLIC_APP_MODE === "maktab";

interface FieldErrors {
  email?: string;
  password?: string;
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

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteCode = searchParams.get("code");
  const authError = searchParams.get("error");
  const { t, language, setLanguage } = useLanguage();

  // Maktab inquiry form state
  const [showInquiry, setShowInquiry] = useState(false);
  const [inquirySubmitted, setInquirySubmitted] = useState(false);
  const [inquiryLoading, setInquiryLoading] = useState(false);
  const [inquiryError, setInquiryError] = useState("");
  const [inquiryData, setInquiryData] = useState({
    schoolNumber: "",
    location: "",
    studentCount: "",
    teacherCount: "",
    phone: "+998",
    telegram: "",
  });

  // After successful sign-in, join class if invite code present, then redirect
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
        // fall through to default redirect
      }
    }
    // Check role for redirect destination
    const freshSession = await getSession();
    if (freshSession?.user?.role === "DIRECTOR") {
      router.push("/director");
    } else {
      router.push("/classes");
    }
    router.refresh();
  }, [inviteCode, router]);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const processedAndroidTokenRef = useRef<string | null>(null);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });

  useEffect(() => {
    if (!authError) return;

    const decodedError = decodeURIComponent(authError).replace(/\+/g, " ");
    if (!decodedError) return;

    setErrors((prev) => ({
      ...prev,
      general:
        decodedError === "AccessDenied"
          ? "Access denied"
          : decodedError,
    }));
  }, [authError]);

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
    [joinAndRedirect, inviteCode, router, t]
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
    if (!formData.email.trim()) {
      newErrors.email = t("emailRequired") || "Email is required";
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = t("invalidEmail") || "Please enter a valid email";
    }
    if (!formData.password) {
      newErrors.password = t("passwordRequired") || "Password is required";
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
      const result = await signIn("credentials", {
        email: formData.email,
        password: formData.password,
        redirect: false,
      });

      if (result?.error) {
        const errorMsg = result.error === "CredentialsSignin"
          ? (t("invalidCredentials") || "Invalid email or password")
          : result.error;

        const errLower = errorMsg.toLowerCase();
        if (errLower.includes("email") || errLower.includes("user") || errLower.includes("not found") || errLower.includes("no user")) {
          setErrors({ email: errorMsg });
        } else if (errLower.includes("password") || errLower.includes("incorrect") || errLower.includes("wrong")) {
          setErrors({ password: errorMsg });
        } else {
          setErrors({ general: errorMsg });
        }
      } else {
        await joinAndRedirect();
      }
    } catch {
      setErrors({ general: t("somethingWentWrong") || "Something went wrong. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg overflow-hidden">

      {/* Language selector */}
      <div className="flex justify-center gap-1 pt-4 px-6">
        {(["en", "uz", "ru"] as Language[]).map((lang) => (
          <button
            key={lang}
            onClick={() => setLanguage(lang)}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium transition-colors",
              language === lang
                ? "bg-blue-100 text-blue-700"
                : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
            )}
          >
            {lang === "en" ? "EN" : lang === "uz" ? "UZ" : "RU"}
          </button>
        ))}
      </div>

      {/* Header */}
      <div className="space-y-4 text-center pt-6 pb-4 px-6">
        <div className="flex justify-center animate-scale-in">
          <div className="p-4 rounded-2xl bg-blue-50 ring-1 ring-blue-100">
            <LogoIcon size={40} className="text-blue-600" />
          </div>
        </div>
        <div className="space-y-1">
          <LogoText className="text-xl justify-center flex" textColor="text-gray-900" />
        </div>
      </div>

      {/* General error message */}
      {errors.general && (
        <div className="mx-6 mt-2 animate-fade-in-down">
          {(() => {
            const urlMatch = errors.general.match(/(https?:\/\/[^\s.]+(?:\.[^\s.]+)*)/);
            if (urlMatch) {
              const url = urlMatch[1];
              const parts = errors.general.split(url);
              return (
                <div className="flex flex-col items-center gap-3 px-4 py-4 rounded-lg bg-red-50 border border-red-100 text-red-600 text-sm">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{parts[0]}</span>
                  </div>
                  <a
                    href={url}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
                  >
                    <ArrowRight className="h-4 w-4" />
                    {t("signIn")} — {url.replace(/^https?:\/\//, "").replace(/\/login$/, "")}
                  </a>
                </div>
              );
            }
            return (
              <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-100 text-red-600 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{errors.general}</span>
              </div>
            );
          })()}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="space-y-4 pt-4 px-6">
          {/* Email / Username Field */}
          <div className="space-y-2">
            <label
              htmlFor="email"
              className={cn(
                "text-sm font-medium",
                errors.email ? "text-red-600" : "text-gray-700"
              )}
            >
              {isMaktab ? "Login" : t("email")}
            </label>
            <div className="relative">
              <input
                id="email"
                type={isMaktab ? "text" : "email"}
                placeholder={isMaktab ? "login@maktab.uz" : t("emailPlaceholder")}
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
            </div>
            {errors.email && (
              <p className="text-xs text-red-600 flex items-center gap-1 animate-fade-in-down">
                <AlertCircle className="h-3 w-3" />
                {errors.email}
              </p>
            )}
          </div>

          {/* Password Field */}
          <div className="space-y-2">
            <label
              htmlFor="password"
              className={cn(
                "text-sm font-medium",
                errors.password ? "text-red-600" : "text-gray-700"
              )}
            >
              {t("password")}
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder={t("enterPassword")}
                value={formData.password}
                onChange={(e) => {
                  setFormData({ ...formData, password: e.target.value });
                  clearFieldError("password");
                }}
                disabled={loading}
                className={cn(
                  "w-full h-10 px-3 pr-10 rounded-lg border bg-white text-gray-900 placeholder:text-gray-400 transition-all duration-200 outline-none focus:ring-2",
                  errors.password
                    ? "!border-red-300 focus:!border-red-400 focus:ring-red-100"
                    : "!border-gray-200 focus:!border-blue-400 focus:ring-blue-100",
                  loading && "opacity-50 cursor-not-allowed"
                )}
              />
              <button
                type="button"
                className="absolute right-0 top-0 h-full px-3 text-gray-400 hover:text-gray-600 transition-colors"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {errors.password && (
              <p className="text-xs text-red-600 flex items-center gap-1 animate-fade-in-down">
                <AlertCircle className="h-3 w-3" />
                {errors.password}
              </p>
            )}
            {!isMaktab && (
              <div className="flex justify-end">
                <Link
                  href="/forgot-password"
                  className="text-xs text-blue-600 hover:text-blue-700 hover:underline transition-colors"
                >
                  {t("forgotPassword")}
                </Link>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 p-6 pt-6 pb-8">
          <button
            type="submit"
            className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("signingIn")}
              </>
            ) : (
              <>
                {t("signIn")}
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>

          {/* Divider + Google + Register — hidden on maktab */}
          {!isMaktab && (
            <>
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

              {/* Google Sign In Button */}
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

              <p className="text-sm text-center text-gray-500">
                {t("dontHaveAccount")}{" "}
                <Link
                  href="/register"
                  className="text-blue-600 hover:text-blue-700 hover:underline font-medium transition-colors"
                >
                  {t("signUp")}
                </Link>
              </p>
            </>
          )}

          {/* Maktab: Director inquiry button */}
          {isMaktab && (
            <>
              <button
                type="button"
                onClick={() => setShowInquiry(true)}
                className="w-full h-11 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-sm font-semibold rounded-lg border border-emerald-200 transition-colors flex items-center justify-center gap-2"
              >
                <Building2 className="h-4 w-4" />
                {t("dirInquiryTitle")}
              </button>
            </>
          )}
        </div>
      </form>

      {/* Maktab inquiry modal */}
      {isMaktab && showInquiry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !inquiryLoading && setShowInquiry(false)}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-1 bg-emerald-600 w-full rounded-t-2xl" />

            {inquirySubmitted ? (
              <div className="p-8 text-center space-y-4">
                <div className="flex justify-center">
                  <div className="p-3 rounded-full bg-emerald-50">
                    <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                  </div>
                </div>
                <h3 className="text-lg font-bold text-gray-900">{t("dirInquirySuccess")}</h3>
                <p className="text-sm text-gray-500">{t("dirInquirySuccessDesc")}</p>
                <button
                  onClick={() => { setShowInquiry(false); setInquirySubmitted(false); }}
                  className="mt-4 px-6 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors"
                >
                  {t("dirClose")}
                </button>
              </div>
            ) : (
              <>
                <div className="px-6 pt-6 pb-3">
                  <button
                    onClick={() => setShowInquiry(false)}
                    className="text-gray-400 hover:text-gray-600 transition-colors mb-3"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <h3 className="text-lg font-bold text-gray-900">{t("dirInquiryFormTitle")}</h3>
                  <p className="text-sm text-gray-500 mt-1">{t("dirInquiryFormDesc")}</p>
                </div>

                {inquiryError && (
                  <div className="mx-6 mb-2">
                    <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-100 text-red-600 text-sm">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>{inquiryError}</span>
                    </div>
                  </div>
                )}

                <div className="px-6 pb-6 space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">{t("dirInquirySchoolName")}</label>
                    <input
                      type="text"
                      placeholder={t("dirInquirySchoolPlaceholder")}
                      value={inquiryData.schoolNumber}
                      onChange={(e) => setInquiryData({ ...inquiryData, schoolNumber: e.target.value })}
                      className="w-full h-10 px-3 rounded-lg border !border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:!border-blue-400 focus:ring-blue-100 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">{t("dirInquiryLocation")}</label>
                    <input
                      type="text"
                      placeholder={t("dirInquiryLocationPlaceholder")}
                      value={inquiryData.location}
                      onChange={(e) => setInquiryData({ ...inquiryData, location: e.target.value })}
                      className="w-full h-10 px-3 rounded-lg border !border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:!border-blue-400 focus:ring-blue-100 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-gray-700">{t("dirInquiryStudentCount")}</label>
                      <input
                        type="number"
                        placeholder="500"
                        value={inquiryData.studentCount}
                        onChange={(e) => setInquiryData({ ...inquiryData, studentCount: e.target.value })}
                        className="w-full h-10 px-3 rounded-lg border !border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:!border-blue-400 focus:ring-blue-100 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-gray-700">{t("dirInquiryTeacherCount")}</label>
                      <input
                        type="number"
                        placeholder="30"
                        value={inquiryData.teacherCount}
                        onChange={(e) => setInquiryData({ ...inquiryData, teacherCount: e.target.value })}
                        className="w-full h-10 px-3 rounded-lg border !border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:!border-blue-400 focus:ring-blue-100 text-sm"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">{t("dirInquiryPhone")}</label>
                    <input
                      type="tel"
                      placeholder="+998 90 123 45 67"
                      value={inquiryData.phone}
                      onChange={(e) => setInquiryData({ ...inquiryData, phone: e.target.value })}
                      className="w-full h-10 px-3 rounded-lg border !border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:!border-blue-400 focus:ring-blue-100 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">{t("dirInquiryTelegram")}</label>
                    <input
                      type="text"
                      placeholder="@username"
                      value={inquiryData.telegram}
                      onChange={(e) => setInquiryData({ ...inquiryData, telegram: e.target.value })}
                      className="w-full h-10 px-3 rounded-lg border !border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:!border-blue-400 focus:ring-blue-100 text-sm"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={inquiryLoading}
                    onClick={async () => {
                      setInquiryError("");
                      if (!inquiryData.schoolNumber.trim() || !inquiryData.phone.trim()) {
                        setInquiryError(t("dirInquiryPhoneRequired"));
                        return;
                      }
                      setInquiryLoading(true);
                      try {
                        const res = await fetch("/api/school-inquiry", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(inquiryData),
                        });
                        if (!res.ok) {
                          const data = await res.json();
                          setInquiryError(data.error || t("dirInquiryError"));
                        } else {
                          setInquirySubmitted(true);
                        }
                      } catch {
                        setInquiryError(t("dirInquiryNetworkError"));
                      } finally {
                        setInquiryLoading(false);
                      }
                    }}
                    className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-4"
                  >
                    {inquiryLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("dirInquirySubmitting")}
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        {t("dirInquirySubmit")}
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
