import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** tailwind-merge must know the Aero type scale, otherwise `text-title1` is mistaken for a color and dropped. */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["caption", "footnote", "body", "callout", "headline", "title3", "title2", "title1", "display", "instrument"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
