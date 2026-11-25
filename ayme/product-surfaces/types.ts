// product-surfaces contract: 1
// Copied from the product-surfaces skill, which updates it. Edit surfaces.ts, not this file.

/**
 * What an entry rests on: a file or folder the repository tracks, as a path from the repository
 * root, or a URL for something outside it. `check.mjs` verifies the paths.
 */
export type Source = string;

export type Sources = readonly [Source, ...Source[]];

/** A person, an agent or another piece of software that comes to the product with a goal. */
export interface Consumer {
  /** The name people outside the code use for this consumer. */
  name: string;
  /** Who they are, in one sentence. */
  who: string;
  /** What they come to the product for. */
  goal: string;
  sources: Sources;
}

export type Consumers = Record<string, Consumer>;

/** A place where consumers meet the product: one interface they rely on. */
export interface Surface<ConsumerId extends string> {
  /** The name people outside the code use for this surface. */
  name: string;
  /** What the surface is, in one sentence: the interface consumers rely on. */
  what: string;
  /** Each consumer that meets this surface, with what they do there. */
  consumers: Partial<Record<ConsumerId, string>>;
  sources: Sources;
}

/** Use as `satisfies Surfaces<keyof typeof consumers>`, so every consumer a surface names exists. */
export type Surfaces<ConsumerId extends string> = Record<
  string,
  Surface<ConsumerId>
>;
