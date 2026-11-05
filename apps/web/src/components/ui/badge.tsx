import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

/** Pill badge: tinted fill, no border. Never carries safety meaning by color alone — pair with icon + text. */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-caption leading-none font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-muted text-fg-secondary",
        primary: "bg-primary text-on-primary",
        success: "bg-success/12 text-success",
        warning: "bg-warning/14 text-warning",
        error: "bg-error/12 text-error",
        emergency: "bg-emergency text-on-emergency",
        muted: "bg-muted text-fg-muted",
        secondary: "bg-brand/12 text-brand",
        retrieval: "bg-retrieval/12 text-retrieval",
        sim: "bg-brand/12 font-mono tracking-wider text-brand",
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
