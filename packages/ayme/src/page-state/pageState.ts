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
  type StructuralActionId,
  type StructuralObservationEntry,
} from "@ayme-dev/core/structural-observation";
import { browserMonotonicClock, ToolInputError } from "../shared";
import { createCursors, type Cursor, type Cursors } from "./cursors";
import { InteractionHistory, type ToolCall } from "./interactionHistory";
import { watchSameDocumentNavigations } from "./navigation";
import {
  capturePage,
  type PageCaptureSources,
  type PageObjectStructure,
} from "./pageCapture";
import { PageStateSession } from "./pageStateSession";
import { SyntheticRootRefFactory } from "./pomRootPlacement";
import {
  renderPageState,
  type PageState,
  type PageStateCapture,
  type PageStateLook,
  type RefResolution,
} from "./structuralPageState";

const pageStateSessions = new WeakMap<Document, PageStateSession>();

/**
 * The document's cursors. Module state is the document's: a new document
 * starts with none, as it starts with an empty Run log.
 */
export const cursors: Cursors = createCursors();

type PageObjectStructureSource = () => Promise<PageObjectStructure>;

let pageObjectStructure: PageObjectStructureSource | undefined;

/**
 * Package-internal: where captures read the Page Object Roots from, set
 * while the registry observes the page. Unset, a capture places none, as
 * when no Page Object is registered.
 */
export function providePageObjectStructure(
  source: PageObjectStructureSource | undefined
): void {
  pageObjectStructure = source;
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
  pageObjectStructure: () => pageObjectStructure?.(),
  ignores: (element) => pageStateIgnoreStore.ignore?.(element) ?? false,
};

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
 * Package-internal: capture the current page state and return its typed data.
 * `cursor` is the reader that receives the capture, whose cursor moves to it:
 * the "before" of its next Change Record.
 */
export async function getPageStateCaptureForDocument(
  currentDocument: Document,
  options: { cursor?: Cursor } = {}
): Promise<PageStateCapture> {
  return getPageStateSession(currentDocument).getPageStateCapture(
    options.cursor
  );
}

/**
 * Capture `currentDocument`'s page state without recording it in the
 * interaction history, for a reader that is not a caller (the Inspector).
 */
export async function lookAtPageStateForDocument(
  currentDocument: Document
): Promise<PageStateLook> {
  return getPageStateSession(currentDocument).look();
}

/**
 * Package-internal: start a Structural Action for a tool call. An action
 * needs a page to compare against, so a session that has observed nothing
 * yet captures once first.
 */
export async function startActionForDocument(
  currentDocument: Document,
  call: ToolCall
): Promise<StructuralActionId> {
  return getPageStateSession(currentDocument).startAction(call);
}

/**
 * Package-internal: the before capture of an action that has started: the
 * page right before its tool runs, recorded as the action's "before"
 * observation only when it differs from the latest observation, so an idle
 * page between two Runs costs no observation. Moves no cursor. Returns the
 * observation when one was recorded.
 */
export async function captureBeforeActionForDocument(
  currentDocument: Document,
  actionId: StructuralActionId
): Promise<StructuralObservationEntry | undefined> {
  return getPageStateSession(currentDocument).captureBefore(actionId);
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

/** Resolve refs through the current document's session and a fresh capture. */
export async function resolvePageStateRefs(
  currentDocument: Document,
  ...refs: AriaRef[]
): Promise<RefResolution[]> {
  return getPageStateSession(currentDocument).resolveRefs(refs);
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

/** Package-internal: the document's Page State Session, created on first use. */
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
 * first Visit and records each same-document navigation after it, and its
 * captures share one synthetic ref factory, for recorded captures and
 * looks alike, so a root keeps one ref across them.
 */
function createPageStateSession(currentDocument: Document): PageStateSession {
  const history = new InteractionHistory({
    pageId: PageIdSchema.parse(`document_${++documentCount}`),
    url: currentDocument.URL,
    clock: browserMonotonicClock,
  });
  const view = currentDocument.defaultView;
  if (view)
    watchSameDocumentNavigations(view, () =>
      history.recordNavigation(currentDocument.URL)
    );
  const refFactory = new SyntheticRootRefFactory();
  return new PageStateSession(history, () =>
    capturePage(currentDocument.body, refFactory, captureSources)
  );
}

export async function capturePageState(
  root: Element = document.body
): Promise<string> {
  return renderPageState(
    await capturePage(root, new SyntheticRootRefFactory(), captureSources)
  ).text;
}
