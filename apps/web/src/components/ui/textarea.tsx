import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-24 w-full rounded-md border border-border bg-surface px-3 py-2.5 text-body text-fg shadow-xs transition-[color,box-shadow,border-color] outline-none placeholder:text-fg-muted dark:bg-muted/40",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-error",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
