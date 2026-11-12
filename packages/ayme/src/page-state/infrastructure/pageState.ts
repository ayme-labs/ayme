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
import { inPage } from "../../in-page";
import type { NamedFilter, SessionFilter } from "../../shared";
import type { InteractionHistory } from "../domain/interactionHistory";
import type { Cursor, Cursors } from "../domain/cursors";
import type { PageStateSession } from "../application/pageStateSession";
import {
  bindDocument,
  beginDocumentAction,
  captureDocument,
  forgetInDocument,
  matchInDocument,
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
  providePageObjectIdsOf,
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
        match: (locator, key) => matchInDocument(currentDocument, locator, key),
        forget: (keys) => forgetInDocument(currentDocument, keys),
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

/**
 * Package-internal: what the document's page state text reads the id of each
 * Page Object Root from, set while the registry observes it.
 */
export function providePageObjectIds(
  rootIds: Parameters<typeof providePageObjectIdsOf>[1]
): void {
  providePageObjectIdsOf(pageOfDocument(document), rootIds);
}

/** Package-internal: set while a runtime session is active, as the session registered it. */
export function configurePageStateIgnore(
  ignore: SessionFilter | undefined
): void {
  configurePageStateIgnoreOf(pageOfDocument(document), ignore);
}

/**
 * Package-internal: the Custom Tools' filters, as the session registered
 * them, under each tool's name; every capture carries the refs each keeps.
 */
export function configurePageStateFilters(
  filters: readonly NamedFilter<SessionFilter>[] | undefined
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
  return existingPageState(pageOfDocument(document))?.session.latestRefOfNamed(
    ref
  );
}

/** The last recorded tree; reading it records and captures nothing. */
export function latestPageStateCapture(currentDocument: Document) {
  return existingPageState(
    pageOfDocument(currentDocument)
  )?.session.latestCapture();
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
