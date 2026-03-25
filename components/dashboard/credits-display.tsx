"use client";

import { useRouter } from "next/navigation";
import { Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSubscriptionData } from "@/hooks/use-subscription";

export function CreditsDisplay({ className }: { className?: string }) {
  const { data, loading } = useSubscriptionData();
  const router = useRouter();

  if (loading || !data) {
    return <div className={cn("animate-pulse h-9 w-28 bg-muted rounded-lg", className)} />;
  }

  const isLow = data.credits <= 3 && data.subscription === "FREE";
  const isEmpty = data.credits === 0;

  return (
    <button
      onClick={() => router.push("/shop")}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-sm",
        "hover:bg-muted",
        isEmpty && "bg-destructive/5",
        isLow && !isEmpty && "bg-warning/5",
        className
      )}
    >
      <Coins className={cn(
        "h-4 w-4",
        isEmpty ? "text-destructive" : isLow ? "text-warning" : "text-primary"
      )} />
      <span className="font-semibold">{data.credits === -1 ? "\u221E" : data.credits}</span>
    </button>
  );
}
