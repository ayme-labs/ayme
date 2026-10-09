import type { PomCompilerOptions } from "./pomProgram";

// Keep published declarations usable without the optional Playwright peer.
// The type contract test checks this subset against Playwright's exported type.
type SupportedPlaywrightUse = {
  testIdAttribute?: string;
  actionTimeout?: number;
  navigationTimeout?: number;
};

export type AymePlaywrightOptions = {
  config?: string;
  project?: string;
  use?: SupportedPlaywrightUse;
};

/**
 * Which public methods of Page Object Models a build lists as not being
 * tools: none, those whose parameters have no schema, or every one.
 */
export type AymeReport = "none" | "unsupported" | "all";

export type AymeOptions = PomCompilerOptions & {
  playwright?: AymePlaywrightOptions;
  report?: AymeReport;
};
