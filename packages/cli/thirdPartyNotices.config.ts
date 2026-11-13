import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Rolldown } from "tsdown";

/** A third-party package whose code a build holds, as the window's build
 * lists it. */
type BundledPackage = {
  readonly name: string;
  readonly version: string;
  /** The package's folder. */
  readonly dir: string;
};

/** The package a module of `node_modules` belongs to, or undefined for the
 * code of this repository. */
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

/** The licence text a package ships, or what its manifest says of it. */
function licenceOf(pkg: BundledPackage): string {
  const file = readdirSync(pkg.dir).find((entry) =>
    /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(entry)
  );
  if (file) return readFileSync(join(pkg.dir, file), "utf8").trim();
  const { license } = JSON.parse(
    readFileSync(join(pkg.dir, "package.json"), "utf8")
  ) as { license?: string };
  throw new Error(
    `${pkg.name}@${pkg.version} (${license ?? "no licence declared"}) ships no licence file to carry into THIRD_PARTY_NOTICES.txt.`
  );
}

/**
 * Writes `THIRD_PARTY_NOTICES.txt`: each third-party package whose code the
 * command's file or the window's script holds, with the licence it ships. The
 * window's packages come from the list its build writes, which the window
 * package exports as `@ayme-dev/recorder-window/bundled-packages.json`. Ayme's own packages are
 * under the package's LICENSE.
 */
export function thirdPartyNotices(): Rolldown.Plugin {
  return {
    name: "ayme-third-party-notices",
    generateBundle(_options, bundle) {
      // Resolved through the window's exports, as a package is: its build
      // has to have run first.
      const windowList = createRequire(import.meta.url).resolve(
        "@ayme-dev/recorder-window/bundled-packages.json"
      );
      const packages = new Map<string, BundledPackage>();
      const add = (pkg: BundledPackage) => {
        if (!pkg.name.startsWith("@ayme-dev/"))
          packages.set(`${pkg.name}@${pkg.version}`, pkg);
      };
      for (const output of Object.values(bundle))
        if (output.type === "chunk")
          for (const id of output.moduleIds) {
            const found = packageOfModule(id);
            if (found) add(found);
          }
      for (const pkg of JSON.parse(
        readFileSync(windowList, "utf8")
      ) as BundledPackage[])
        add(pkg);
      const entries = [...packages.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, pkg]) => `${key}\n\n${licenceOf(pkg)}\n`);
      this.emitFile({
        type: "asset",
        fileName: "THIRD_PARTY_NOTICES.txt",
        source: `Third-party software bundled into this package\n\n${entries.join("\n---\n\n")}`,
      });
    },
  };
}
