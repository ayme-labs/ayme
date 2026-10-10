import { renderSchema } from "@ayme-dev/ayme/internal";

import { actionSignature } from "../../page-model";
import type { SchemaText } from "../domain/fields";

/** Schemas as the definition text agents read writes them. */
export const schemaText: SchemaText = {
  type: renderSchema,
  signature: actionSignature,
};
