// The browser runtime as a host of its document's in-page module: the
// Playwright Lite page through which it installs the module, captures, runs
// its actions and hears of its Visits.
import { createPage } from "@ayme-dev/playwright-lite";
import type { Locator, Page } from "@playwright/test";
import {
  inPage,
  type ActionInputs,
  type ElementInputs,
  type InPage,
  type VisitSignal,
} from "../../in-page";
import type { Capture, NamedFilter, Predicate } from "../../shared";
import type { PageAction } from "../application/pageStateSession";

const browserPages = new WeakMap<Document, Page>();

/** The Playwright Lite page of `currentDocument`, created on first use. */
function browserPageOf(currentDocument: Document): Page {
  let page = browserPages.get(currentDocument);
  if (!page) browserPages.set(currentDocument, (page = createPage()));
  return page;
}

/** The in-page module of `currentDocument`, as the browser runtime hosts it. */
export function browserInPage(currentDocument: Document = document): InPage {
  return inPage(browserPageOf(currentDocument));
}

/**
 * The Playwright Lite page that hosts `currentDocument`'s module: the Page the
 * runtime highlights and picks through for the Inspector contract, and Demo
 * Mode's click cue reads geometry through.
 */
export function pageOfDocument(currentDocument: Document): Page {
  return browserPageOf(currentDocument);
}

/**
 * Installs `currentDocument`'s in-page module, or binds to the one there,
 * and calls `onVisit` once it is bound and after each same-document
 * navigation in it. Every capture binds too, and reports what fails here.
 */
export function bindDocument(
  currentDocument: Document,
  onVisit: (visit: VisitSignal) => void
): void {
  void Promise.resolve()
    .then(() => {
      const module = inPage(browserPageOf(currentDocument));
      module.onVisit(onVisit);
      return module.bound();
    })
    .catch(() => {});
}

/** A capture of `currentDocument` through its module, with these roots and exclusions. */
export async function captureDocument(
  currentDocument: Document,
  inputs: ElementInputs,
  ask: { accepts?: readonly Predicate[]; filters?: readonly NamedFilter[] } = {}
): Promise<Capture> {
  const page = browserPageOf(currentDocument);
  // The inputs are plain data, which the module reads in the page
  // (ADR-0049); the handle carries them to Playwright Lite's page function.
  const elements = await page.evaluateHandle(() => inputs);
  try {
    return await inPage(page).capture({
      elements,
      ...(ask.accepts ? { accepts: ask.accepts } : {}),
      ...(ask.filters?.length ? { filters: ask.filters } : {}),
    });
  } finally {
    void elements.dispose();
  }
}

/**
 * Hands `currentDocument`'s module the elements `locator` matches now, under
 * `key`, for the browser runtime's captures.
 */
export function matchInDocument(
  currentDocument: Document,
  locator: Locator,
  key: string
): Promise<void> {
  return inPage(browserPageOf(currentDocument)).match(locator, key);
}

/** Has `currentDocument`'s module drop the matches the browser runtime handed under `keys`. */
export async function forgetInDocument(
  currentDocument: Document,
  keys: readonly string[]
): Promise<void> {
  await inPage(browserPageOf(currentDocument)).forget(keys);
}

/**
 * Begins an action on `currentDocument` through its module: the before
 * capture, and the action, whose captures read `inputs` again each, as the
 * registry probes its roots right before each capture.
 */
export async function beginDocumentAction(
  currentDocument: Document,
  inputs: () => Promise<ElementInputs>
): Promise<PageAction> {
  const page = browserPageOf(currentDocument);
  // Playwright Lite calls the page function as it is, so the handle holds
  // the function itself (transitional: #1175, #1177).
  const elements = await page.evaluateHandle<ActionInputs>(() => inputs);
  try {
    const action = await inPage(page).begin({ elements });
    return {
      before: action.before,
      perform: (perform) =>
        action.perform(perform).finally(() => void elements.dispose()),
    };
  } catch (error) {
    void elements.dispose();
    throw error;
  }
}
