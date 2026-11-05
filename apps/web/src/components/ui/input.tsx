import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-12 w-full min-w-0 rounded-xl border border-transparent bg-muted px-4 text-body text-fg tnum transition-[color,box-shadow,border-color,background-color] outline-none placeholder:text-fg-muted",
        "focus-visible:border-ring/60 focus-visible:bg-surface focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-error aria-invalid:ring-error/20",
        "file:border-0 file:bg-transparent file:text-footnote file:font-medium",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
