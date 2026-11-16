import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { ENTRY_FILE } from "../domain/servedPageObjects";

/**
 * The Page Objects entry the server serves, as an absolute path: `named`
 * (the `--page-objects` flag) resolved against `folder`, which must exist,
 * or else `.ayme/page-objects.ts` in `folder` if there is one.
 */
export function findPageObjectsEntry({
  folder,
  named,
}: {
  folder: string;
  named?: string;
}): string | undefined {
  if (named !== undefined) {
    const entry = resolve(folder, named);
    if (!existsSync(entry))
      throw new Error(`The Page Objects entry ${entry} does not exist.`);
    return entry;
  }
  const entry = resolve(folder, ENTRY_FILE);
  return existsSync(entry) ? entry : undefined;
}
