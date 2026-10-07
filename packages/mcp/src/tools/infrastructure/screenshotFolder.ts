import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { SaveImage } from "../application/callPageTool";

/**
 * Writes an image into `ayme-screenshots` in the OS's temporary folder,
 * overwriting a file of the same name. Refuses a name that is not a bare
 * file name, which the page already refuses.
 */
export const saveToScreenshotFolder: SaveImage = async (filename, data) => {
  if (basename(filename) !== filename || /[/\\]|\.\./.test(filename))
    throw new Error(`"${filename}" is not a bare file name`);
  const folder = join(tmpdir(), "ayme-screenshots");
  await mkdir(folder, { recursive: true });
  const path = join(folder, filename);
  await writeFile(path, Buffer.from(data, "base64"));
  return path;
};
