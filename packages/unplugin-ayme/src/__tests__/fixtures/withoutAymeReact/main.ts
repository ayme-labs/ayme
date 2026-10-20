import { createElement, type ReactElement } from "react";
import { AymeProvider, useAyme, usePageObject, usePeek } from "@ayme-dev/react";

// An app that uses a framework integration as the quickstarts do: the
// provider at the root, and a component that reads the status, takes a Page
// Object and adds a Peek.
class ListPage {}

function List(): ReactElement {
  const { webMCP } = useAyme();
  const page = usePageObject(ListPage);
  usePeek({ page }, "list");
  return createElement("output", null, webMCP.publicationStatus.state);
}

export function App(): ReactElement {
  return createElement(
    AymeProvider,
    { webMCP: { enabled: false } },
    createElement(List)
  );
}
