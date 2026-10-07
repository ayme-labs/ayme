import { describe, expect, it } from "vitest";

import type { ImageResult } from "../../contract";
import { imageOf, imageToolResult } from "./toolResult";

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
    [{ data: "A".repeat(5 * 1024 * 1024 + 1) }, "it is over 5 MB"],
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
