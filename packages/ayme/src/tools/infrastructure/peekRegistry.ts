import type { Page } from "@playwright/test";
import { pageOfDocument } from "../../page-state/infrastructure";
import { createPeekRegistry, emptyPeekStore } from "../application/peek";

type Peeks = ReturnType<typeof createPeekRegistry>;

const peeksByPage = new WeakMap<Page, Peeks>();

/** Package-internal: the Peeks of the runtime session on `page`, kept per Page (ADR-0049). */
export function peeksOf(page: Page): Peeks {
  let found = peeksByPage.get(page);
  if (!found)
    peeksByPage.set(page, (found = createPeekRegistry(emptyPeekStore())));
  return found;
}

/** Package-internal: the Peeks of the document's session. */
function sessionPeeks(): Peeks {
  return peeksOf(pageOfDocument(document));
}

export const listPeekTools: Peeks["listPeekTools"] = () =>
  sessionPeeks().listPeekTools();
