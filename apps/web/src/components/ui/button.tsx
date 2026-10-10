import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"

// iOS düğme dili: hap biçimi, dolgulu birincil, gri dolgulu ikincil, basınca hafif küçülme.
const buttonVariants = cva(
  "press group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground font-semibold hover:brightness-105",
        secondary: "bg-secondary text-secondary-foreground hover:bg-fill-3",
        outline: "bg-transparent text-foreground ring-1 ring-inset ring-border hover:bg-fill",
        ghost: "text-muted-foreground hover:bg-fill hover:text-foreground aria-expanded:bg-fill aria-expanded:text-foreground",
        destructive: "bg-destructive text-white font-semibold hover:brightness-110",
        link: "rounded-none text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 text-[15px]",
        xs: "h-7 px-3 text-xs",
        sm: "h-8 px-3.5 text-[13px]",
        lg: "h-[50px] px-8 text-[17px]",
        icon: "size-10",
        "icon-xs": "size-7",
        "icon-sm": "size-8",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
