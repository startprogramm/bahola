"use client";

import { useState, useEffect, type ComponentType } from "react";

/**
 * Renders a lightweight static button initially.
 * Only loads the full AI assistant (KaTeX, react-markdown, framer-motion)
 * when the user clicks the button — saving ~350KB from initial page load.
 *
 * Uses raw import() instead of next/dynamic to prevent Next.js from
 * prefetching the heavy chunks on page load.
 */
export function AIAssistantLazy() {
  const [Component, setComponent] = useState<ComponentType<{ autoOpen?: boolean }> | null>(null);

  const handleClick = () => {
    import(/* webpackPrefetch: false, webpackPreload: false */ "@/components/ai-assistant").then((m) => {
      setComponent(() => m.AIAssistant);
    });
  };

  if (Component) {
    return <Component autoOpen />;
  }

  // Lightweight trigger — no heavy dependencies
  return (
    <button
      onClick={handleClick}
      aria-label="Open AI Assistant"
      className="fixed z-50 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all duration-200"
      style={{
        bottom: 24,
        right: 24,
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
        <path d="M20 3v4" />
        <path d="M22 5h-4" />
      </svg>
    </button>
  );
}
