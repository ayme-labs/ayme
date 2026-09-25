/**
 * The stages between a forest and the text a model is sent, named so that each
 * has one owner:
 *
 * 1. a {@link Projection} decides what of each node is shown
 *    (`projectStructuralNodeForest`);
 * 2. a {@link Renderer} gives the projected forest a document shape, compact
 *    text (`renderCompactStructuralNodeForest`) or JSON
 *    (`renderJsonStructuralNodeForest`);
 * 3. a {@link Serializer} turns the document into the string that travels.
 *
 * Which nodes are shown at all is decided before the first stage, on the
 * forest, by `StructuralNodeForest`.
 */

export interface Projection<Source, Projected> {
  (source: Source): Projected;
}

export interface Renderer<Projected, Document> {
  (projected: Projected): Document;
}

export interface Serializer<Document> {
  (document: Document): string;
}

/** The three stages of one output, applied in order by {@link emitTreeOutput}. */
export interface TreeOutput<Source, Projected, Document> {
  readonly projection: Projection<Source, Projected>;
  readonly renderer: Renderer<Projected, Document>;
  readonly serializer: Serializer<Document>;
}

export function emitTreeOutput<Source, Projected, Document>(
  output: TreeOutput<Source, Projected, Document>,
  source: Source
): string {
  return output.serializer(output.renderer(output.projection(source)));
}
