// The plugin's option types. The factory lives in ./unplugin: its unplugin
// types import every bundler unplugin supports, which a consumer without them
// cannot type-check. The root carries types only; the bundler entries carry
// the code.
export type { AymeOptions, AymePlaywrightOptions, AymeReport } from "./options";
