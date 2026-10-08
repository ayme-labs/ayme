import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { saveToScreenshotFolder } from "./screenshotFolder";

it("writes the image into ayme-screenshots in the temporary folder, over a file of the same name", async () => {
  const filename = `test-${process.pid}.png`;
  await saveToScreenshotFolder(filename, Buffer.from("old").toString("base64"));
  const path = await saveToScreenshotFolder(
    filename,
    Buffer.from("new").toString("base64")
  );

  expect(path).toBe(join(tmpdir(), "ayme-screenshots", filename));
  expect(await readFile(path, "utf8")).toBe("new");
});

it.each(["../shot.png", "a/shot.png", "a\\\\shot.png"])(
  "refuses %s, which is not a bare file name",
  async (filename) => {
    await expect(saveToScreenshotFolder(filename, "")).rejects.toThrow(
      "not a bare file name"
    );
  }
);
