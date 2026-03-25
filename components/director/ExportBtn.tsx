"use client";

import { Download } from "lucide-react";

interface ExportBtnProps {
  onClick: () => void;
  label?: string;
  variant?: "icon" | "text";
  title?: string;
}

export function ExportBtn({ onClick, label = "Export", variant = "icon", title }: ExportBtnProps) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors text-xs px-1.5 py-1 rounded hover:bg-muted"
    >
      <Download className="h-3.5 w-3.5 shrink-0" />
      {variant === "text" && <span>{label}</span>}
    </button>
  );
}
