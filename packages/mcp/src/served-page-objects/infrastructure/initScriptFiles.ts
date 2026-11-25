import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  AYME_FOLDER,
  INIT_SCRIPT_FILE,
  ignoringInitScript,
  initScript,
} from "../domain/servedPageObjects";

/**
 * Creates the `.gitignore` only when it is not there, and adds the init
 * script's line at its end, with the first write too. The file is never
 * written anew from what was read, nor from its start, which would drop a
 * line the recorder adds at the same moment.
 */
async function ignoreInitScript(gitignore: string): Promise<void> {
  const created = await writeFile(gitignore, ignoringInitScript(undefined), {
    flag: "ax",
  }).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
      return false;
    }
  );
  if (created) return;
  const before = await readFile(gitignore, "utf8");
  const after = ignoringInitScript(before);
  // The domain's rule only ever adds to the end of the text it is given.
  if (after !== before) await appendFile(gitignore, after.slice(before.length));
}

/**
 * Writes `ayme/init-script.js` in `folder`, naming `port`, and writes or
 * extends `ayme/.gitignore` so git ignores it. Returns the init script's
 * path.
 */
export async function writeInitScript({
  folder,
  port,
}: {
  folder: string;
  port: number;
}): Promise<string> {
  const aymeFolder = join(folder, AYME_FOLDER);
  await mkdir(aymeFolder, { recursive: true });
  const script = join(aymeFolder, INIT_SCRIPT_FILE);
  await writeFile(script, initScript(port));
  // The init script is written and usable, whatever becomes of the
  // `.gitignore`, a read-only one for one.
  await ignoreInitScript(join(aymeFolder, ".gitignore")).catch(() => {});
  return script;
}
