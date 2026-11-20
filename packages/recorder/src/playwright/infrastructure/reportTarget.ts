import { pictureRef, type InteractionReport } from "../../timeline/domain";

/** A page's note of an input: the event, the refs of the element it acted
 * on and its ancestors, nearest first, and the ref of the element under the
 * pointer, which Playwright's report names (the in-page `TargetChain`). */
export type InputNote = {
  readonly type: string;
  readonly chain: readonly (string | null)[];
  readonly under: string | null;
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
 * the page's notes of its inputs. The note that is the input's own is the
 * one whose element under the pointer is the one Playwright's ref names.
 * Without it, a mouse input is read through its selector (`fromSelector`),
 * with Playwright's ref standing if it cannot be; a field and a focused
 * element are what typing and keys act on, so their ref is Playwright's.
 * A report whose picture does not list the element under the pointer is
 * read through the selector too, from its own note's refs when that has
 * come; never from another input's note, which names another element.
 * `target` undefined keeps the report's own.
 */
export function reportTarget(
  action: {
    readonly name: string;
    readonly ref?: string | null | undefined;
    readonly ariaSnapshot?: string | undefined;
  },
  notes: readonly InputNote[]
): { target?: InteractionReport["target"]; fromSelector: boolean } {
  const tree = action.ariaSnapshot;
  if (!tree) return { fromSelector: false };
  const types = CHAIN_TYPES[action.name] ?? [];
  const told = notes.filter((note) => types.includes(note.type));
  const own = action.ref
    ? told.findLast((note) => note.under === action.ref)
    : undefined;
  if (listedIn(tree, action.ref ?? null)) {
    if (own) return { target: namedIn(tree, own.chain), fromSelector: false };
    return { fromSelector: MOUSE_REPORTS.has(action.name) };
  }
  return {
    target: own ? namedIn(tree, own.chain) : { ref: null, tree, ancestors: [] },
    fromSelector: true,
  };
}
