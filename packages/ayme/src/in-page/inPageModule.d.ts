// The in-page module's page part, built into one self-contained function by
// build/inPageModule.ts, the plugin the build and the test lanes load.
declare module "virtual:ayme-in-page" {
  export const installInPage: typeof import("./page/install").install;
}
