import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-24 w-full rounded-xl border border-transparent bg-muted px-4 py-3 text-body text-fg transition-[color,box-shadow,border-color,background-color] outline-none placeholder:text-fg-muted",
        "focus-visible:border-ring/60 focus-visible:bg-surface focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-error",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
