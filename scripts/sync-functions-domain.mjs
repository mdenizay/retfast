import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "..");
const domainDist = resolve(workspaceRoot, "packages/domain/dist");
const vendorTarget = resolve(workspaceRoot, "functions/vendor/domain");

await mkdir(vendorTarget, { recursive: true });
await Promise.all([
  copyFile(resolve(domainDist, "index.js"), resolve(vendorTarget, "index.js")),
  copyFile(resolve(domainDist, "index.d.ts"), resolve(vendorTarget, "index.d.ts")),
  copyFile(
    resolve(domainDist, "index.d.ts.map"),
    resolve(vendorTarget, "index.d.ts.map"),
  ),
  writeFile(
    resolve(vendorTarget, "package.json"),
    `${JSON.stringify(
      {
        name: "@retfast/domain",
        version: "0.1.0",
        private: true,
        type: "module",
        main: "./index.js",
        types: "./index.d.ts",
        dependencies: { zod: "^4.3.6" },
      },
      null,
      2,
    )}\n`,
  ),
]);
