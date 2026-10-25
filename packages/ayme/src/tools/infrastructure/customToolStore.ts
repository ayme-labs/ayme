// The Custom Tools of the current runtime session, and the element tools
// they join.
import { SINGLE_ELEMENT_TOOLS } from "../application/browserTools";
import {
  registerCustomTool,
  type CustomTool,
  type RegisteredElementTool,
} from "../application/elementTools";

type CustomToolStore = { registered?: readonly RegisteredElementTool[] };

// On globalThis, so every bundle that loads Ayme in one process shares one
// session's Custom Tools.
const customToolStore: CustomToolStore = ((
  globalThis as typeof globalThis & { __aymeCustomToolStore?: CustomToolStore }
).__aymeCustomToolStore ??= {});

/** Package-internal: set while a runtime session is active. */
export function configureCustomTools(
  customTools: readonly CustomTool[] | undefined
): void {
  customToolStore.registered = customTools?.map(registerCustomTool);
}

/** Package-internal: the Custom Tools of the active session, in registration order. */
export function listCustomTools(): readonly RegisteredElementTool[] {
  return customToolStore.registered ?? [];
}

/**
 * Package-internal: the single-element Browser Tools and the session's Custom
 * Tools, in publication order. Each is published and the Goal Loop may choose
 * it (ADR-0023).
 */
export function listElementTools(): readonly RegisteredElementTool[] {
  return [...SINGLE_ELEMENT_TOOLS, ...listCustomTools()];
}
