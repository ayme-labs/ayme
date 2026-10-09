import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import type { Look } from "../../shared";
import { useHighlights } from "./useHighlights";

// Unit tests: the page's hover and pin highlights, over hand-made looks.

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** A look at the page that shows each element under its ref. */
function lookOf(elementsByRef: Record<string, Element>): Look {
  return {
    state: { elementsByRef: new Map(Object.entries(elementsByRef)) },
  } as unknown as Look;
}

function mountHighlights() {
  let highlights!: ReturnType<typeof useHighlights>;
  function Probe() {
    highlights = useHighlights({ targetsOf: () => new Set() });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  return { highlights, unmount: () => act(() => root.unmount()) };
}

it("moves both highlights to the target's element in each new look", () => {
  const { highlights, unmount } = mountHighlights();
  const before = document.createElement("button");
  const after = document.createElement("button");

  highlights.onLook(lookOf({ e1: before }));
  highlights.hover({ ref: "e1" });
  highlights.pin({ ref: "e1" });
  highlights.onLook(lookOf({ e1: after }));

  expect(before.hasAttribute("data-ayme-hover")).toBe(false);
  expect(before.hasAttribute("data-ayme-highlight")).toBe(false);
  expect(after.hasAttribute("data-ayme-hover")).toBe(true);
  expect(after.hasAttribute("data-ayme-highlight")).toBe(true);
  unmount();
});

it("removes both highlights when it unmounts", () => {
  const { highlights, unmount } = mountHighlights();
  const element = document.createElement("button");
  highlights.onLook(lookOf({ e1: element }));
  highlights.hover({ ref: "e1" });
  highlights.pin({ ref: "e1" });

  unmount();

  expect(element.hasAttribute("data-ayme-hover")).toBe(false);
  expect(element.hasAttribute("data-ayme-highlight")).toBe(false);
});
