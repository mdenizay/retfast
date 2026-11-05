import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

/** Minimal button: accent fill (dark text), accent-tinted, neutral tile, ghost. Icon sizes are round. */
const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap transition-[color,background-color,box-shadow,transform,opacity] duration-150 ease-aero outline-none active:scale-[0.97] focus-visible:ring-[3px] focus-visible:ring-ring/45 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        default: "bg-primary text-on-primary hover:brightness-105 active:brightness-95",
        tinted: "bg-brand/12 text-brand hover:bg-brand/18",
        emergency: "bg-emergency text-on-emergency hover:bg-emergency/90",
        destructive: "bg-error/10 text-error hover:bg-error/15",
        outline: "bg-muted text-fg hover:bg-fg/10",
        secondary: "bg-muted text-fg hover:bg-fg/10",
        ghost: "font-medium text-fg-secondary hover:bg-muted hover:text-fg",
        link: "h-auto px-0 font-medium text-brand underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-5 text-body",
        sm: "h-9 rounded-full px-4 text-footnote",
        lg: "h-12 rounded-2xl px-6 text-callout",
        icon: "size-11 rounded-full",
        "icon-sm": "size-9 rounded-full",
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
