import { describe, expect, it } from "vitest";

import { imageSizeOf } from "./imageSize";

/** The first bytes of a PNG: its signature and the IHDR chunk of a 300 by 200 image. */
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x01, 0x2c, 0x00, 0x00, 0x00, 0xc8, 0x08, 0x06,
  0x00, 0x00, 0x00,
]);

/** A JPEG of 640 wide and 480 high: an APP0 segment, then a baseline frame header. */
const JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 0x11, 0x08,
  0x01, 0xe0, 0x02, 0x80, 0x03, 0x01, 0x22, 0x00,
]);

describe("imageSizeOf", () => {
  it("reads a PNG's size from its header", () => {
    expect(imageSizeOf(PNG, "image/png")).toEqual({ width: 300, height: 200 });
  });

  it("reads a JPEG's size from its frame header, past the segments before it", () => {
    expect(imageSizeOf(JPEG, "image/jpeg")).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("refuses bytes that are not the image they are said to be", () => {
    expect(() => imageSizeOf(JPEG, "image/png")).toThrow("not a PNG");
    expect(() => imageSizeOf(PNG, "image/jpeg")).toThrow("not a JPEG");
    expect(() =>
      imageSizeOf(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg")
    ).toThrow("no frame header");
  });
});
