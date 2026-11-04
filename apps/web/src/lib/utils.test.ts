import { expect, it } from "vitest";
import { cn } from "./utils";

it("keeps Aero font sizes when combined with text colors", () => {
  expect(cn("telemetry text-title1", "text-fg")).toBe("telemetry text-title1 text-fg");
  expect(cn("text-body", "text-footnote")).toBe("text-footnote");
});
