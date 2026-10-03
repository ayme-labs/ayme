// The combined shape under investigation: today's decorator with the internal
// helper's operations as properties. Types only; nothing here is shipped.
import type { ayme as decorator } from "../../../../../packages/ayme/dist/index.mjs";
import type { Ayme } from "../../../../../packages/ayme/dist/internal.mjs";

export declare const ayme: typeof decorator & Ayme;
