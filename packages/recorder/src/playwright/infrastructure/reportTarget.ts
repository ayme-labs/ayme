import { pictureRef, type InteractionReport } from "../../timeline/domain";
import type { HeldClick } from "./pageRules";
import type { InputNote } from "./pageValues";

export type { InputNote };

/** A click a page told of that reached it, sent on or untouched, whose
 * report has not come: which it is, its count and its button. */
export type AwaitedClick = HeldClick & {
  readonly count: number;
  readonly button: "left" | "right" | "middle";
};

/** The reports of an input of the mouse: the element under the pointer can
 * be inside the one it acted on. */
const MOUSE_REPORTS = new Set(["click", "check", "uncheck"]);

/** The events whose target a report of each kind names. */
const CHAIN_TYPES: Readonly<Record<string, readonly string[]>> = {
  click: ["click", "contextmenu", "auxclick"],
  check: ["click", "keydown"],
  uncheck: ["click", "keydown"],
  press: ["keydown"],
  fill: ["input"],
  select: ["input"],
};

/**
 * The held clicks of a page whose reports can still come, once another is
 * sent on. Playwright holds back at most one report, a click's, to see
 * whether a double click follows (1.63 and later), and gives it with the
 * next input's: of the clicks sent on before, only the last can still be
 * reported.
 */
export function sentOn(
  awaited: readonly AwaitedClick[],
  click: AwaitedClick
): AwaitedClick[] {
  return [...awaited.slice(-1), click];
}

/** Whether a report can be of a click: a click's report names its button
 * and its count. A check's and an uncheck's name neither: they are of a
 * single left or middle click (the lifecycle's `reportsClickOf`). */
const reportsClick = (
  action: {
    readonly name: string;
    readonly button?: unknown;
    readonly clickCount?: unknown;
  },
  click: AwaitedClick
) =>
  action.name === "click"
    ? click.button === (action.button ?? "left") &&
      click.count === action.clickCount
    : click.button !== "right" && click.count === 1;

/**
 * Which held click a report is of, and the clicks still awaited after it.
 * Reports come in the order of the inputs: a report of the mouse is of the
 * oldest awaited click it can be of. A double click is reported once, in
 * place of its first click, which Playwright held back: the report is of
 * its second click, and the first is reported by it. A report of no awaited
 * click, as of a click no page held, or of the keyboard, is of none.
 */
export function reportedClick(
  awaited: readonly AwaitedClick[],
  action: {
    readonly name: string;
    readonly button?: unknown;
    readonly clickCount?: unknown;
  }
): { of: HeldClick | null; awaited: readonly AwaitedClick[] } {
  if (!MOUSE_REPORTS.has(action.name)) return { of: null, awaited };
  const at = awaited.findIndex((click) => reportsClick(action, click));
  if (at === -1) return { of: null, awaited };
  const { document, seq } = awaited[at]!;
  return { of: { document, seq }, awaited: awaited.slice(at + 1) };
}

/** The note of a held click: the one made as it reached the page, whatever
 * its event and whatever ref Playwright's report gives. */
const heldNote = (notes: readonly InputNote[], of: HeldClick) =>
  notes.findLast(
    ({ held }) => held?.document === of.document && held.seq === of.seq
  );

/** The note of an input no page held: the latest of an event a report of
 * its kind is of, whose element under the pointer is the one Playwright's
 * ref names. */
const unheldNote = (
  notes: readonly InputNote[],
  action: { readonly name: string; readonly ref?: string | null | undefined }
) => {
  if (!action.ref) return undefined;
  const types = CHAIN_TYPES[action.name] ?? [];
  return notes.findLast(
    (note) =>
      note.held === null &&
      types.includes(note.type) &&
      note.under === action.ref
  );
};

/** Whether a report's picture lists a ref. */
export const listedIn = (tree: string, ref: string | null): ref is string =>
  ref !== null && tree.includes(`[ref=${ref}]`);

/**
 * The target of a report, from the refs of the element the input acted on
 * and its ancestors, nearest first: the element itself when the picture
 * lists it, and otherwise the ancestors the picture lists. A ref the
 * picture does not list, as one an element kept from another read, says
 * nothing of it.
 */
export function namedIn(
  tree: string,
  refs: readonly (string | null)[]
): NonNullable<InteractionReport["target"]> {
  const [acted = null, ...above] = refs;
  if (listedIn(tree, acted)) return { ref: pictureRef(acted), tree };
  return {
    ref: null,
    tree,
    ancestors: above.filter((ref) => listedIn(tree, ref)).map(pictureRef),
  };
}

/**
 * What a report of Playwright's names as the element its input acted on, from
 * the page's notes of its inputs. For a report of a held click (`of`, from
 * `reportedClick`), the input's own note is the one of that click: an
 * earlier click's note can name the same element under the pointer, inside
 * another element by then, and a report can come before its own note. For
 * any other report, it is the one whose element under the pointer is the
 * one Playwright's ref names. Without it, a mouse input is read through its selector
 * (`fromSelector`), with Playwright's ref standing if it cannot be; a field
 * and a focused element are what typing and keys act on, so their ref is
 * Playwright's. A report whose picture does not list the element under the
 * pointer is read through the selector too, from its own note's refs when
 * that has come; never from another input's note, which names another
 * element. `target` undefined keeps the report's own.
 */
export function reportTarget(
  action: {
    readonly name: string;
    readonly ref?: string | null | undefined;
    readonly ariaSnapshot?: string | undefined;
  },
  notes: readonly InputNote[],
  of: HeldClick | null
): { target?: InteractionReport["target"]; fromSelector: boolean } {
  const tree = action.ariaSnapshot;
  if (!tree) return { fromSelector: false };
  const own = of ? heldNote(notes, of) : unheldNote(notes, action);
  if (listedIn(tree, action.ref ?? null)) {
    if (own) return { target: namedIn(tree, own.chain), fromSelector: false };
    return { fromSelector: MOUSE_REPORTS.has(action.name) };
  }
  return {
    target: own ? namedIn(tree, own.chain) : { ref: null, tree, ancestors: [] },
    fromSelector: true,
  };
}
