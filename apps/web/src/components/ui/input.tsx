import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-body text-fg tnum shadow-xs transition-[color,box-shadow,border-color] outline-none placeholder:text-fg-muted dark:bg-muted/40",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-error aria-invalid:ring-error/20",
        "file:border-0 file:bg-transparent file:text-footnote file:font-medium",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
