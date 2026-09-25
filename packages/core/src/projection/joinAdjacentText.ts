/**
 * Consecutive strings among `children` as one string each, in place. A forest
 * operation that explodes a node leaves its text next to its neighbours' text;
 * the renderers show such a run as the one text it is on the page, so joining
 * is theirs, not the operation's.
 */
export function joinAdjacentText<T>(
  children: readonly (T | string)[]
): readonly (T | string)[] {
  const joined: (T | string)[] = [];
  for (const child of children) {
    const last = joined.length - 1;
    if (typeof child === "string" && typeof joined[last] === "string")
      joined[last] = `${joined[last] as string}${child}`;
    else joined.push(child);
  }
  return joined;
}
