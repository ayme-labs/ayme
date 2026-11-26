// The in-page module's page part, built into self-contained functions by
// build/inPageModule.ts, the plugin the build and the test lanes load.
declare module "virtual:ayme-in-page" {
  export const installInPage: typeof import("./page/install").install;
  export const callInPage: typeof import("./page/call").call;
  export const callOnInPage: typeof import("./page/callOn").callOn;
  export const aymeRefEngine: typeof import("./page/refEngine").engine;
}

// Playwright's pinned `captureAriaSnapshot`, with marks and a ref counter its
// caller owns, its selector generator and `asLocator`, and the role,
// accessible name and hiddenness its capture reads
// (build/pinnedAriaSnapshot.ts).
declare module "virtual:ayme-aria-snapshot" {
  export const captureAriaSnapshot: import("./page/capture").CaptureAriaSnapshot;
  export const isElementVisible: (element: Element) => boolean;
  export const getAriaRole: (element: Element) => string | null;
  export const getElementAccessibleName: (
    element: Element,
    includeHidden: boolean
  ) => { text: string };
  export const normalizeWhiteSpace: (text: string) => string;
  export const isElementHiddenForAria: (element: Element) => boolean;
  export const InjectedScript: import("./page/recommend").SelectorGenerator["InjectedScript"];
  export const generateSelector: import("./page/recommend").SelectorGenerator["generateSelector"];
  export const asLocator: import("./page/recommend").SelectorGenerator["asLocator"];
}
