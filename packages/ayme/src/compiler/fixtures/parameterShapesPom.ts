import { ayme } from "@ayme-dev/ayme";

type Value = string | number | readonly Value[] | { [name: string]: Value };
type ProjectName = "Gamma";

enum ProjectStatus {
  Active = "active",
}

@ayme
export class ParameterShapesPom {
  @ayme.action({ description: "Take single literals." })
  literals(
    name: ProjectName,
    count: 3,
    optionalCount: 0 | undefined,
    optionalName?: ""
  ) {
    return [name, count, optionalCount, optionalName];
  }

  @ayme.action({ description: "Take nested literals." })
  nestedLiterals(
    names: ProjectName[],
    pair: [ProjectName, 3?],
    options: { name: ProjectName; count?: 3 }
  ) {
    return [names, pair, options];
  }

  @ayme.action({ description: "Take boolean literals and a declared enum." })
  otherLiterals(open: true, closed: false, status: ProjectStatus) {
    return [open, closed, status];
  }

  @ayme.action({ description: "Take an array." })
  array(tags: string[]) {
    return tags;
  }

  @ayme.action({ description: "Take a readonly array." })
  readonlyArray(sizes: readonly number[], labels: ReadonlyArray<"a" | "b">) {
    return [sizes, labels];
  }

  @ayme.action({ description: "Take tuples." })
  tuple(
    point: [number, string],
    range: readonly [number, number?],
    path: [string, ...number[]]
  ) {
    return [point, range, path];
  }

  @ayme.action({ description: "Take a rest parameter." })
  rest(group: number, ...refs: string[]) {
    return [group, refs];
  }

  @ayme.action({
    description: "Take an empty tuple and a tuple rest parameter.",
  })
  tupleEdges(none: [], ...args: [name: string, count?: number]) {
    return [none, args];
  }

  @ayme.action({ description: "Take a Record." })
  record(values: Readonly<Record<string, string | number>>) {
    return values;
  }

  @ayme.action({ description: "Take an index signature." })
  indexSignature(
    flags: { [name: string]: boolean },
    labelled: { title: string; [name: string]: string }
  ) {
    return [flags, labelled];
  }

  @ayme.action({ description: "Take a primitive union." })
  primitiveUnion(value: string | boolean, size?: number | "auto") {
    return [value, size];
  }

  @ayme.action({ description: "Take a union with null." })
  nullable(note: string | null, count?: number | null) {
    return [note, count];
  }

  @ayme.action({ description: "Take a recursive type." })
  recursive(value: Value) {
    return value;
  }
}
