// Runtime, not publication: the Page State Session and its
// interaction history import nothing from the publication side (`webMcp.ts`,
// tool schema rendering, anything touching `document.modelContext`); the
// publication side calls in, never the reverse.
//
// The browser runtime's door to its document's page-state stores, which
// `pageStates.ts` keys by Page: the browser's Page is its own Playwright Lite
// page of the document (`browserInPage.ts`). The functions other slices reach
// a document's Page State Session through take the document.

import { type AriaRef } from "@ayme-dev/core/structural-observation";
import type { Locator } from "@playwright/test";
import { elementEverNamed, elementOfRef, inPage } from "../../in-page";
import {
  ToolInputError,
  type FilterData,
  type NamedFilter,
} from "../../shared";
import type { InteractionHistory } from "../domain/interactionHistory";
import type { Cursor, Cursors } from "../domain/cursors";
import type { PageStateSession } from "../application/pageStateSession";
import {
  bindDocument,
  beginDocumentAction,
  captureDocument,
  elementsOf,
  pageOfDocument,
} from "./browserInPage";
import type { PageState, PageStateLook } from "../domain/structuralPageState";
import {
  configurePageStateFiltersOf,
  configurePageStateIgnoreOf,
  cursorsOf,
  existingPageState,
  latestRefOfLocator,
  pageStateOf,
  providePageObjectProbeOf,
  type PageStateHost,
} from "./pageStates";

const browserHosts = new WeakMap<Document, PageStateHost>();

/** The browser runtime's host of `currentDocument`: its module, over its Playwright Lite page. */
function browserHost(currentDocument: Document): PageStateHost {
  let host = browserHosts.get(currentDocument);
  if (!host)
    browserHosts.set(
      currentDocument,
      (host = {
        url: () => currentDocument.URL,
        bind: (onVisit) => bindDocument(currentDocument, onVisit),
        capture: (inputs, ask) => captureDocument(currentDocument, inputs, ask),
        begin: (inputs) => beginDocumentAction(currentDocument, inputs),
        elementsOf,
        elementNamed: elementOfRef,
      })
    );
  return host;
}

/** The page-state store of `currentDocument`, keyed by its Playwright Lite page. */
function storeOf(currentDocument: Document) {
  return pageStateOf(
    pageOfDocument(currentDocument),
    browserHost(currentDocument)
  );
}

/** The browser runtime's Page State Session and captures of its document. */
export function browserPageState() {
  return storeOf(document);
}

/**
 * The document's cursors. Module state is the document's: a new document
 * starts with none, as it starts with an empty Run log.
 */
export const cursors: Cursors = {
  of: (by) => cursorsOf(pageOfDocument(document)).of(by),
};

/**
 * Package-internal: what captures wait for before they read the page, set
 * while the registry observes it. Unset, a capture waits for none.
 */
export function providePageObjectProbe(
  probe: (() => Promise<void>) | undefined
): void {
  providePageObjectProbeOf(pageOfDocument(document), probe);
}

/** Package-internal: set while a runtime session is active, as checked filter data. */
export function configurePageStateIgnore(ignore: FilterData | undefined): void {
  configurePageStateIgnoreOf(pageOfDocument(document), ignore);
}

/**
 * Package-internal: the Custom Tools' filters, as checked, under each tool's
 * name; every capture carries the refs each keeps.
 */
export function configurePageStateFilters(
  filters: readonly NamedFilter[] | undefined
): void {
  configurePageStateFiltersOf(pageOfDocument(document), filters);
}

/**
 * Capture the page state. `cursor` is the reader that receives it, whose
 * cursor moves to the capture: the "before" of its next Change Record. A
 * capture nobody receives moves no cursor.
 */
export async function getPageStateForDocument(
  currentDocument: Document,
  cursor?: Cursor
): Promise<PageState> {
  return getPageStateSession(currentDocument).getPageState(cursor);
}

/**
 * Capture `currentDocument`'s page state without recording it in the
 * interaction history, for a reader that is not a caller (the Inspector).
 */
export async function lookAtPageStateForDocument(
  currentDocument: Document
): Promise<PageStateLook> {
  return storeOf(currentDocument).look();
}

/**
 * Package-internal: the document's interaction history. Creating it records
 * the document's first Visit, so the runtime opens it on start.
 */
export function getInteractionHistory(
  currentDocument: Document
): InteractionHistory {
  return getPageStateSession(currentDocument).history;
}

export async function resolvePageStateRef(
  element: Element
): Promise<AriaRef | undefined> {
  const { refs } = await getPageStateSession(
    element.ownerDocument
  ).getPageStateForElements([element]);
  return connectedRefs([element], refs)[0];
}

export async function getPageStateForElements(
  elements: readonly Element[]
): Promise<{ state: PageState; refs: (AriaRef | undefined)[] }> {
  const currentDocument = elements[0]?.ownerDocument ?? document;
  if (elements.some((element) => element.ownerDocument !== currentDocument))
    throw new ToolInputError(
      "Page State elements must belong to one Document."
    );
  const { state, refs } =
    await getPageStateSession(currentDocument).getPageStateForElements(
      elements
    );
  return { state, refs: connectedRefs(elements, refs) };
}

/** An element no longer in its document has no ref. */
function connectedRefs(
  elements: readonly Element[],
  refs: readonly (AriaRef | undefined)[]
): (AriaRef | undefined)[] {
  return elements.map((element, index) =>
    element.isConnected ? refs[index] : undefined
  );
}

/**
 * Package-internal: calls `listener` each time a page state of
 * `currentDocument` is recorded, until the returned function is called.
 */
export function onPageStateRecorded(
  currentDocument: Document,
  listener: () => void
): () => void {
  return getPageStateSession(currentDocument).onRecorded(listener);
}

/**
 * Package-internal: the Structural Ref the agent's latest recorded page
 * state gave `element`, when it gave it exactly one; undefined until then.
 */
export function latestPageStateRef(element: Element): AriaRef | undefined {
  return existingPageState(
    pageOfDocument(element.ownerDocument)
  )?.session.latestRefOf(element);
}

/**
 * Package-internal: the Structural Ref the agent's latest recorded page
 * state of this document gave the one element `locator` matches, read in
 * the page through its in-page module; undefined for none or several, or
 * until a page state gave it one. Waits for no element.
 */
export async function latestPageStateRefOf(
  locator: Locator
): Promise<AriaRef | undefined> {
  return latestRefOfLocator(
    pageOfDocument(document),
    inPage(locator.page()),
    locator
  );
}

/**
 * Package-internal: the Structural Ref the agent's latest recorded page
 * state gave what the in-page ref `ref` names, when it gave it one.
 */
export function latestPageStateRefNamed(ref: string): AriaRef | undefined {
  const element = elementEverNamed(ref);
  return element && latestPageStateRef(element);
}

/** The last recorded tree and element map; reading it records and captures nothing. */
export function latestPageStateCapture(currentDocument: Document) {
  return existingPageState(
    pageOfDocument(currentDocument)
  )?.session.latestCapture();
}

/**
 * Package-internal: the element the latest recorded page state of
 * `currentDocument` maps `ref` to; undefined until one is recorded, or when
 * that page state printed no such ref.
 */
export function latestPageStateElement(
  currentDocument: Document,
  ref: AriaRef
): Element | undefined {
  return existingPageState(
    pageOfDocument(currentDocument)
  )?.session.latestElementOf(ref);
}

/**
 * Package-internal: the document's Page State Session, created on first use:
 * what a Run hands the tools it runs.
 */
export function getPageStateSession(
  currentDocument: Document
): PageStateSession {
  return storeOf(currentDocument).session;
}

/** The document's page state text, from a capture nobody records. */
export async function capturePageState(): Promise<string> {
  return storeOf(document).capturePageState();
}
