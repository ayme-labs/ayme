import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Rolldown } from "tsdown";

/** A third-party package whose code a build holds. */
type BundledPackage = {
  readonly name: string;
  readonly version: string;
  /** The package's folder. */
  readonly dir: string;
};

/** The package a module of `node_modules` belongs to, or undefined for the
 * code of this repository. The CLI's notices build holds its own copy, since
 * a package may not import another's files. */
function packageOfModule(id: string): BundledPackage | undefined {
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
 * Writes the third-party packages a script holds to `file`, beside the
 * folder the script is built into: `bundled-packages.json` for the window's.
 * The CLI, which ships the script, reads the list to write its notices.
 */
export function bundledPackages(
  file = "bundled-packages.json"
): Rolldown.Plugin {
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
        resolve(options.dir!, "..", file),
        JSON.stringify([...packages.values()], null, 2)
      );
    },
  };
}
