import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

/** Aero badge: square-ish, hairline, uppercase-friendly. Never carries safety meaning by color alone — pair with icon + text. */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-[6px] border px-1.5 py-0.5 text-caption font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3.5",
  {
    variants: {
      variant: {
        default: "border-border bg-surface text-fg-secondary",
        primary: "border-primary/40 bg-primary/10 text-primary",
        success: "border-success/40 bg-success/10 text-success",
        warning: "border-warning/50 bg-warning/10 text-warning",
        error: "border-error/50 bg-error/10 text-error",
        emergency: "border-emergency bg-emergency text-on-emergency",
        muted: "border-border bg-transparent text-fg-muted",
        secondary: "border-secondary/50 bg-secondary/10 text-secondary",
        retrieval: "border-retrieval/50 bg-retrieval/10 text-retrieval",
        sim: "border-secondary/60 bg-secondary/10 font-mono tracking-wider text-secondary",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";
  return <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
