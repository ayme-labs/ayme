import type { AriaRef } from "@ayme-dev/core/structural-observation";

// The three kinds of ref the timeline meets. Each names an element, but in
// a numbering of its own, and one taken for another names the wrong element
// or none: so each has a type of its own, made where the ref is read.

/**
 * The ref an element has in a snapshot's tree, or in a Change Tree between
 * two snapshots: the one the browser gave it, which names it on the page
 * over the recorder's connection, or one core made up for a node the browser
 * gave none. The same element can have another one in a later snapshot.
 */
export type SnapshotRef = AriaRef & { readonly __brand: "SnapshotRef" };

/**
 * The ref an element had in the first snapshot of its Visit that lists it:
 * the one the package and the window name it by, in every tree of the Visit.
 */
export type FirstRef = AriaRef & { readonly __brand: "FirstRef" };

/** A ref in the picture of the page Playwright's report of an input gives:
 * numbered by the report itself, unrelated to the snapshots' refs. */
export type PictureRef = string & { readonly __brand: "PictureRef" };

/** A ref read off a tree core made from snapshots. */
export const snapshotRef = (ref: AriaRef) => ref as SnapshotRef;

/** The first ref of an element no earlier snapshot of its Visit lists: the
 * ref it has where it is first seen. */
export const firstRef = (ref: SnapshotRef) => ref as AriaRef as FirstRef;

/** Whether an element's first ref is the ref it has in this snapshot. */
export const isFirst = (ref: SnapshotRef, first: FirstRef) =>
  (ref as AriaRef) === first;

/** A ref as Playwright's report of an input writes it. */
export const pictureRef = (ref: string) => ref as PictureRef;
