import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive/15 text-destructive border-destructive/20",
        outline: "text-foreground border-border",
        success:
          "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-500 border-emerald-500/20",
        warning:
          "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-500 border-amber-500/20",
        info:
          "border-transparent bg-blue-500/15 text-blue-700 dark:text-blue-500 border-blue-500/20",
        // Status-specific variants for assessments
        pending:
          "border-transparent bg-slate-500/15 text-slate-700 dark:text-slate-500 border-slate-500/20",
        processing:
          "border-transparent bg-blue-500/15 text-blue-700 dark:text-blue-500 border-blue-500/20",
        graded:
          "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-500 border-emerald-500/20",
        late:
          "border-transparent bg-orange-500/15 text-orange-700 dark:text-orange-500 border-orange-500/20",
        draft:
          "border-transparent bg-slate-500/10 text-slate-600 dark:text-slate-500 border-slate-500/20",
        error:
          "border-transparent bg-red-500/15 text-red-700 dark:text-red-500 border-red-500/20",
      },
      size: {
        default: "px-2.5 py-0.5 text-xs",
        sm: "px-2 py-0.5 text-[10px]",
        lg: "px-3 py-1 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /** Optional dot indicator before text */
  withDot?: boolean;
}

function Badge({ className, variant, size, withDot, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {withDot && (
        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      )}
      {children}
    </div>
  );
}

export { Badge, badgeVariants };
