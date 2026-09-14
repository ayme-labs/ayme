import type { PomDefinitionsResult } from "./contracts";
import { getPageContextForDocument, type PageContext } from "./pageContext";
import { getPageStateForDocument, type PageState } from "./pageState";
import { getPomDefinitions } from "./pomDefinitions";

export type Ayme = {
  getPageContext(...names: readonly string[]): Promise<PageContext>;
  getPageState(): Promise<PageState>;
  getPomDefinitions(...names: readonly string[]): PomDefinitionsResult;
};

export const ayme: Ayme = {
  getPageContext: (...names) =>
    getPageContextForDocument(requireCurrentDocument(), ...names),
  getPageState: async () => getPageStateForDocument(requireCurrentDocument()),
  getPomDefinitions,
};

export default ayme;

function requireCurrentDocument(): Document {
  if (typeof document === "undefined")
    throw new Error("Ayme requires a browser Document.");
  return document;
}
