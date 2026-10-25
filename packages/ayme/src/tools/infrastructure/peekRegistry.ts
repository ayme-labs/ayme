import {
  createPeekRegistry,
  emptyPeekStore,
  type PeekStore,
} from "../application/peek";

// On globalThis, so every bundle that loads Ayme in one process shares one
// set of Peeks.
const store: PeekStore = ((
  globalThis as typeof globalThis & { __aymePeekRegistry?: PeekStore }
).__aymePeekRegistry ??= emptyPeekStore());

/** The process's one Peek registry, shared by every copy of the bundle. */
export const { addPeek, isPeekTool, listPeekTools, subscribeToPeekTools } =
  createPeekRegistry(store);
