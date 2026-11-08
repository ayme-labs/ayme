import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme({ root: (self: AnnotatedComponent) => self.root })
class AnnotatedComponent {
  @ayme.child
  readonly root!: Locator;
  @ayme.child
  readonly child!: Locator;
}

type FynkComponent<T, Selector extends string> = T & {
  readonly selector: Selector;
};

type DirectPromiseCollection = Promise<AnnotatedComponent[]>;
type GenericPromiseCollection<T> = Promise<T[]>;

declare const createFynkComponent: <T, Selector extends string>(
  component: T,
  selector: Selector
) => FynkComponent<T, Selector>;

@ayme
export class AnnotatedChildrenPom {
  @ayme.child
  readonly directField!: AnnotatedComponent;

  @ayme.child
  get directGetter(): AnnotatedComponent {
    return undefined as unknown as AnnotatedComponent;
  }

  @ayme.child
  readonly directIntersection!: AnnotatedComponent & {
    readonly selector: "#direct";
  };

  @ayme.child
  readonly fynkChild = createFynkComponent(
    undefined as unknown as AnnotatedComponent,
    "#fynk"
  );

  // Undeclared look-alikes of each child shape: none is a Page Object Child.
  readonly undeclaredLocator!: Locator;
  get undeclaredLocatorGetter(): Locator {
    return undefined as unknown as Locator;
  }
  readonly undeclaredComponent!: AnnotatedComponent;
  async undeclaredCollection(): Promise<AnnotatedComponent[]> {
    return [];
  }
  undeclaredReadonlyCollection(): readonly AnnotatedComponent[] {
    return [];
  }

  readonly asyncField!: Promise<AnnotatedComponent>;
  readonly synchronousChildren!: AnnotatedComponent[];
  readonly mapChildren!: Map<string, AnnotatedComponent>;
  readonly setChildren!: Set<AnnotatedComponent>;
  readonly iterableChildren!: Iterable<AnnotatedComponent>;

  @ayme.child
  readonly browserLocator!: Locator;

  @ayme.child
  get locatorGetter(): Locator {
    return undefined as unknown as Locator;
  }

  get asyncGetter(): Promise<AnnotatedComponent> {
    return Promise.resolve(undefined as unknown as AnnotatedComponent);
  }

  get asyncCollectionGetter(): Promise<AnnotatedComponent[]> {
    return Promise.resolve([]);
  }

  ordinaryMethod(): AnnotatedComponent {
    return undefined as unknown as AnnotatedComponent;
  }

  locatorMethod(): Locator {
    return undefined as unknown as Locator;
  }

  @ayme.collection
  async componentCollection(): Promise<AnnotatedComponent[]> {
    return [];
  }

  @ayme.collection
  async readonlyComponentCollection(): Promise<readonly AnnotatedComponent[]> {
    return [];
  }

  @ayme.collection
  async readonlyArrayComponentCollection(): Promise<
    ReadonlyArray<AnnotatedComponent>
  > {
    return [];
  }

  @ayme.collection
  async directAliasCollection(): DirectPromiseCollection {
    return [];
  }

  @ayme.collection
  async genericAliasCollection(): GenericPromiseCollection<AnnotatedComponent> {
    return [];
  }

  async tupleCollection(): Promise<[AnnotatedComponent, AnnotatedComponent]> {
    return undefined as unknown as [AnnotatedComponent, AnnotatedComponent];
  }

  async parameterizedCollection(
    selector: string
  ): Promise<AnnotatedComponent[]> {
    void selector;
    return [];
  }

  synchronousCollection(): AnnotatedComponent[] {
    return [];
  }

  mapCollection(): Map<string, AnnotatedComponent> {
    return new Map();
  }

  setCollection(): Set<AnnotatedComponent> {
    return new Set();
  }

  iterableCollection(): Iterable<AnnotatedComponent> {
    return [];
  }
}
