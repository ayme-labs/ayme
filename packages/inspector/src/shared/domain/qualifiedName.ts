/**
 * A qualified name's prefix and last segment, split before its last `.`:
 * "ListPage.items[1].name" gives "ListPage.items[1]" and ".name". A name
 * with no `.` past its first character doesn't split, nor does one with
 * whitespace, such as a ref's label: it is no path.
 */
export function splitQualifiedName(
  name: string
): readonly [prefix: string, last: string] | undefined {
  if (/\s/.test(name)) return undefined;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : undefined;
}
