import { expect, it } from "vitest";

import { readControls } from "./formControls";

it("reads each native control's value, options, range and radio group", () => {
  document.body.innerHTML = `
    <form>
      <input id="name" value="Ada">
      <textarea id="notes">line1
line2</textarea>
      <input id="agree" type="checkbox" checked>
      <input id="small" type="radio" name="size">
      <input id="medium" type="radio" name="size" checked>
      <select id="color"><option>Red</option><option selected>Green</option></select>
      <input id="volume" type="range" min="1" max="9" step="any" value="4">
    </form>
    <form><input id="other" type="radio" name="size"></form>
    <div id="custom" role="checkbox" aria-checked="true"></div>`;
  const byId = (id: string) => document.getElementById(id)!;

  const controls = readControls(
    new Map(
      [
        "name",
        "notes",
        "agree",
        "small",
        "medium",
        "color",
        "volume",
        "other",
        "custom",
      ].map((id) => [id, byId(id)])
    )
  );

  expect(Object.fromEntries(controls)).toEqual({
    name: { value: "Ada" },
    notes: { value: "line1\nline2", multiline: true },
    agree: { value: "true" },
    small: { value: "false", group: "0:size" },
    medium: { value: "true", group: "0:size" },
    color: { value: "Green", options: ["Red", "Green"] },
    volume: { value: "4", range: { min: 1, max: 9, step: "any" } },
    other: { value: "false", group: "1:size" },
  });
});
