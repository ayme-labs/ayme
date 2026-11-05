// The browser runtime as a host of its document's in-page module: the
// Playwright Lite page through which it installs the module and captures,
// and the transitional lookup of elements by ref (#1182).
import { createPage } from "@ayme-dev/playwright-lite";
import type { Page } from "@playwright/test";
import { elementOfRef, inPage, type ElementInputs } from "../../in-page";
import type { Capture } from "../../shared";
import type { ElementsOf } from "../application/pageStateSession";

const browserPages = new WeakMap<Document, Page>();

/** The Playwright Lite page of `currentDocument`, created on first use. */
function browserPageOf(currentDocument: Document): Page {
  let page = browserPages.get(currentDocument);
  if (!page) browserPages.set(currentDocument, (page = createPage()));
  return page;
}

/**
 * Installs `currentDocument`'s in-page module, or binds to the one there.
 * Every capture binds too, and reports what fails here.
 */
export function bindDocument(currentDocument: Document): void {
  void Promise.resolve()
    .then(() => inPage(browserPageOf(currentDocument)).bound())
    .catch(() => {});
}

/** A capture of `currentDocument` through its module, with these roots and exclusions. */
export async function captureDocument(
  currentDocument: Document,
  inputs: ElementInputs
): Promise<Capture> {
  const page = browserPageOf(currentDocument);
  // Playwright Lite calls the page function as it is, so the handle holds
  // these live values (transitional: #1175, #1177).
  const elements = await page.evaluateHandle(() => inputs);
  try {
    return await inPage(page).capture({ elements });
  } finally {
    void elements.dispose();
  }
}

/** Transitional (#1182): the elements refs name, through the document's module. */
export const elementsOf: ElementsOf = (refs) =>
  new Map(
    refs.flatMap((ref) => {
      const element = elementOfRef(ref);
      return element ? [[ref, element] as const] : [];
    })
  );
