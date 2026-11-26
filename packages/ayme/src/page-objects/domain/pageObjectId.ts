import { z } from "zod";

/**
 * The id of a Page Object of a rooted class, written `po<n>`: what a caller
 * names the Page Object by when it calls one of its Page Object Tools. It is
 * not a Structural Ref, which names an element, and neither is assignable
 * to the other.
 */
export const PageObjectIdSchema = z
  .string()
  .regex(/^po[1-9]\d*$/)
  .brand<"PageObjectId">();
export type PageObjectId = z.infer<typeof PageObjectIdSchema>;

/** `text` as a Page Object id, when it is written as one: `po<n>`. */
export function parsePageObjectId(text: unknown): PageObjectId | undefined {
  const parsed = PageObjectIdSchema.safeParse(text);
  return parsed.success ? parsed.data : undefined;
}

/** The `n`th Page Object id a source gives out, from 1. */
export function pageObjectIdOf(n: number): PageObjectId {
  return PageObjectIdSchema.parse(`po${n}`);
}
