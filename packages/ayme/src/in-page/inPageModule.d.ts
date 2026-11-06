// The in-page module's page part, built into self-contained functions by
// build/inPageModule.ts, the plugin the build and the test lanes load.
declare module "virtual:ayme-in-page" {
  export const installInPage: typeof import("./page/install").install;
  export const callInPage: typeof import("./page/call").call;
  export const callOnInPage: typeof import("./page/callOn").callOn;
  export const aymeRefEngine: typeof import("./page/refEngine").engine;
}

// Playwright's pinned `captureAriaSnapshot`, with marks and a ref counter its
// caller owns (build/pinnedAriaSnapshot.ts).
declare module "virtual:ayme-aria-snapshot" {
  export const captureAriaSnapshot: import("./page/capture").CaptureAriaSnapshot;
  export const isElementVisible: (element: Element) => boolean;
}
