// Runtime, not publication: the Page State Session and its
// interaction history import nothing from the publication side (`webMcp.ts`,
// tool schema rendering, anything touching `document.modelContext`); the
// publication side calls in, never the reverse.
//
// The slice's composition: every module-level store of page-state lives
// here, and the functions other slices reach a document's Page State
// Session through take the document.

import {
  PageIdSchema,
  type AriaRef,
} from "@ayme-dev/core/structural-observation";
import type { Locator } from "@playwright/test";
import { elementEverNamed, inPage, type ElementInputs } from "../../in-page";
import {
  browserMonotonicClock,
  INSPECTOR_HOST_SELECTOR,
  PREDICATES,
  ToolInputError,
  type Capture,
  type Predicate,
} from "../../shared";
import { structureCapture, treeRefAllocator } from "../domain/capturedPage";
import { createCursors, type Cursor, type Cursors } from "../domain/cursors";
import { InteractionHistory } from "../domain/interactionHistory";
import { PageStateSession } from "../application/pageStateSession";
import {
  beginDocumentAction,
  bindDocument,
  captureDocument,
  elementsOf,
} from "./browserInPage";
import {
  renderPageState,
  type PageState,
  type PageStateLook,
} from "../domain/structuralPageState";

const pageStateSessions = new WeakMap<Document, PageStateSession>();

/** What a capture reads besides the document, read afresh on each capture. */
type PageCaptureSources = {
  /**
   * Resolves once the Page Object Roots a capture places, which the module
   * holds from the registry's probe runs, are current; undefined while no
   * Page Object is registered.
   */
  pageObjectsProbed(): Promise<void> | undefined;
  /** Whether the app leaves `element`, and everything under it, out. */
  ignores(element: Element): boolean;
};

/**
 * The document's cursors. Module state is the document's: a new document
 * starts with none, as it starts with an empty Run log.
 */
export const cursors: Cursors = createCursors();

type PageObjectProbe = () => Promise<void>;

let pageObjectProbe: PageObjectProbe | undefined;

/**
 * Package-internal: what captures wait for before they read the page, set
 * while the registry observes it: the roots the module places are those of a
 * completed probe run. Unset, a capture waits for none, as when no Page
 * Object is registered.
 */
export function providePageObjectProbe(
  probe: PageObjectProbe | undefined
): void {
  pageObjectProbe = probe;
}

type PageStateIgnorePredicate = (element: Element) => boolean;

type PageStateIgnoreStore = { ignore?: PageStateIgnorePredicate };

const pageStateIgnoreStore: PageStateIgnoreStore = ((
  globalThis as typeof globalThis & {
    __aymePageStateIgnoreStore?: PageStateIgnoreStore;
  }
).__aymePageStateIgnoreStore ??= {});

/** Package-internal: set while a runtime session is active. */
export function configurePageStateIgnore(
  ignore: PageStateIgnorePredicate | undefined
): void {
  pageStateIgnoreStore.ignore = ignore;
}

/** The stores a capture reads, read when it reads them. */
const captureSources: PageCaptureSources = {
  pageObjectsProbed: () => pageObjectProbe?.(),
  ignores: (element) => pageStateIgnoreStore.ignore?.(element) ?? false,
};

/**
 * What a capture leaves out: the `ignore` of this runtime, and the
 * Inspector's own DOM, always. The Page Object Roots it places are those the
 * module holds from the registry's probe runs, current once the probe it
 * waits for has resolved.
 */
async function elementInputs(): Promise<ElementInputs> {
  await captureSources.pageObjectsProbed();
  return {
    ignores: (element) =>
      element.matches(INSPECTOR_HOST_SELECTOR) ||
      captureSources.ignores(element),
  };
}

/** A capture of `currentDocument` through its in-page module, with `elementInputs`. */
async function captureWithSources(
  currentDocument: Document,
  accepts?: readonly Predicate[]
): Promise<Capture> {
  return captureDocument(currentDocument, await elementInputs(), accepts);
}

let documentCount = 0;

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
  // The Inspector offers each tool the refs it takes, so a look carries them.
  return getPageStateSession(currentDocument).look({ accepts: PREDICATES });
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
  return pageStateSessions.get(element.ownerDocument)?.latestRefOf(element);
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
  const refs = await inPage(locator.page()).elements.refs(locator);
  const ref = refs.length === 1 ? (refs[0] as AriaRef | undefined) : undefined;
  return ref !== undefined &&
    pageStateSessions.get(document)?.latestElementOf(ref)
    ? ref
    : undefined;
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
  return pageStateSessions.get(currentDocument)?.latestCapture();
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
  return pageStateSessions.get(currentDocument)?.latestElementOf(ref);
}

/**
 * Package-internal: the document's Page State Session, created on first use:
 * what a Run hands the tools it runs.
 */
export function getPageStateSession(
  currentDocument: Document
): PageStateSession {
  let session = pageStateSessions.get(currentDocument);
  if (!session) {
    session = createPageStateSession(currentDocument);
    pageStateSessions.set(currentDocument, session);
  }
  return session;
}

/**
 * A session over `currentDocument`: its history starts with the document's
 * first Visit and records each same-document navigation its in-page module
 * reports after it. Creating it installs the document's in-page module, or
 * binds to the one there, so a runtime that starts first is the one that
 * installs it; a navigation before then is recorded once it is bound. Its
 * actions run through the module: the before capture, the Settled Page wait
 * and the after capture, or the full load that ends them.
 */
function createPageStateSession(currentDocument: Document): PageStateSession {
  const history = new InteractionHistory({
    pageId: PageIdSchema.parse(`document_${++documentCount}`),
    url: currentDocument.URL,
    clock: browserMonotonicClock,
  });
  let url = currentDocument.URL;
  bindDocument(currentDocument, (visit) => {
    if (visit.cause === "initial" && visit.url === url) return;
    url = visit.url;
    history.recordNavigation(visit.url);
  });
  return new PageStateSession(
    history,
    (accepts) => captureWithSources(currentDocument, accepts),
    { begin: () => beginDocumentAction(currentDocument, elementInputs) },
    elementsOf
  );
}

/** The document's page state text, from a capture nobody records. */
export async function capturePageState(): Promise<string> {
  return renderPageState(
    structureCapture(await captureWithSources(document), treeRefAllocator())
  ).text;
}
