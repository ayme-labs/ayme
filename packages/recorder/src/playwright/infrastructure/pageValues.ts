import * as z from "zod/mini";

import type { Modifier } from "./pageRules";

// What a page hands the adapter's page functions, and the types of it. Any
// script of the page can call those functions, with anything, so a value is
// taken only in the shape the adapter's own in-page code sends: another
// would throw in Node later, where nothing catches it, or hold the page's
// inputs back for good, as a number the gate counts by that is no number.

/** The gate numbers the inputs a document held from 1. */
const SeqSchema = z.int().check(z.positive());
const ModifiersSchema = z.readonly(
  z.array(z.enum(["Alt", "Control", "Meta", "Shift"] satisfies Modifier[]))
);
/** The document it was held in. */
const DocumentSchema = z.string();

const HeldClickSchema = z.readonly(
  z.object({ document: DocumentSchema, seq: SeqSchema })
);

const HeldByPageSchema = z.union([
  z.readonly(
    z.object({
      kind: z.literal("click"),
      seq: SeqSchema,
      /** Where it was, in its own document's viewport. */
      x: z.number(),
      y: z.number(),
      /** The click's count: 2 for the second click of a double click, 0 for
       * one from the keyboard. */
      detail: z.int().check(z.nonnegative()),
      /** The button, the left one when it is not said. */
      button: z.optional(z.enum(["right", "middle"])),
      modifiers: ModifiersSchema,
      document: DocumentSchema,
    })
  ),
  z.readonly(
    z.object({
      kind: z.literal("key"),
      seq: SeqSchema,
      /** Typing, as opposed to a key press Playwright records as a press. */
      typing: z.boolean(),
      /** It went to the document itself: no element had focus. */
      nothingFocused: z.boolean(),
      key: z.string(),
      code: z.string(),
      modifiers: ModifiersSchema,
      document: DocumentSchema,
    })
  ),
]);

const InputNoteSchema = z.readonly(
  z.object({
    type: z.string(),
    /** From the element the input acted on, as Playwright's selector names
     * it, up: the refs Playwright's recorder gave each, null where it gave
     * none. */
    chain: z.readonly(z.array(z.nullable(z.string()))),
    /** The ref of the element under the pointer, which Playwright's report
     * names as its ref. */
    under: z.nullable(z.string()),
    /** The held click the event is; null for an event that is no held
     * click's. */
    held: z.nullable(HeldClickSchema),
  })
);

/** What a page tells of an input it held back. */
export type HeldByPage = z.infer<typeof HeldByPageSchema>;

/** A page's note of an input: the event, the refs of the element it acted
 * on and its ancestors, nearest first, the ref of the element under the
 * pointer, which Playwright's report names, and the held click the event
 * is, if it is one (the in-page `TargetChain`). */
export type InputNote = z.infer<typeof InputNoteSchema>;

/** Whether a value is an input the gate held, as it tells of one. */
export const isHeldByPage = (value: unknown): value is HeldByPage =>
  HeldByPageSchema.safeParse(value).success;

/** Whether a value is a note of an input's target, as the target watch
 * tells of one. */
export const isInputNote = (value: unknown): value is InputNote =>
  InputNoteSchema.safeParse(value).success;
