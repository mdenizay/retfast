import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

/** Soft badge: tinted fill, faint border. Never carries safety meaning by color alone — pair with icon + text. */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-caption font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3.5",
  {
    variants: {
      variant: {
        default: "border-border bg-surface text-fg-secondary shadow-xs",
        primary: "border-transparent bg-primary text-on-primary",
        success: "border-success/20 bg-success/10 text-success",
        warning: "border-warning/25 bg-warning/10 text-warning",
        error: "border-error/20 bg-error/10 text-error",
        emergency: "border-emergency bg-emergency text-on-emergency",
        muted: "border-transparent bg-muted text-fg-muted",
        secondary: "border-secondary/20 bg-secondary/10 text-secondary",
        retrieval: "border-retrieval/20 bg-retrieval/10 text-retrieval",
        sim: "border-secondary/25 bg-secondary/10 font-mono tracking-wider text-secondary",
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
