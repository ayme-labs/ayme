import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  AYME_FOLDER,
  INIT_SCRIPT_FILE,
  ignoringInitScript,
  initScript,
} from "../domain/servedPageObjects";

/**
 * Writes `.ayme/init-script.js` in `folder`, naming `port` and, with
 * `webMCP`, turning WebMCP publication on, and writes or extends
 * `.ayme/.gitignore` so git ignores it. Returns the init script's path.
 */
export async function writeInitScript({
  folder,
  port,
  webMCP,
}: {
  folder: string;
  port: number;
  webMCP?: boolean;
}): Promise<string> {
  const aymeFolder = join(folder, AYME_FOLDER);
  await mkdir(aymeFolder, { recursive: true });
  const script = join(aymeFolder, INIT_SCRIPT_FILE);
  await writeFile(script, initScript(port, { webMCP }));
  const gitignore = join(aymeFolder, ".gitignore");
  const before = await readFile(gitignore, "utf8").catch(() => undefined);
  const after = ignoringInitScript(before);
  if (after !== before) await writeFile(gitignore, after);
  return script;
}
