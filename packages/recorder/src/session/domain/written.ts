import type { EntryId } from "../../contract";
import type {
  PageId,
  PictureRef,
  SnapshotId,
  SnapshotRef,
} from "../../timeline/domain";
import type { InputId } from "./lifecycle";

/**
 * The browser's data as a test writes it by hand: the ids and refs the
 * engine's own types tell apart are plain strings here. A test's stand-in for
 * a browser takes them so, as a browser hands them over, where they arrive.
 */
export type Written<T> = T extends
  PageId | InputId | SnapshotId | SnapshotRef | PictureRef | EntryId
  ? string
  : T extends readonly (infer Item)[]
    ? readonly Written<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: Written<T[Key]> }
      : T;
