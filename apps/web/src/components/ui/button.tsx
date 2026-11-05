import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

/** Soft button (shadcn style): 40 px default, 44 px large, neutral primary, subtle shadows. */
const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-aero outline-none active:scale-[0.98] focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-on-primary shadow-xs hover:bg-primary/90 active:bg-primary/85",
        emergency: "bg-emergency text-on-emergency shadow-xs hover:bg-emergency/90",
        destructive: "border border-error/30 bg-error/5 text-error hover:bg-error/10",
        outline: "border border-border bg-surface text-fg shadow-xs hover:bg-accent",
        secondary: "bg-muted text-fg hover:bg-fg/8",
        ghost: "text-fg-secondary hover:bg-accent hover:text-fg",
        link: "h-auto px-0 text-fg underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 text-body",
        sm: "h-8 rounded-md px-3 text-footnote",
        lg: "h-11 px-6 text-body",
        icon: "size-10",
        "icon-sm": "size-8 rounded-md",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  type,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      className={cn(buttonVariants({ variant, size, className }))}
      {...(asChild ? {} : { type: type ?? "button" })}
      {...props}
    />
  );
}

export { Button, buttonVariants };
