import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";

import type { SaveImage } from "../application/callPageTool";

/**
 * `ayme-screenshots` in the OS's temporary folder, ending in a path
 * separator, as the server tells a page in its welcome.
 */
export const screenshotFolder = join(tmpdir(), "ayme-screenshots") + sep;

/**
 * Writes an image into `ayme-screenshots` in the OS's temporary folder,
 * overwriting a file of the same name. Refuses a name that is not a bare
 * file name, which the page already refuses.
 */
export const saveToScreenshotFolder: SaveImage = async (filename, data) => {
  if (basename(filename) !== filename || /[/\\]|\.\./.test(filename))
    throw new Error(`"${filename}" is not a bare file name`);
  await mkdir(screenshotFolder, { recursive: true });
  const path = screenshotFolder + filename;
  await writeFile(path, Buffer.from(data, "base64"));
  return path;
};
