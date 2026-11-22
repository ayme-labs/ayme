import { expect, it } from "vitest";

import { runImageOf } from "./runImage";

const screenshot = {
  type: "image",
  subject: "the viewport",
  filename: "page-1.png",
  mimeType: "image/png",
  width: 1280,
  height: 720,
  data: "iVBORw0KGgo=",
};

it("shows an image result as its description and a data URL", () => {
  expect(runImageOf(screenshot)).toEqual({
    description: "Screenshot of the viewport, 1280×720 PNG",
    src: "data:image/png;base64,iVBORw0KGgo=",
  });
});

it("names a jpeg as JPEG", () => {
  expect(
    runImageOf({ ...screenshot, mimeType: "image/jpeg" })?.description
  ).toBe("Screenshot of the viewport, 1280×720 JPEG");
});

it.each([undefined, "text", { type: "image" }, { ...screenshot, data: 1 }])(
  "finds no image in %j",
  (result) => {
    expect(runImageOf(result)).toBeUndefined();
  }
);
