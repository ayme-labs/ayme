import type { PomDefinitionsResult } from "./contracts";
import { getPageContextForDocument, type PageContext } from "./pageContext";
import {
  getPageStateForDocument,
  type AriaRef,
  type PageState,
} from "./pageState";
import { getPomDefinitions } from "./pomDefinitions";
import { type ActionResult } from "./actionSequence";
import { clickRef, fillRef } from "./refTools";
import { RuntimeStateError } from "./errors";

export type Ayme = {
  getPageContext(...names: readonly string[]): Promise<PageContext>;
  getPageState(): Promise<PageState>;
  getPomDefinitions(...names: readonly string[]): PomDefinitionsResult;
  click(ref: AriaRef): Promise<ActionResult>;
  fill(ref: AriaRef, value: string): Promise<ActionResult>;
};

export const ayme: Ayme = {
  getPageContext: (...names) =>
    getPageContextForDocument(requireCurrentDocument(), ...names),
  getPageState: async () => getPageStateForDocument(requireCurrentDocument()),
  getPomDefinitions,
  click: async (ref) => clickRef(ref),
  fill: async (ref, value) => fillRef(ref, value),
};

export default ayme;

function requireCurrentDocument(): Document {
  if (typeof document === "undefined")
    throw new RuntimeStateError("Ayme requires a browser Document.");
  return document;
}
