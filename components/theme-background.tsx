"use client";

import { memo, useEffect, useState } from "react";
import { useTheme } from "@/lib/theme-provider";

const LightPattern = memo(function LightPattern() {
  return (
    <>
      {/* Subtle blue glow top-right */}
      <div
        className="absolute -top-[10%] -right-[5%] w-[40%] h-[40%] rounded-full opacity-[0.04]"
        style={{ background: "radial-gradient(circle, #2563eb 0%, transparent 70%)", filter: "blur(80px)", willChange: "transform" }}
      />
      {/* Subtle cyan glow bottom-left */}
      <div
        className="absolute -bottom-[10%] -left-[5%] w-[35%] h-[35%] rounded-full opacity-[0.03]"
        style={{ background: "radial-gradient(circle, #0ea5e9 0%, transparent 70%)", filter: "blur(80px)", willChange: "transform" }}
      />
      {/* Dot pattern */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.02]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="light-dots" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="0.8" fill="#2563eb" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#light-dots)" />
      </svg>
    </>
  );
});

const DarkPattern = memo(function DarkPattern() {
  return (
    <>
      {/* Blue glow top-left */}
      <div
        className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full opacity-[0.06]"
        style={{ background: "radial-gradient(circle, #3b82f6 0%, transparent 70%)", filter: "blur(80px)", willChange: "transform" }}
      />
      {/* Steel blue glow bottom-right */}
      <div
        className="absolute -bottom-[20%] -right-[10%] w-[50%] h-[50%] rounded-full opacity-[0.04]"
        style={{ background: "radial-gradient(circle, #0ea5e9 0%, transparent 70%)", filter: "blur(80px)", willChange: "transform" }}
      />
      {/* Subtle grid */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.03]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="dark-grid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#3b82f6" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dark-grid)" />
      </svg>
    </>
  );
});

const patternMap: Record<string, React.ComponentType> = {
  light: LightPattern,
  dark: DarkPattern,
};

export const ThemeBackground = memo(function ThemeBackground() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none" style={{ contain: "strict" }} />
    );
  }

  const currentTheme = resolvedTheme === "dark" ? "dark" : "light";
  const Pattern = patternMap[currentTheme];

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none" style={{ contain: "strict" }}>
      {Pattern && <Pattern />}
    </div>
  );
});
