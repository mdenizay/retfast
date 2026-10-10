"use client";
// Uygulama bileşen kitaplığı: shadcn/ui (Radix) üzerine ince adaptörler. Sayfalar `@/components/ui` içinden
// bu adlarla içe aktarır; görünüm belirteçlerden (globals.css) ve shadcn bileşenlerinin sınıflarından gelir.
import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { Badge as ShBadge } from "./badge";
import { Button as ShButton } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";
import { Input } from "./input";
import { Textarea } from "./textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { cn } from "@/lib/utils";

export { cn as cx } from "@/lib/utils";
export { Input, Textarea };
export { Popover, PopoverContent, PopoverTrigger } from "./popover";
export { Switch } from "./switch";
export { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle };
export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./dropdown-menu";
export { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "./sheet";
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

type Variant = "primary" | "secondary" | "ghost" | "danger";
const VARIANT = { primary: "default", secondary: "secondary", ghost: "ghost", danger: "destructive" } as const;
const SIZE = { sm: "sm", md: "default", lg: "lg" } as const;

export function Button({ variant = "secondary", size = "md", ...p }: Omit<React.ComponentProps<typeof ShButton>, "variant" | "size"> & { variant?: Variant; size?: keyof typeof SIZE }) {
  return <ShButton variant={VARIANT[variant]} size={SIZE[size]} {...p} />;
}

/** Simge düğmesi; etiketi erişilebilirlik adı ve ipucu olarak kullanır. */
export function IconButton({ label, className, children, tip = true, ...p }: React.ComponentProps<"button"> & { label: string; tip?: boolean }) {
  const btn = (
    <button {...p} aria-label={label}
      className={cn("press inline-flex size-10 items-center justify-center rounded-full text-foreground outline-none hover:bg-fill-2 focus-visible:ring-2 focus-visible:ring-ring/60 [&_svg]:size-[19px]", className)}>
      {children}
    </button>
  );
  if (!tip) return btn;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const CHEVRON = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' fill='none' stroke='%238e8e93' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M1 1.5l5 5 5-5'/%3E%3C/svg%3E\")";

/** Yerel <select>: mobilde iOS/Android seçicisini açar; görünüm giriş alanıyla aynı. */
export function Select({ className, style, ...p }: React.ComponentProps<"select">) {
  return (
    <select {...p}
      className={cn("h-11 w-full appearance-none rounded-[14px] bg-input bg-no-repeat px-4 pr-10 text-base text-foreground outline-none transition focus-visible:bg-fill-2 focus-visible:ring-2 focus-visible:ring-ring/45 disabled:opacity-50", className)}
      style={{ backgroundImage: CHEVRON, backgroundPosition: "right 14px center", ...style }} />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="t-section">{label}</span>
      {children}
      {hint && <span className="t-foot block">{hint}</span>}
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("card rounded-[26px]", className)}>{children}</div>;
}

export function Badge({ tone = "default", children }: { tone?: "default" | "amber" | "ok" | "danger" | "sky"; children: React.ReactNode }) {
  return <ShBadge variant={tone}>{children}</ShBadge>;
}

/** iOS segmentli kontrol: Radix Tabs erişilebilirliği + kayan tutamak. */
export function Pills<T extends string>({ value, options, onChange, className }: {
  value: T; options: { value: T; label: React.ReactNode }[]; onChange: (v: T) => void; className?: string;
}) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <TabsPrimitive.Root value={value} onValueChange={(v) => onChange(v as T)} className={cn("inline-block max-w-full", className)}>
      <TabsPrimitive.List className="relative inline-grid auto-cols-fr grid-flow-col rounded-full bg-fill-2 p-[3px]">
        <span aria-hidden className="absolute inset-y-[3px] left-[3px] rounded-full bg-[var(--seg-thumb)] shadow-[0_1px_4px_rgb(0_0_0/0.18),0_0_0_0.5px_rgb(0_0_0/0.04)] transition-transform duration-300 ease-[cubic-bezier(0.3,0.9,0.3,1)]"
          style={{ width: `calc((100% - 6px) / ${options.length})`, transform: `translateX(${idx * 100}%)` }} />
        {options.map((o) => (
          <TabsPrimitive.Trigger key={o.value} value={o.value}
            className={cn("relative z-10 h-8 whitespace-nowrap rounded-full px-4 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60", o.value === value ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {o.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}

export function ErrorText({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="rounded-[16px] bg-danger/12 px-4 py-3 text-sm text-danger">{children}</p>;
}

export function Spinner() {
  return <div role="status" className="h-5 w-5 animate-spin rounded-full border-2 border-fill-3 border-t-tint" />;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="t-sub py-12 text-center">{children}</p>;
}

/** `window.confirm` yerine: onay iste, sonra eylemi çalıştır. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, cancelLabel, danger, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string;
  confirmLabel: string; cancelLabel: string; danger?: boolean; onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="t-headline">{title}</DialogTitle>
          {description && <DialogDescription className="t-sub">{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{cancelLabel}</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={() => { onOpenChange(false); onConfirm(); }}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
