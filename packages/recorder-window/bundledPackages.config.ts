import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Rolldown } from "tsdown";

/** A third-party package whose code a build holds. */
export type BundledPackage = {
  readonly name: string;
  readonly version: string;
  /** The package's folder. */
  readonly dir: string;
};

/** The package a module of `node_modules` belongs to, or undefined for the
 * code of this repository. The configs import this file with its .ts
 * extension so Node's type stripping can load it. */
export function packageOfModule(id: string): BundledPackage | undefined {
  const marker = "/node_modules/";
  const at = id.lastIndexOf(marker);
  if (at < 0) return undefined;
  const parts = id.slice(at + marker.length).split("/");
  const name = parts[0]!.startsWith("@")
    ? `${parts[0]}/${parts[1]}`
    : parts[0]!;
  const dir = id.slice(0, at + marker.length) + name;
  const { version } = JSON.parse(
    readFileSync(join(dir, "package.json"), "utf8")
  ) as { version: string };
  return { name, version, dir };
}

/**
 * Writes the third-party packages the window's script holds to
 * `bundled-packages.json`, beside the folder the script is built into. The
 * CLI, which ships the script, reads the list to write its notices.
 */
export function bundledPackages(): Rolldown.Plugin {
  const packages = new Map<string, BundledPackage>();
  return {
    name: "ayme-bundled-packages",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle))
        if (output.type === "chunk")
          for (const id of output.moduleIds) {
            const found = packageOfModule(id);
            if (found) packages.set(`${found.name}@${found.version}`, found);
          }
    },
    writeBundle(options) {
      writeFileSync(
        resolve(options.dir!, "..", "bundled-packages.json"),
        JSON.stringify([...packages.values()], null, 2)
      );
    },
  };
}
