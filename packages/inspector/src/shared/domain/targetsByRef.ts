/**
 * Maps each ref to the path of every registry target whose element it is, in
 * the registry's order. Only an element with exactly one ref in the page
 * state maps.
 */
export function mapTargetsToRefs(
  elementsByRef: Iterable<readonly [string, Element]>,
  targets: Iterable<{ path: string; element: Element }>
): Map<string, string[]> {
  const refsByElement = new Map<Element, string[]>();
  for (const [ref, element] of elementsByRef)
    refsByElement.set(element, [...(refsByElement.get(element) ?? []), ref]);
  const targetsByRef = new Map<string, string[]>();
  for (const { element, path } of targets) {
    const refs = refsByElement.get(element);
    if (refs?.length !== 1) continue;
    const paths = targetsByRef.get(refs[0]!) ?? [];
    if (!paths.includes(path)) paths.push(path);
    targetsByRef.set(refs[0]!, paths);
  }
  return targetsByRef;
}
