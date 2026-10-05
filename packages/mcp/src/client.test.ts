import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const SPECIFIER =
  /(?:import|export)\s*(?:[^"']*?\sfrom\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

/** Every module specifier the built file and the chunks it imports use. */
function importsOf(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const specifiers = [
    ...readFileSync(join(dist, file), "utf8").matchAll(SPECIFIER),
  ].map((match) => (match[1] ?? match[2])!);
  return specifiers.flatMap((specifier) =>
    specifier.startsWith("./")
      ? importsOf(specifier.slice(2), seen)
      : [specifier]
  );
}

it("the built client entry carries no Node built-ins and no server code", () => {
  const imports = importsOf("client.mjs");
  // The check reads the build: the page client opens its channel with tRPC.
  expect(imports).toContain("@trpc/client");
  const nodeBuiltins = new Set(builtinModules);
  expect(
    imports.filter(
      (specifier) =>
        specifier.startsWith("node:") ||
        nodeBuiltins.has(specifier.split("/")[0]!) ||
        specifier === "ws" ||
        specifier.startsWith("@modelcontextprotocol/") ||
        specifier.startsWith("@trpc/server")
    )
  ).toEqual([]);
});

it("the built client entry validates with zod/mini, not zod's full build", () => {
  // `zod` bundles to about 450 kB minified in the browser; `zod/mini` to
  // about 20 kB.
  const imports = importsOf("client.mjs");
  expect(imports.filter((specifier) => specifier.startsWith("zod"))).toEqual([
    "zod/mini",
  ]);
});
