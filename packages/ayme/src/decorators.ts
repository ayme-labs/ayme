// The decorators mark a class or method; the build integration reads the
// marks from source and generates the Page Object Tools. `@ayme.action` also
// keeps an action's availability predicate, which only exists at runtime.

export type AymeModelOptions = {
  description?: string;
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
// it off the live instance, so inherited actions keep theirs.
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

function markClass(target: PageObjectClass): void;
function markClass<Class extends PageObjectClass>(
  target: Class,
  context: ClassDecoratorContext<Class>
): void;
function markClass(target: PageObjectClass, context?: unknown) {
  void target;
  void context;
}

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

function aymeClass(target: PageObjectClass): void;
function aymeClass<Class extends PageObjectClass>(
  target: Class,
  context: ClassDecoratorContext<Class>
): void;
function aymeClass(options?: AymeModelOptions): AymeClassDecorator;
function aymeClass(targetOrOptions?: PageObjectClass | AymeModelOptions) {
  if (typeof targetOrOptions === "function") return;
  return markClass;
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
 * Marks a Page Object Model. `@ayme.action` marks a Page Object Action, which
 * becomes a Page Object Tool, and keeps its availability predicate when it
 * has one.
 */
export const ayme = Object.assign(aymeClass, { action });
