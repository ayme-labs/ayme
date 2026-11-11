import { describe, expect, it } from "vitest";

import type { ImageResult } from "../../contract";
import { imageOf, imageToolResult, pageObjectsNotBuilt } from "./toolResult";

const image: ImageResult = {
  type: "image",
  subject: "the viewport",
  filename: "page-1.png",
  mimeType: "image/png",
  width: 1280,
  height: 720,
  data: "iVBORw0KGgo=",
};

const PATH = "/tmp/ayme-screenshots/page-1.png";

/** `bytes` bytes, base64-encoded. */
const base64Of = (bytes: number) => Buffer.alloc(bytes).toString("base64");

describe("imageOf", () => {
  it("finds the image in a tool's result", () => {
    expect(imageOf({ callId: "1", ok: true, result: image })).toEqual(image);
  });

  it("finds none in a failure or another result", () => {
    expect(imageOf({ callId: "1", ok: false, error: "no" })).toBeUndefined();
    expect(
      imageOf({ callId: "1", ok: true, result: { type: "image" } })
    ).toBeUndefined();
  });
});

describe("imageToolResult", () => {
  it("returns the image with a line naming what it shows and its file", () => {
    expect(imageToolResult(image, { path: PATH })).toEqual({
      content: [
        { type: "image", data: image.data, mimeType: "image/png" },
        {
          type: "text",
          text: `Screenshot of the viewport, 1280×720 PNG, saved to ${PATH}.`,
        },
      ],
    });
  });

  it.each([
    [{ width: 8001, height: 720 }, "it is over 8000 pixels on a side"],
    [{ width: 1280, height: 9000 }, "it is over 8000 pixels on a side"],
    // 5 MiB and one byte, base64-encoded: 5,592,408 characters.
    [{ data: base64Of(5 * 1024 * 1024 + 1) }, "it is over 5 MB"],
  ])(
    "returns only the file of an image too large to return inline",
    (over, why) => {
      const large = { ...image, ...over };

      expect(imageToolResult(large, { path: PATH })).toEqual({
        content: [
          {
            type: "text",
            text: `Screenshot of the viewport, ${large.width}×${large.height} PNG, saved to ${PATH}. Not returned inline: ${why}.`,
          },
        ],
      });
    }
  );

  it("returns an image of exactly 5 MiB inline, though its base64 is longer", () => {
    const result = imageToolResult(
      { ...image, data: base64Of(5 * 1024 * 1024) },
      { path: PATH }
    );

    expect(result.content[0]).toMatchObject({ type: "image" });
  });

  it("still returns the image when its file could not be written", () => {
    expect(imageToolResult(image, { error: "EACCES" })).toEqual({
      content: [
        { type: "image", data: image.data, mimeType: "image/png" },
        {
          type: "text",
          text: "Screenshot of the viewport, 1280×720 PNG. It could not be saved to a file: EACCES.",
        },
      ],
    });
  });

  it("fails when an image too large to return inline could not be written", () => {
    expect(
      imageToolResult({ ...image, width: 9000 }, { error: "EACCES" })
    ).toEqual({
      content: [
        {
          type: "text",
          text: "Screenshot of the viewport, 9000×720 PNG. It could not be saved to a file: EACCES. Not returned inline: it is over 8000 pixels on a side.",
        },
      ],
      isError: true,
    });
  });
});

describe("pageObjectsNotBuilt", () => {
  const entry = "/work/.ayme/page-objects.ts";

  it("says to save the fix while the build watches the entry's files, with no tsconfig advice for another error", () => {
    const text = pageObjectsNotBuilt({
      entry,
      error: "/work/.ayme/pom/PlainPage.ts:3:0: Unexpected end of file",
      watching: true,
    });

    expect(text.split("\n")[1]).toBe(
      "Fix it and save: the server rebuilds the entry when a file it read changes."
    );
    expect(text).not.toContain("tsconfig.json");
  });

  it("says to cover the entry in the tsconfig include when TypeScript found no inputs", () => {
    expect(
      pageObjectsNotBuilt({
        entry,
        error:
          "/work/.ayme/pom/PlainPage.ts: Could not read TypeScript project configuration /work/tsconfig.json: No inputs were found in config file.",
        watching: true,
      }).split("\n")[1]
    ).toBe(
      'Fix it and save: the server rebuilds the entry when a file it read changes. Make the "include" of that tsconfig.json cover the entry, such as ".ayme/**/*.ts".'
    );
  });

  it("says to restart ayme mcp when the build could not start", () => {
    expect(
      pageObjectsNotBuilt({
        entry,
        error: "needs @ayme-dev/ayme/compiler, which does not resolve",
        watching: false,
      }).split("\n")[1]
    ).toBe(
      "Fix it and restart ayme mcp: the build could not start, so no file is watched."
    );
  });
});
