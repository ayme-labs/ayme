import { describe, expect, it } from "vitest";

import { ToolInputError } from "./errors";
import { screenshotRequest } from "./screenshotRequest";

const NOW = new Date("2026-10-07T15:37:24.123Z");

describe("screenshotRequest", () => {
  it("captures the viewport as png under a timestamped name by default", () => {
    expect(screenshotRequest({}, NOW)).toEqual({
      type: "png",
      filename: "page-2026-10-07T15-37-24-123Z.png",
      fullPage: false,
    });
  });

  it("names a jpeg capture with a .jpeg extension", () => {
    expect(screenshotRequest({ type: "jpeg" }, NOW).filename).toBe(
      "page-2026-10-07T15-37-24-123Z.jpeg"
    );
  });

  it.each([
    ["shot.png", "png"],
    ["shot.jpg", "jpeg"],
    ["shot.jpeg", "jpeg"],
    ["Shot.JPG", "jpeg"],
  ])("takes the format of %s from its extension", (filename, type) => {
    expect(screenshotRequest({ filename }, NOW)).toEqual({
      type,
      filename,
      fullPage: false,
    });
  });

  it("keeps a filename whose extension agrees with the type", () => {
    expect(
      screenshotRequest({ type: "jpeg", filename: "shot.jpg" }, NOW)
    ).toEqual({ type: "jpeg", filename: "shot.jpg", fullPage: false });
  });

  it("refuses a filename whose extension disagrees with the type", () => {
    expect(() =>
      screenshotRequest({ type: "png", filename: "shot.jpg" }, NOW)
    ).toThrow(
      new ToolInputError(
        'The filename "shot.jpg" is a jpeg name, but the type is png. Give them the same format, or leave one out.'
      )
    );
  });

  it.each(["shot", "shot.webp", "shot.png.txt"])(
    "refuses the filename %s, which does not end in .png, .jpg or .jpeg",
    (filename) => {
      expect(() => screenshotRequest({ filename }, NOW)).toThrow(
        new ToolInputError(
          `The filename "${filename}" must end in .png, .jpg or .jpeg.`
        )
      );
    }
  );

  it.each(["shots/shot.png", "shots\\shot.png", "..png", "../shot.png"])(
    "refuses the filename %s, which is not a bare name",
    (filename) => {
      expect(() => screenshotRequest({ filename }, NOW)).toThrow(
        new ToolInputError(
          `The filename "${filename}" must be a bare file name, without "/", "\\" or "..".`
        )
      );
    }
  );

  it("captures one element", () => {
    expect(screenshotRequest({ target: "e12" }, NOW)).toEqual({
      type: "png",
      filename: "page-2026-10-07T15-37-24-123Z.png",
      fullPage: false,
      target: "e12",
    });
  });

  it("captures the full page", () => {
    expect(screenshotRequest({ fullPage: true }, NOW).fullPage).toBe(true);
  });

  it("refuses fullPage together with a target", () => {
    expect(() =>
      screenshotRequest({ fullPage: true, target: "e12" }, NOW)
    ).toThrow(
      new ToolInputError(
        "fullPage cannot be used with a target: capture the full page or one element."
      )
    );
  });
});
