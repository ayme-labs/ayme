import { createRequire } from "node:module";

import type TypeScript from "@typescript/typescript6";
import projectTypeScript from "typescript";

export type { TypeScript };

export const typeScriptVersion = projectTypeScript.version;

// TypeScript 7 ships a native compiler with a different API. Microsoft's
// compatibility package keeps the JavaScript compiler API available alongside it.
export const ts = (
  typeScriptVersion.startsWith("7.")
    ? createRequire(import.meta.url)("@typescript/typescript6")
    : projectTypeScript
) as typeof TypeScript;
