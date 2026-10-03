// The decorators only mark a class or method; the build integration reads the
// marks from source and generates the Page Object Tools.

export type AymeModelOptions = {
  description?: string;
};

export type AymeActionOptions = {
  description?: string;
};

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
function action(options?: AymeActionOptions): AymeActionDecorator;
function action(...args: unknown[]) {
  // Applied directly, a member decorator receives two or three arguments in
  // both decorator modes; the options form receives at most one.
  if (args.length >= 2) return;
  return markAction;
}

/**
 * Marks a Page Object Model. `@ayme.action` marks a Page Object Action, which
 * becomes a Page Object Tool.
 */
export const ayme = Object.assign(aymeClass, { action });
