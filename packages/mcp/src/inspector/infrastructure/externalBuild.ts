import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { INSPECTOR_PACKAGE } from "../domain/externalInspector";

/** The export of `@ayme-dev/inspector` that holds the external build. */
const EXTERNAL_EXPORT = `${INSPECTOR_PACKAGE}/external`;

/**
 * The external Inspector's script, from the optional `@ayme-dev/inspector`
 * package next to this one, or nothing when it is not installed (or has no
 * such build). `specifier` is the export to read; the Inspector's own unless
 * a test names another.
 */
export async function readExternalBuild(
  specifier: string = EXTERNAL_EXPORT
): Promise<string | undefined> {
  try {
    return await readFile(
      fileURLToPath(import.meta.resolve(specifier)),
      "utf8"
    );
  } catch {
    return undefined;
  }
}
