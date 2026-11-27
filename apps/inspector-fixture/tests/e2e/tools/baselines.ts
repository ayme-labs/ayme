import { readFileSync } from "node:fs";

/**
 * The baseline arms' configs for `assertOwnCacheDir`, with arm 1's cache,
 * which `pnpm test:goals` pins on its command line rather than in its
 * config. It is read from that script, so the script stays the one place
 * that names it, and its flag keeps the precedence it has for e2e.
 */
export function baselineCaches(...configs: readonly object[]): object[] {
  const { scripts } = JSON.parse(
    readFileSync(new URL("../../../package.json", import.meta.url), "utf8")
  ) as { scripts: Record<string, string> };
  const dir = /--cache-dir[= ](\S+)/.exec(scripts["test:goals"] ?? "")?.[1];
  if (dir === undefined)
    throw new Error(
      "package.json's test:goals pins no --cache-dir: arm 1's cache would be left unguarded"
    );
  return [...configs, { cache: { dir } }];
}
