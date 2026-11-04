import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-12 w-full min-w-0 rounded-md border border-border bg-surface px-3 text-body text-fg tnum transition-colors outline-none placeholder:text-fg-muted",
        "focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus/40",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-error",
        "file:border-0 file:bg-transparent file:text-footnote file:font-medium",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
