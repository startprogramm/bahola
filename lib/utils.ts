import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateClassCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function getUserAvatarColor(name: string): string {
  const colors = [
    "#ef4444", // red-500
    "#f97316", // orange-500
    "#eab308", // yellow-500
    "#22c55e", // green-500
    "#06b6d4", // cyan-500
    "#3b82f6", // blue-500
    "#6366f1", // indigo-500
    "#a855f7", // violet-500
    "#ec4899", // pink-500
  ];

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

export function getScoreColor(score: number, maxScore: number): string {
  const percentage = (score / maxScore) * 100;
  if (percentage >= 80) return "text-green-800 dark:text-green-500";
  if (percentage >= 60) return "text-amber-800 dark:text-amber-500";
  if (percentage >= 40) return "text-orange-700 dark:text-orange-500";
  return "text-red-800 dark:text-red-500";
}

export function getScoreBgColor(score: number, maxScore: number): string {
  const percentage = (score / maxScore) * 100;
  if (percentage >= 80) return "bg-green-200 dark:bg-green-700/70";
  if (percentage >= 60) return "bg-amber-200 dark:bg-amber-700/70";
  if (percentage >= 40) return "bg-orange-200 dark:bg-orange-700/70";
  return "bg-red-200 dark:bg-red-700/70";
}

/**
 * Normalize image URLs to work across different environments.
 *
 * Images (jpg/png/gif/webp/heic) are served as static files from /uploads/ — no auth needed.
 * PDFs and Word docs route through /api/uploads/ for on-the-fly Word→PDF conversion.
 * Middleware already excludes /uploads/ from auth checks (matcher in middleware.ts).
 */
export function normalizeImageUrl(url: string | null | undefined): string {
  if (!url) return "";

  // Handle localhost URLs - extract just the path
  if (url.includes('localhost') && url.includes('/uploads/')) {
    const uploadsIndex = url.indexOf('/uploads/');
    url = url.substring(uploadsIndex);
  }

  if (url.startsWith('/uploads/')) {
    // Only route PDFs and Word docs through /api/uploads/ (need server-side conversion)
    const lower = url.toLowerCase();
    if (lower.endsWith('.pdf') || lower.endsWith('.doc') || lower.endsWith('.docx')) {
      return url.replace('/uploads/', '/api/uploads/');
    }
    // Images served directly as static files — faster, no DB auth overhead
    return url;
  }

  return url;
}
