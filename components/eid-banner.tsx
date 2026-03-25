"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n/language-context";

/**
 * One-day Eid celebration banner. Only renders on March 20, 2026 (Eid al-Fitr).
 * Automatically hides itself the next day — no manual cleanup needed.
 */

const EID_DATE = "2026-03-20";

function isEidDay(): boolean {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}` === EID_DATE;
}

// Crescent moon + star SVG inline
function CrescentMoon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M42 8C30.954 8 22 16.954 22 28s8.954 20 20 20c3.87 0 7.49-1.1 10.56-3A24 24 0 1128 4a24 24 0 0014 4z"
        fill="currentColor"
        opacity="0.9"
      />
      <path
        d="M46 16l1.76 3.57 3.94.57-2.85 2.78.67 3.93L46 25.07l-3.52 1.78.67-3.93-2.85-2.78 3.94-.57L46 16z"
        fill="currentColor"
      />
    </svg>
  );
}

function StarSparkle({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 2l2.09 6.26L20.18 9.27l-5.09 3.7 1.95 6.3L12 15.77l-5.04 3.5 1.95-6.3-5.09-3.7 6.09-1.01L12 2z" />
    </svg>
  );
}

export function EidBanner({ variant = "landing" }: { variant?: "landing" | "dashboard" }) {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    if (isEidDay()) {
      const wasDismissed = sessionStorage.getItem("eid-banner-dismissed") === "true";
      if (!wasDismissed) {
        setVisible(true);
      }
    }
  }, []);

  if (!visible || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem("eid-banner-dismissed", "true");
  };

  const greeting = t("eidMubarak");
  const subtitle = t("eidSubtitle");

  if (variant === "landing") {
    return (
      <div className="relative overflow-hidden bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-600">
        {/* Decorative stars */}
        <StarSparkle
          className="absolute left-[5%] top-1 h-3 w-3 text-yellow-300/40 animate-pulse"
          style={{ animationDelay: "0s" }}
        />
        <StarSparkle
          className="absolute left-[15%] top-3 h-2 w-2 text-yellow-300/30 animate-pulse"
          style={{ animationDelay: "0.5s" }}
        />
        <StarSparkle
          className="absolute right-[10%] top-1.5 h-2.5 w-2.5 text-yellow-300/35 animate-pulse"
          style={{ animationDelay: "1s" }}
        />
        <StarSparkle
          className="absolute right-[22%] top-3 h-2 w-2 text-yellow-300/25 animate-pulse"
          style={{ animationDelay: "1.5s" }}
        />

        <div className="mx-auto flex max-w-6xl items-center justify-center gap-3 px-4 py-2.5 sm:py-3">
          <CrescentMoon className="h-5 w-5 sm:h-6 sm:w-6 text-yellow-300 shrink-0" />
          <div className="flex items-center gap-2 text-center">
            <span className="text-sm sm:text-base font-semibold text-yellow-100">
              {greeting}
            </span>
            <span className="hidden sm:inline text-sm text-emerald-100/80">
              —
            </span>
            <span className="hidden sm:inline text-sm text-emerald-100/80">
              {subtitle}
            </span>
          </div>
          <CrescentMoon className="h-5 w-5 sm:h-6 sm:w-6 text-yellow-300 shrink-0 scale-x-[-1]" />

          <button
            onClick={handleDismiss}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-200/60 hover:text-white transition-colors"
            aria-label="Close"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // Dashboard variant — a card-style greeting
  return (
    <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-600 px-4 sm:px-6 py-4 sm:py-5 mb-4">
      {/* Decorative background elements */}
      <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-yellow-300/10 blur-2xl" />
      <div className="pointer-events-none absolute -left-4 -bottom-4 h-24 w-24 rounded-full bg-emerald-400/20 blur-xl" />

      {/* Stars scattered */}
      <StarSparkle
        className="absolute right-[8%] top-2 h-3 w-3 text-yellow-300/30 animate-pulse"
        style={{ animationDelay: "0s" }}
      />
      <StarSparkle
        className="absolute right-[18%] bottom-2 h-2.5 w-2.5 text-yellow-300/25 animate-pulse"
        style={{ animationDelay: "0.7s" }}
      />
      <StarSparkle
        className="absolute left-[30%] top-1.5 h-2 w-2 text-yellow-300/20 animate-pulse"
        style={{ animationDelay: "1.3s" }}
      />

      <div className="relative flex items-center gap-3 sm:gap-4">
        <CrescentMoon className="h-8 w-8 sm:h-10 sm:w-10 text-yellow-300 shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="text-lg sm:text-xl font-bold text-yellow-100">
            {greeting}
          </h2>
          <p className="text-sm text-emerald-100/80 mt-0.5">
            {subtitle}
          </p>
        </div>
        <button
          onClick={handleDismiss}
          className="text-emerald-200/60 hover:text-white transition-colors shrink-0 self-start"
          aria-label="Close"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
