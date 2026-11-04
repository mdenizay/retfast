import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

/** Aero button: 48 px default (56 px large) hit targets, hairline outline variant, no shadows. */
const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        default: "bg-primary text-on-primary hover:bg-primary/90 active:bg-primary/80",
        emergency: "bg-emergency text-on-emergency hover:bg-emergency/90",
        destructive: "border border-error/60 text-error hover:bg-error/10",
        outline: "border border-border bg-surface text-fg hover:bg-accent",
        secondary: "bg-accent text-fg hover:bg-fg/10",
        ghost: "text-fg-secondary hover:bg-accent hover:text-fg",
        link: "h-auto px-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-12 px-5 text-body",
        sm: "h-9 rounded-sm px-3 text-footnote",
        lg: "h-14 px-6 text-callout",
        icon: "size-12",
        "icon-sm": "size-9 rounded-sm",
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
