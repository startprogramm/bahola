"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { ArrowLeft, Mail, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/i18n/language-context";
import { LogoIcon, LogoText } from "@/components/logo";

type Step = "email" | "code";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { t } = useLanguage();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Countdown timer for resend
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  // Focus first code input when step changes to code
  useEffect(() => {
    if (step === "code") {
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    }
  }, [step]);

  const handleSendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError("");

    if (!email.trim()) {
      setError(t("emailRequired"));
      return;
    }

    if (!/\S+@\S+\.\S+/.test(email)) {
      setError(t("invalidEmail"));
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Something went wrong");
      }

      setStep("code");
      setResendCooldown(60);
      setSuccess(t("codeSentToEmail"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("somethingWentWrong"));
    } finally {
      setLoading(false);
    }
  };

  const handleCodeChange = (index: number, value: string) => {
    // Only allow digits
    const digit = value.replace(/\D/g, "").slice(-1);
    const newCode = [...code];
    newCode[index] = digit;
    setCode(newCode);
    setError("");

    // Auto-advance to next input
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits entered
    if (digit && index === 5) {
      const fullCode = newCode.join("");
      if (fullCode.length === 6) {
        handleVerifyCode(fullCode);
      }
    }
  };

  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleCodePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pastedText.length === 0) return;

    const newCode = [...code];
    for (let i = 0; i < pastedText.length && i < 6; i++) {
      newCode[i] = pastedText[i];
    }
    setCode(newCode);

    // Focus the next empty input or last input
    const nextEmpty = newCode.findIndex((d) => !d);
    const focusIndex = nextEmpty === -1 ? 5 : nextEmpty;
    inputRefs.current[focusIndex]?.focus();

    // Auto-submit if all 6 digits pasted
    if (pastedText.length === 6) {
      handleVerifyCode(pastedText);
    }
  };

  const handleVerifyCode = useCallback(
    async (fullCode: string) => {
      setLoading(true);
      setError("");

      try {
        // Step 1: Verify the code and get auto-login token
        const verifyResponse = await fetch("/api/auth/verify-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), code: fullCode }),
        });

        const verifyData = await verifyResponse.json();

        if (!verifyResponse.ok) {
          throw new Error(verifyData.error || "Invalid code");
        }

        // Step 2: Use the auto-login token to sign in
        setSuccess(t("codeVerified"));

        const result = await signIn("auto-login", {
          userId: verifyData.userId,
          token: verifyData.token,
          redirect: false,
        });

        if (result?.error) {
          throw new Error(result.error);
        }

        // Step 3: Redirect to classes page
        setSuccess(t("loginSuccess"));
        setTimeout(() => {
          router.push("/classes");
          router.refresh();
        }, 500);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("somethingWentWrong"));
        // Clear code on error so user can retry
        setCode(["", "", "", "", "", ""]);
        setTimeout(() => inputRefs.current[0]?.focus(), 100);
      } finally {
        setLoading(false);
      }
    },
    [email, router, t]
  );

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setError("");
    setSuccess("");
    setCode(["", "", "", "", "", ""]);
    await handleSendCode();
  };

  return (
    <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
      {/* Top accent bar */}
      <div className="h-1 bg-blue-600 w-full" />

      {/* Header */}
      <div className="space-y-4 text-center pt-10 pb-2 px-6">
        <div className="flex justify-center animate-scale-in">
          <div className="p-4 rounded-2xl bg-blue-50 ring-1 ring-blue-100">
            {step === "email" ? (
              <Mail className="h-10 w-10 text-blue-600" />
            ) : (
              <LogoIcon size={40} className="text-blue-600" />
            )}
          </div>
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-gray-900">
            {step === "email" ? t("forgotPasswordTitle") : t("enterCode")}
          </h1>
          <p className="text-sm text-gray-500">
            {step === "email"
              ? t("forgotPasswordDescription")
              : t("enterCodeDescription")}
          </p>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="mx-6 mt-3 animate-fade-in-down">
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-100 text-red-600 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Success message */}
      {success && !error && (
        <div className="mx-6 mt-3 animate-fade-in-down">
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-green-50 border border-green-100 text-green-700 text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{success}</span>
          </div>
        </div>
      )}

      {/* Step 1: Email entry */}
      {step === "email" && (
        <form onSubmit={handleSendCode}>
          <div className="px-6 pt-4 pb-2">
            <div className="space-y-2">
              <label
                htmlFor="forgot-email"
                className={cn(
                  "text-sm font-medium",
                  error ? "text-red-600" : "text-gray-700"
                )}
              >
                {t("email")}
              </label>
              <input
                id="forgot-email"
                type="email"
                placeholder={t("emailPlaceholder")}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError("");
                }}
                disabled={loading}
                autoFocus
                className={cn(
                  "w-full h-10 px-3 rounded-lg border bg-white text-gray-900 placeholder:text-gray-400 transition-all duration-200 outline-none focus:ring-2",
                  error
                    ? "!border-red-300 focus:!border-red-400 focus:ring-red-100"
                    : "!border-gray-200 focus:!border-blue-400 focus:ring-blue-100",
                  loading && "opacity-50 cursor-not-allowed"
                )}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 p-6 pt-4 pb-8">
            <button
              type="submit"
              className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("sending")}
                </>
              ) : (
                t("sendCode")
              )}
            </button>

            <Link
              href="/login"
              className="flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {t("backToSignIn")}
            </Link>
          </div>
        </form>
      )}

      {/* Step 2: Code entry */}
      {step === "code" && (
        <div className="px-6 pt-4 pb-8">
          {/* Email display */}
          <p className="text-center text-sm text-gray-500 mb-4">
            {email}
          </p>

          {/* 6-digit code inputs */}
          <div className="flex justify-center gap-2 mb-6" onPaste={handleCodePaste}>
            {code.map((digit, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleCodeChange(i, e.target.value)}
                onKeyDown={(e) => handleCodeKeyDown(i, e)}
                disabled={loading}
                className={cn(
                  "w-11 h-13 text-center text-xl font-bold rounded-lg border bg-white text-gray-900 transition-all duration-200 outline-none focus:ring-2",
                  error
                    ? "!border-red-300 focus:!border-red-400 focus:ring-red-100"
                    : "!border-gray-200 focus:!border-blue-400 focus:ring-blue-100",
                  loading && "opacity-50 cursor-not-allowed"
                )}
              />
            ))}
          </div>

          {/* Loading indicator */}
          {loading && (
            <div className="flex items-center justify-center gap-2 text-sm text-blue-600 mb-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("verifying")}
            </div>
          )}

          {/* Resend code */}
          <div className="text-center mb-4">
            {resendCooldown > 0 ? (
              <p className="text-xs text-gray-400">
                {t("resendCodeIn")} {resendCooldown}s
              </p>
            ) : (
              <button
                type="button"
                onClick={handleResend}
                disabled={loading}
                className="text-xs text-blue-600 hover:text-blue-700 hover:underline transition-colors disabled:opacity-50"
              >
                {t("resendCode")}
              </button>
            )}
          </div>

          {/* Change email */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode(["", "", "", "", "", ""]);
                setError("");
                setSuccess("");
              }}
              className="flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {t("changeEmail")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
