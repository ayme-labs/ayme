import { createRequire } from "node:module";

import type TypeScript from "@typescript/typescript6";
import projectTypeScript from "typescript";

export type { TypeScript };

export const typeScriptVersion = projectTypeScript.version;

/** Microsoft's package that keeps the JavaScript compiler API beside TypeScript 7. */
export const TYPESCRIPT6 = "@typescript/typescript6";

/**
 * The compiler API for the project's TypeScript `version`: that TypeScript's
 * own before 7, and from 7 on, `@typescript/typescript6`'s, since TypeScript 7
 * ships a native compiler without it. Like `typescript`, it is an optional
 * peer, so `require` resolves it from this package's install in the project.
 */
export function compilerApi(
  version: string,
  require: ((id: string) => unknown) & { resolve(id: string): string }
): typeof TypeScript {
  if (!version.startsWith("7.")) return projectTypeScript as typeof TypeScript;
  let path: string;
  try {
    path = require.resolve(TYPESCRIPT6);
  } catch {
    throw new Error(
      `[ayme] TypeScript ${version} is installed without ${TYPESCRIPT6}, which the Page Object compiler needs with TypeScript 7: install ${TYPESCRIPT6} in the project.`
    );
  }
  return require(path) as typeof TypeScript;
}

export const ts = compilerApi(
  typeScriptVersion,
  createRequire(import.meta.url)
);
