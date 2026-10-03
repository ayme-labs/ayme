// A runtime implementation of the combined shape: today's decorator, with the
// internal helper's operations copied onto a wrapper function.
import { ayme as decorator } from "../../../../../packages/ayme/dist/index.mjs";
import { ayme as helper } from "../../../../../packages/ayme/dist/internal.mjs";

export const ayme = Object.assign(
  function ayme(...args) {
    return decorator(...args);
  },
  { action: decorator.action },
  helper
);
