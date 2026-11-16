import type { Page } from "@playwright/test";
import { pageOfDocument } from "../../page-state/infrastructure";
import {
  createPeekRegistry,
  emptyPeekStore,
  type PeekStore,
} from "../application/peek";

type Peeks = ReturnType<typeof createPeekRegistry>;

const peeksByPage = new WeakMap<Page, Peeks>();

/** Package-internal: the Peeks of the runtime session on `page`, kept per Page (ADR-0049). */
export function peeksOf(page: Page): Peeks {
  let found = peeksByPage.get(page);
  if (!found)
    peeksByPage.set(page, (found = createPeekRegistry(emptyPeekStore())));
  return found;
}

// A Node process of the app (an App Process) has no Page. Its Peeks are the
// process's, shared by every copy of the bundle that loads Ayme in it, so
// they live on `globalThis`, the one store outside the in-page module's slot.
const processStore: PeekStore = ((
  globalThis as typeof globalThis & { __aymePeekRegistry?: PeekStore }
).__aymePeekRegistry ??= emptyPeekStore());
export const processPeeks = createPeekRegistry(processStore);

/**
 * Package-internal: the Peeks of the session that calls: the document's in
 * the browser, the process's in Node.
 */
function sessionPeeks(): Peeks {
  return typeof window === "undefined"
    ? processPeeks
    : peeksOf(pageOfDocument(document));
}

export const addPeek: Peeks["addPeek"] = (...args) =>
  sessionPeeks().addPeek(...args);
export const isPeekTool: Peeks["isPeekTool"] = (tool) =>
  sessionPeeks().isPeekTool(tool);
export const listPeekTools: Peeks["listPeekTools"] = () =>
  sessionPeeks().listPeekTools();
export const subscribeToPeekTools: Peeks["subscribeToPeekTools"] = (listener) =>
  sessionPeeks().subscribeToPeekTools(listener);
