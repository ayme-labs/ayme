import type { Plugin } from "vite";

import { unplugin } from "./unplugin";
import type { AymeOptions } from "./options";

export type { AymeOptions, AymePlaywrightOptions } from "./options";

// Declared with Vite's own type so the published declarations do not pull in
// unplugin's, which import every bundler it supports. The factory returns a
// single plugin.
export const ayme = unplugin.vite as (options?: AymeOptions) => Plugin;

export default ayme;
