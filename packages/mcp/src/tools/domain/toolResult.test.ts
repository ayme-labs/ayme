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
  const failed = `The Page Objects entry ${entry} did not build, and no build of it has succeeded, so this server serves no Page Objects.`;
  const watching =
    "The server is watching for changes: it rebuilds the entry when a file it read changes.";

  it("states that the server is watching, and gives no advice", () => {
    const error = "/work/.ayme/pom/PlainPage.ts:3:0: Unexpected end of file";
    const text = pageObjectsNotBuilt({ entry, error, watching: true });

    expect(text).toBe(
      [`${failed} The first error: ${error}`, watching].join("\n")
    );
    expect(text).not.toContain("Fix it");
    expect(text).not.toContain("Make the");
    expect(text).not.toContain("tsconfig.json");
  });

  it("keeps TypeScript's no-inputs error and does not say how to cover the entry", () => {
    const error =
      "/work/.ayme/pom/PlainPage.ts: Could not read TypeScript project configuration /work/tsconfig.json: No inputs were found in config file.";
    const text = pageObjectsNotBuilt({ entry, error, watching: true });

    expect(text).toBe(
      [`${failed} The first error: ${error}`, watching].join("\n")
    );
    expect(text).not.toContain("Fix it");
    expect(text).not.toContain("Make the");
  });

  it("states that the server is not watching when the build could not start", () => {
    const error = "needs @ayme-dev/ayme/compiler, which does not resolve";
    const text = pageObjectsNotBuilt({ entry, error, watching: false });

    expect(text).toBe(
      [
        `${failed} The first error: ${error}`,
        "The server is not watching for changes: the build could not start, so no file is watched.",
      ].join("\n")
    );
    expect(text).not.toContain("Fix it");
    expect(text).not.toContain("Make the");
  });
});
