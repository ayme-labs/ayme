/**
 * The stages between a forest and the text a model is sent, named so that each
 * has one owner:
 *
 * 1. a {@link Projection} decides what of each node is shown
 *    (`projectStructuralNodeForest`);
 * 2. a {@link Renderer} gives the projected forest a rendered shape, compact
 *    text (`renderCompactStructuralNodeForest`) or JSON
 *    (`renderJsonStructuralNodeForest`);
 * 3. a {@link Serializer} turns the rendered shape into the string that travels.
 *
 * Which nodes are shown at all is decided before the first stage, on the
 * forest, by `StructuralNodeForest`. The first two stages compose into a
 * {@link TreeRendering}. The serializer stays apart from it, because a rendered
 * shape often travels inside a larger document that its owner serializes as a
 * whole.
 */

export interface Projection<Source, Projected> {
  (source: Source): Projected;
}

export interface Renderer<Projected, Rendered> {
  (projected: Projected): Rendered;
}

export interface Serializer<Rendered> {
  (rendered: Rendered): string;
}

/** The projection and renderer of one tree, applied in order by {@link renderTree}. */
export interface TreeRendering<Source, Projected, Rendered> {
  readonly projection: Projection<Source, Projected>;
  readonly renderer: Renderer<Projected, Rendered>;
}

/** What `source` renders to: its projection, rendered. */
export function renderTree<Source, Projected, Rendered>(
  rendering: TreeRendering<Source, Projected, Rendered>,
  source: Source
): Rendered {
  return rendering.renderer(rendering.projection(source));
}
