// Stryker disable all
// Locator Recommendation in the document: the locator Playwright's own
// generator writes for one element, relative to a container when there is
// one. The generator and `asLocator` are the pinned InjectedScript's
// (virtual:ayme-aria-snapshot), so recommendations stay what Playwright's
// codegen gives.

/** The pinned InjectedScript's parts Locator Recommendation uses. */
export type SelectorGenerator = {
  InjectedScript: new (
    window: Window,
    options: {
      browserName: string;
      customEngines: never[];
      frameSeq: number;
      isUnderTest: boolean;
      isUtilityWorld: boolean;
      sdkLanguage: string;
      shouldPrependErrorPrefix: boolean;
      stableRafCount: number;
      testIdAttributeName: string;
    }
  ) => unknown;
  generateSelector(
    injectedScript: unknown,
    element: Element,
    options: { testIdAttributeName: string; root?: Element }
  ): { selector: string; elements: Element[] };
  asLocator(language: "javascript", selector: string): string;
};

/** The attribute `getByTestId` reads, as Playwright's default. */
export const DEFAULT_TEST_ID_ATTRIBUTE = "data-testid";

/** A recommender over `generator`, which builds its InjectedScript on first use. */
export function createRecommender(generator: SelectorGenerator) {
  // One per test ID attribute, as the pinned InjectedScript reads it at construction.
  const injectedScripts = new Map<string, unknown>();

  /**
   * The locator for `element`, relative to `container`, checked to address
   * exactly the element or the interactive ancestor the generator picked for
   * it. Throws when it does not.
   */
  return function recommend(
    element: Element,
    container?: Element,
    testIdAttribute = DEFAULT_TEST_ID_ATTRIBUTE
  ): string {
    const window = element.ownerDocument.defaultView;
    if (!window)
      throw new Error("generateLocator: the element has no browser window.");
    let injectedScript = injectedScripts.get(testIdAttribute);
    injectedScript ??= new generator.InjectedScript(window, {
      browserName: "chromium",
      customEngines: [],
      frameSeq: 0,
      isUnderTest: false,
      isUtilityWorld: false,
      sdkLanguage: "javascript",
      shouldPrependErrorPrefix: false,
      stableRafCount: 0,
      testIdAttributeName: testIdAttribute,
    });
    injectedScripts.set(testIdAttribute, injectedScript);
    const { selector, elements } = generator.generateSelector(
      injectedScript,
      element,
      {
        testIdAttributeName: testIdAttribute,
        ...(container ? { root: container } : {}),
      }
    );
    const locator = generator.asLocator("javascript", selector);
    const [match] = elements;
    if (elements.length !== 1 || !match || !selfOrAncestor(match, element))
      throw new Error(
        `generateLocator: ${locator} does not resolve to exactly the element (${elements.length} matches).`
      );
    return locator;
  };
}

/** Whether `candidate` is `element` or holds it, across shadow roots. */
function selfOrAncestor(candidate: Element, element: Element): boolean {
  for (let node: Node | null = element; node;) {
    if (node === candidate) return true;
    node =
      node.parentElement ?? (node.getRootNode() as ShadowRoot).host ?? null;
  }
  return false;
}
