import type { Locator } from "@playwright/test";

// The decorators mark a class or method; the build integration reads the
// marks from source and generates the Page Object Tools. The decorators also
// keep the predicates that only exist at runtime: `@ayme` a model's root and
// presence predicates, `@ayme.action` an action's availability predicate.

/**
 * A Page Object Model's presence predicate (ADR-0042). It gets the live Page
 * Object as `self` and answers whether the Page Object is on the page now.
 * It runs read-only with the observation and never with a call, so it must
 * not scroll, click, focus or change the page.
 */
export type PresencePredicate<Self = unknown> = (
  self: Self
) => boolean | Promise<boolean>;

/**
 * A Page Object Model's root predicate (ADR-0042). It gets the live Page
 * Object as `self` and answers the locator of the element that anchors it,
 * its Page Object Root. It runs read-only with the observation and never
 * with a call, so it must not scroll, click, focus or change the page.
 */
export type RootPredicate<Self = unknown> = (
  self: Self
) => Locator | Promise<Locator>;

export type AymeModelOptions<Self = unknown> = {
  description?: string;
  /**
   * The locator of the element that anchors the Page Object (its Page Object
   * Root): the Page Object is present while the locator resolves to one
   * rendered element, which the page state labels with its name and at
   * which its availability is measured. A subclass inherits it and may
   * declare its own.
   */
  root?: RootPredicate<Self>;
  /**
   * When the Page Object is on the page (Page Object Presence). Without it,
   * a model with a root is present while the root is, and a top-level model
   * without one while it is registered. A subclass inherits it and may
   * declare its own.
   */
  present?: PresencePredicate<Self>;
};

/**
 * What an availability predicate answers: `true` when the action can run now,
 * a string when it cannot and the string is the Availability Reason, `false`
 * when it cannot and there is no reason to give.
 */
export type ActionAvailability = boolean | string;

/**
 * An action's availability predicate (ADR-0035). It gets the live Page
 * Object as `self`, runs read-only with the observation and never with the
 * call, so it must not scroll, click, focus or change the page.
 */
export type AvailabilityPredicate<Self = unknown> = (
  self: Self
) => ActionAvailability | Promise<ActionAvailability>;

export type AymeActionOptions<Self = unknown> = {
  description?: string;
  /**
   * When the action can run (Action Availability). Without it, the action
   * shares its Page Object's availability. One predicate may serve several
   * actions.
   */
  available?: AvailabilityPredicate<Self>;
};

// Each decorated method's predicate, by the method itself: the registry reads
// it along an instance's prototype chain, so inherited actions keep theirs.
const availabilityPredicates = new WeakMap<
  object,
  AvailabilityPredicate<never>
>();

/** Package-internal: the availability predicate `@ayme.action` kept for `method`. */
export function availabilityPredicateOf(
  method: unknown
): AvailabilityPredicate<never> | undefined {
  // A WeakMap answers undefined for a key that is not an object.
  return availabilityPredicates.get(method as object);
}

// Each decorated class's options, by the class itself: `modelOption` reads
// them along the class's own prototype chain, so a subclass inherits its
// base's and the nearest class declaring that option wins.
const modelOptions = new WeakMap<object, AymeModelOptions<never>>();

/**
 * Package-internal: the `root` or `present` predicate `@ayme` kept for
 * `PomClass` or, when it declares none, for the nearest base class that does.
 */
export function modelOption<Key extends "root" | "present">(
  PomClass: unknown,
  key: Key
): AymeModelOptions<never>[Key] {
  for (
    let Class: unknown = PomClass;
    typeof Class === "function";
    Class = Object.getPrototypeOf(Class)
  ) {
    const predicate = modelOptions.get(Class)?.[key];
    if (predicate) return predicate;
  }
  return undefined;
}

type PageObjectClass = abstract new (...args: never[]) => unknown;
// The standard decorator context requires a method signature that accepts any arguments.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMethod<This> = (this: This, ...args: any[]) => any;

type LegacyClassDecorator = (target: PageObjectClass) => void;
type StandardClassDecorator = <Class extends PageObjectClass>(
  target: Class,
  context: ClassDecoratorContext<Class>
) => void;
type AymeClassDecorator = LegacyClassDecorator & StandardClassDecorator;

type LegacyMethodDecorator = (
  target: object,
  propertyKey: string | symbol,
  descriptor: PropertyDescriptor
) => void;
type StandardMethodDecorator = <This, Value extends AnyMethod<This>>(
  value: Value,
  context: ClassMethodDecoratorContext<This, Value>
) => void;
type AymeActionDecorator = LegacyMethodDecorator & StandardMethodDecorator;

function markAction(
  target: object,
  propertyKey: string | symbol,
  descriptor: PropertyDescriptor
): void;
function markAction<This, Value extends AnyMethod<This>>(
  value: Value,
  context: ClassMethodDecoratorContext<This, Value>
): void;
function markAction(
  value: object,
  contextOrKey: unknown,
  descriptor?: PropertyDescriptor
) {
  void value;
  void contextOrKey;
  void descriptor;
}

/**
 * A member decorator that keeps `predicate` for the method it is applied
 * to: the descriptor's value in legacy mode, the value itself in standard.
 */
function keepingPredicate(
  predicate: AvailabilityPredicate<never>
): AymeActionDecorator {
  return ((
    value: object,
    _context: unknown,
    descriptor?: PropertyDescriptor
  ) => {
    const method: unknown = descriptor?.value ?? value;
    if (typeof method === "function")
      availabilityPredicates.set(method, predicate);
  }) as AymeActionDecorator;
}

/** A class decorator that keeps `options`' predicates for the class it is applied to. */
function keepingPredicates(
  options: AymeModelOptions<never>
): AymeClassDecorator {
  return ((target: PageObjectClass) => {
    if (options.root || options.present)
      modelOptions.set(target, { ...modelOptions.get(target), ...options });
  }) as AymeClassDecorator;
}

function aymeClass(target: PageObjectClass): void;
function aymeClass<Class extends PageObjectClass>(
  target: Class,
  context: ClassDecoratorContext<Class>
): void;
function aymeClass<Self>(options?: AymeModelOptions<Self>): AymeClassDecorator;
function aymeClass(
  targetOrOptions?: PageObjectClass | AymeModelOptions<never>
) {
  if (typeof targetOrOptions === "function") return;
  return keepingPredicates(targetOrOptions ?? {});
}

function action(
  target: object,
  propertyKey: string | symbol,
  descriptor: PropertyDescriptor
): void;
function action<This, Value extends AnyMethod<This>>(
  value: Value,
  context: ClassMethodDecoratorContext<This, Value>
): void;
function action<Self>(options?: AymeActionOptions<Self>): AymeActionDecorator;
function action(...args: unknown[]) {
  // Applied directly, a member decorator receives two or three arguments in
  // both decorator modes; the options form receives at most one.
  if (args.length >= 2) return;
  const options = args[0] as AymeActionOptions<never> | undefined;
  return options?.available ? keepingPredicate(options.available) : markAction;
}

/**
 * Marks a Page Object Model and keeps its root and presence predicates when
 * it has them. `@ayme.action` marks a Page Object Action, which becomes a
 * Page Object Tool, and keeps its availability predicate when it has one.
 */
export const ayme = Object.assign(aymeClass, { action });
