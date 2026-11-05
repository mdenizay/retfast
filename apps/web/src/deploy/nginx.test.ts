/// <reference types="node" />
/**
 * Guards the production nginx config against a real outage: nginx's default mime.types has no
 * `.mjs` entry, so the MapLibre module worker was served as application/octet-stream and blocked
 * by `X-Content-Type-Options: nosniff` — the map silently never rendered.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// vitest runs with cwd = apps/web
const conf = readFileSync(resolve(process.cwd(), "../../infrastructure/docker/web.nginx.conf"), "utf8");

function block(src: string, header: RegExp): string | null {
  const m = header.exec(src);
  if (!m) return null;
  let depth = 0;
  for (let i = src.indexOf("{", m.index); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(m.index, i + 1);
  }
  return null;
}

describe("web.nginx.conf", () => {
  it("serves .mjs under /assets/ as JavaScript (MapLibre worker)", () => {
    const assets = block(conf, /location\s+\/assets\/\s*\{/);
    expect(assets).not.toBeNull();
    const mjs = block(assets!, /location\s+~\*?\s+\\\.mjs\$\s*\{/);
    expect(mjs, "nested `location ~* \\.mjs$` block inside /assets/").not.toBeNull();
    expect(mjs!).toMatch(/default_type\s+(text|application)\/javascript\s*;/);
    // nested locations don't inherit add_header: the security headers must be re-included
    expect(mjs!).toMatch(/security-headers\.conf/);
  });

  it("the MapLibre worker is actually emitted as .mjs (so the rule above matters)", () => {
    const dir = resolve(process.cwd(), "node_modules/maplibre-gl/dist");
    expect(readdirSync(dir).some((f: string) => /^maplibre-gl-worker.*\.mjs$/.test(f))).toBe(true);
  });
});
