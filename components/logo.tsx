"use client";

import { cn } from "@/lib/utils";

interface LogoIconProps {
  className?: string;
  size?: number;
  variant?: "brand" | "mono";
}

const BOOK_STROKE = "#41BBC6";
const CHECK_STROKE = "#184A86";
const DOT_FILL = "#FDB345";

// Bahola mark: open book + checkmark + accent dot
export function LogoIcon({ className, size = 32, variant = "brand" }: LogoIconProps) {
  const bookStroke = variant === "mono" ? "currentColor" : BOOK_STROKE;
  const checkStroke = variant === "mono" ? "currentColor" : CHECK_STROKE;
  const dotFill = variant === "mono" ? "currentColor" : DOT_FILL;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M18 24V74C30 72 40 75 48 82"
        stroke={bookStroke}
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M78 24V74C66 72 56 75 48 82"
        stroke={bookStroke}
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 24C30 22 40 26 48 36"
        stroke={bookStroke}
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M78 24C66 22 56 26 48 36"
        stroke={bookStroke}
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M31 48L45 63L78 24"
        stroke={checkStroke}
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="48" cy="43.5" r="4.75" fill={dotFill} />
    </svg>
  );
}

interface LogoTextProps {
  className?: string;
  collapsed?: boolean;
}

export function LogoText({ className, collapsed, textColor }: LogoTextProps & { textColor?: string }) {
  if (collapsed) return null;

  return (
    <span
      className={cn(
        "text-lg font-semibold tracking-tight whitespace-nowrap",
        textColor || "text-[#184A86]",
        className
      )}
    >
      Bahola
    </span>
  );
}

interface LogoProps {
  collapsed?: boolean;
  className?: string;
  iconSize?: number;
}

export function Logo({ collapsed, className, iconSize = 32 }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-[#41BBC6]/10 shrink-0">
        <LogoIcon size={iconSize} />
      </div>
      <LogoText collapsed={collapsed} />
    </div>
  );
}
