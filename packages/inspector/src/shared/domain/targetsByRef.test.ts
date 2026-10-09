import { expect, it } from "vitest";

import { mapTargetsToRefs } from "./targetsByRef";

// Unit tests: which registry targets each ref of a look at the page is.

const element = () => document.createElement("div");

it("maps a ref to every target whose element it is, in the registry's order", () => {
  const button = element();

  expect(
    mapTargetsToRefs(
      [["e1", button]],
      [
        { path: "ListPage.addItemButton", element: button },
        { path: "Header.cta", element: button },
      ]
    )
  ).toEqual(new Map([["e1", ["ListPage.addItemButton", "Header.cta"]]]));
});

it("lists a target registered twice once", () => {
  const button = element();

  expect(
    mapTargetsToRefs(
      [["e1", button]],
      [
        { path: "ListPage.addItemButton", element: button },
        { path: "ListPage.addItemButton", element: button },
      ]
    ).get("e1")
  ).toEqual(["ListPage.addItemButton"]);
});

it("leaves out a target whose element the page state shows under no ref, or under two", () => {
  const hidden = element();
  const twice = element();

  expect(
    mapTargetsToRefs(
      [
        ["e1", twice],
        ["e2", twice],
      ],
      [
        { path: "ListPage.hidden", element: hidden },
        { path: "ListPage.twice", element: twice },
      ]
    )
  ).toEqual(new Map());
});
