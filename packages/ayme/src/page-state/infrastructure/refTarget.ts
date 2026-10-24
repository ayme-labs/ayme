import { resolvePageStateRefs } from "./pageState";
import { resolveRequestedRef } from "../application/refResolution";
import type { AymeNode } from "../domain/structuralPageState";

/**
 * Package-internal: the node a tool's Structural Ref addresses now in
 * `currentDocument`, the one resolver every tool's `ref` goes through,
 * against a fresh capture of the document's Page State Session.
 */
export async function resolveRef(
  requested: string,
  label: string,
  currentDocument: Document
): Promise<AymeNode> {
  return resolveRequestedRef(requested, label, (...refs) =>
    resolvePageStateRefs(currentDocument, ...refs)
  );
}
