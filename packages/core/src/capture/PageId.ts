import { z } from "zod";

/** Identifies the browsing context a Visit happens in, whatever host drives it. */
export const PageIdSchema = z.string().brand<"PageId">();
export type PageId = z.infer<typeof PageIdSchema>;
