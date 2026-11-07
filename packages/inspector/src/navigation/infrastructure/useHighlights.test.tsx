import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

import type { Look } from "../../shared";
import {
  createHighlights,
  createInspectorContract,
} from "@ayme-dev/ayme/testing";

import { createInspectorClient } from "../../shared";
import { useHighlights } from "./useHighlights";

// Unit tests: the page's hover and pin highlights, over hand-made looks.

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** A look at the page that shows each element under its ref. */
function lookOf(elementsByRef: Record<string, Element>): Look {
  const refs = Object.keys(elementsByRef);
  return {
    state: {
      projected: { roots: [] },
      refs,
      targets: [],
      targetsByRef: {},
      elementToolTargets: {},
      controls: {},
      rootedInstances: {},
    },
    refs: new Set(refs),
    targets: [],
    targetsByRef: new Map(),
    elementToolTargets: new Map(),
  };
}

/** The highlights on the page: each ref's `ayme-ref=` locator with its style. */
function fakePage() {
  const showing = new Map<string, Record<string, string | number>>();
  return {
    showing,
    locate: (ref: string) => ({
      highlight: async ({
        style,
      }: {
        style: Record<string, string | number>;
      }) => {
        showing.set(ref, style);
        return { dispose: async () => void showing.delete(ref) };
      },
    }),
  };
}

const lineOf = (outline: string | number | undefined) => String(outline);

/** What each ref shows: "hover" (dashed), "pinned" (solid), or nothing. */
function shown(page: ReturnType<typeof fakePage>) {
  return Object.fromEntries(
    [...page.showing].map(([ref, style]) => [
      ref,
      lineOf(style.outline).includes("dashed") ? "hover" : "pinned",
    ])
  );
}

function mountHighlights(page = fakePage()) {
  let highlights!: ReturnType<typeof useHighlights>;
  function Probe() {
    highlights = useHighlights({
      targetsOf: () => new Set(),
      client: createInspectorClient(
        createInspectorContract({
          started: () => undefined,
          subscribeToStarted: () => () => {},
          appProcessTools: () => {
            throw new Error("No session.");
          },
          connectionStatus: () => {
            throw new Error("No session.");
          },
          subscribeToAgentImageRuns: () => () => {},
          highlights: createHighlights(page.locate),
          pick: async () => undefined,
          registry: {
            pageObjects: () => [],
            pomDefinitions: () => [],
            subscribe: () => () => {},
          },
          look: async () => {
            throw new Error("No session.");
          },
          pomDefinitionText: () => "",
          recordedPageState: async () => undefined,
          demo: () => {},
        })
      ),
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  return {
    highlights,
    page,
    settle: () =>
      act(async () => void (await new Promise((r) => setTimeout(r, 0)))),
    unmount: () => act(() => root.unmount()),
  };
}

it("moves both highlights to the target's element in each new look", async () => {
  const { highlights, page, settle, unmount } = mountHighlights();

  highlights.onLook(lookOf({ e1: document.createElement("button") }));
  highlights.hover({ ref: "e1" });
  highlights.pin({ ref: "e2" });
  highlights.onLook(
    lookOf({
      e1: document.createElement("button"),
      e2: document.createElement("button"),
    })
  );
  await settle();

  expect(shown(page)).toEqual({ e1: "hover", e2: "pinned" });
  highlights.hover(undefined);
  await settle();
  expect(shown(page)).toEqual({ e2: "pinned" });
  unmount();
});

it("shows the selection's highlight on an element both layers want", async () => {
  const { highlights, page, settle, unmount } = mountHighlights();
  highlights.onLook(lookOf({ e1: document.createElement("button") }));

  highlights.hover({ ref: "e1" });
  highlights.pin({ ref: "e1" });
  await settle();

  expect(shown(page)).toEqual({ e1: "pinned" });
  highlights.pin(undefined);
  await settle();
  expect(shown(page)).toEqual({ e1: "hover" });
  unmount();
});

it("removes both highlights when it unmounts", async () => {
  const { highlights, page, settle, unmount } = mountHighlights();
  highlights.onLook(
    lookOf({
      e1: document.createElement("button"),
      e2: document.createElement("button"),
    })
  );
  highlights.hover({ ref: "e1" });
  highlights.pin({ ref: "e2" });
  await settle();
  expect(page.showing.size).toBe(2);

  unmount();
  await settle();

  expect(page.showing.size).toBe(0);
});

it("sets nothing on the app's elements", async () => {
  const { highlights, settle, unmount } = mountHighlights();
  const element = document.createElement("button");
  highlights.onLook(lookOf({ e1: element }));

  highlights.hover({ ref: "e1" });
  highlights.pin({ ref: "e1" });
  await settle();

  expect(element.getAttributeNames()).toEqual([]);
  unmount();
});

it("only offers a highlight while its target is connected in the latest look", () => {
  const { highlights, unmount } = mountHighlights();
  const element = document.createElement("button");
  document.body.append(element);
  expect(highlights.canHighlight({ ref: "e1" })).toBe(false);
  highlights.onLook(lookOf({ e1: element }));
  expect(highlights.canHighlight({ ref: "e1" })).toBe(true);
  expect(highlights.canHighlight({ ref: "unknown" })).toBe(false);
  element.remove();
  // The page state is the latest look's: a look that no longer holds e1 ends it.
  highlights.onLook(lookOf({}));
  expect(highlights.canHighlight({ ref: "e1" })).toBe(false);
  unmount();
});
