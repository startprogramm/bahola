import * as React from "react";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 px-4 text-center animate-fade-in-up",
        className
      )}
    >
      <div className="rounded-full bg-muted/50 p-4 mb-4 animate-scale-in">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-base font-medium text-foreground mb-1 animate-fade-in">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-muted-foreground max-w-sm mb-4 animate-fade-in">
          {description}
        </p>
      )}
      {action && (
        <div className="mt-2 animate-fade-in-up">
          {action}
        </div>
      )}
    </div>
  );
}
