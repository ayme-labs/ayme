import type { PomComponentManifest, PomManifest } from "../../shared";
import { RuntimeStateError } from "../../shared";

/** A registered Page Object as the same-named class rule reads it. */
export type RegisteredPomClass = {
  id: string;
  pomClass: object;
  manifest: PomManifest;
};

/**
 * Ayme tells Page Object classes apart by name: tools are named after their
 * class, and definitions and Page Object Children are looked up by it. So no
 * two different classes the registered Page Objects reach, at any depth, may
 * share a name. Children carry no class at runtime, only their compiled
 * manifest, so two of one name are the same class when the build plugin
 * found them in the same file: an HMR update recompiles a class there while
 * Page Objects reaching its old version are still registered. A manifest
 * without a file is the same class when it is the same manifest.
 */
export function sameNamedClassRefusal(
  registered: readonly RegisteredPomClass[],
  PomClass: object,
  manifest: PomManifest
): RuntimeStateError | undefined {
  // A different class with the same name would have its tools hidden by the
  // first one registered.
  for (const registration of registered)
    if (
      registration.id === manifest.className &&
      registration.pomClass !== PomClass
    )
      return new RuntimeStateError(
        `Cannot register the Page Object "${manifest.className}": a different class with that name is already registered${declaredIn(registration.manifest, manifest)}.`,
        { code: "same-named-class" }
      );

  type Reached = { pageObject: string; node: PomComponentManifest };
  // Every distinct class of each name, so a manifest without a file cannot
  // stand in for two classes from different files.
  const reached = new Map<string, Reached[]>();
  const reach = (pageObject: string, pom: PomManifest) => {
    for (const node of [pom, ...pom.components]) {
      const others = reached.get(node.className) ?? [];
      const other = others.find((other) => !sameClass(other.node, node));
      if (other)
        return new RuntimeStateError(
          `Cannot register the Page Object "${manifest.className}": ${
            other.pageObject === manifest.className
              ? `it reaches two different classes named "${node.className}"`
              : `it reaches a class named "${node.className}" that differs from the one the Page Object "${other.pageObject}" reaches`
          }${declaredIn(other.node, node)}. Ayme tells the classes of Page Objects apart by name.`,
          { code: "same-named-class" }
        );
      if (!others.some((other) => other.node.file === node.file))
        reached.set(node.className, [...others, { pageObject, node }]);
    }
    return undefined;
  };
  // Registered Page Objects can stop matching each other once one leaves,
  // as a manifest without a file matches by shape: the new one is refused
  // then too.
  for (const registration of registered) {
    const refusal = reach(registration.id, registration.manifest);
    if (refusal) return refusal;
  }
  return reach(manifest.className, manifest);
}

function sameClass(first: PomComponentManifest, second: PomComponentManifest) {
  return first.file !== undefined && second.file !== undefined
    ? first.file === second.file
    : classShape(first) === classShape(second);
}

function classShape({
  className,
  description,
  members,
  tools,
}: PomComponentManifest) {
  return JSON.stringify({ className, description, members, tools });
}

function declaredIn(first: PomComponentManifest, second: PomComponentManifest) {
  return first.file === undefined || second.file === undefined
    ? ""
    : `, declared in ${first.file} and ${second.file}`;
}

/** Classes that cannot select one instance because they declare no root. */
export function rootlessClassRefusals(
  manifests: readonly PomManifest[],
  rootDeclared: (className: string) => boolean | undefined
): Map<string, RuntimeStateError> {
  const reached = new Map<
    string,
    { places: string[]; belowCollection: boolean }
  >();
  for (const manifest of manifests) {
    const components = new Map(
      [...manifest.components, manifest].map((node) => [node.className, node])
    );
    const visit = (
      node: PomComponentManifest,
      path: string,
      collection: boolean,
      edges: ReadonlySet<object>
    ) => {
      if (rootDeclared(node.className) === false) {
        const previous = reached.get(node.className) ?? {
          places: [],
          belowCollection: false,
        };
        previous.places.push(
          `${path}${collection ? " (below a collection)" : ""}`
        );
        previous.belowCollection ||= collection;
        reached.set(node.className, previous);
      }
      // Guard edges so revisiting a recursive class still visits its children.
      for (const member of node.members) {
        if (member.kind !== "component" || edges.has(member)) continue;
        const child = components.get(member.componentClassName);
        if (child)
          visit(
            child,
            `${path}.${member.memberName}${member.collection ? "[]" : ""}`,
            collection || member.collection,
            new Set(edges).add(member)
          );
      }
    };
    visit(manifest, manifest.className, false, new Set());
  }
  return new Map(
    [...reached].flatMap(([className, { places, belowCollection }]) =>
      places.length > 1 || belowCollection
        ? [
            [
              className,
              new RuntimeStateError(
                `The Page Object class "${className}" declares no root and ${places.length > 1 ? "is reached from more than one place" : "has many instances below a collection"}: ${places.join(", ")}.`
              ),
            ] as const,
          ]
        : []
    )
  );
}
