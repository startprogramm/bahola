"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/lib/theme-provider";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateCachedTheme } from "@/hooks/use-sound-effects";

export function ThemeSelector() {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleTheme = () => {
    const newTheme = resolvedTheme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    updateCachedTheme(newTheme as Parameters<typeof updateCachedTheme>[0]);
    // Still dispatch the custom event if other legacy components like ThemeBackground depend on it
    window.dispatchEvent(new CustomEvent("theme-change", { detail: newTheme }));
  };

  if (!mounted) {
    return (
      <button className="h-9 w-9 rounded-md" disabled>
        <Sun className="h-5 w-5" />
      </button>
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(
        "inline-flex items-center justify-center h-9 w-9 rounded-md text-sm font-medium transition-all",
        "hover:bg-accent hover:text-accent-foreground hover-glow btn-press",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <div className="relative w-5 h-5">
        <Sun
          className={cn(
            "absolute inset-0 h-5 w-5 transition-all duration-300",
            isDark ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
          )}
        />
        <Moon
          className={cn(
            "absolute inset-0 h-5 w-5 transition-all duration-300",
            isDark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0"
          )}
        />
      </div>
    </button>
  );
}
