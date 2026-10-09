// The factory lives in ./unplugin: its unplugin types import every bundler
// unplugin supports, which a consumer without them cannot type-check.
export { createPomCompiler, derivePomManifests } from "./derivePomManifests";
export type { PomCompiler, PomCompilerOptions } from "./derivePomManifests";
export type { AymeOptions, AymePlaywrightOptions, AymeReport } from "./options";
