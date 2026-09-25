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
 * forest, by `StructuralNodeForest`.
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

/** The three stages of one output, applied in order by {@link emitTreeOutput}. */
export interface TreeOutput<Source, Projected, Rendered> {
  readonly projection: Projection<Source, Projected>;
  readonly renderer: Renderer<Projected, Rendered>;
  readonly serializer: Serializer<Rendered>;
}

/**
 * The first two stages: what `source` renders to, before it is serialized. For
 * an output whose rendered shape travels inside a larger document, such as the
 * page inside a decision request, this is the stage a caller embeds.
 */
export function renderTreeOutput<Source, Projected, Rendered>(
  output: TreeOutput<Source, Projected, Rendered>,
  source: Source
): Rendered {
  return output.renderer(output.projection(source));
}

/** All three stages: the string `source` travels as. */
export function emitTreeOutput<Source, Projected, Rendered>(
  output: TreeOutput<Source, Projected, Rendered>,
  source: Source
): string {
  return output.serializer(renderTreeOutput(output, source));
}
