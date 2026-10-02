export type WebMcpToolOptions = {
  description?: string;
};

export type WebMcpClassOptions = {
  description?: string;
};

type WebMcpClassTarget = abstract new (...args: never[]) => unknown;
// The standard decorator context requires a method signature that accepts any arguments.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMethod<This> = (this: This, ...args: any[]) => any;

type LegacyClassDecorator = (target: WebMcpClassTarget) => void;
type StandardClassDecorator = <Class extends WebMcpClassTarget>(
  target: Class,
  context: ClassDecoratorContext<Class>
) => void;
type WebMcpClassDecorator = LegacyClassDecorator & StandardClassDecorator;

type LegacyMethodDecorator = (
  target: object,
  propertyKey: string | symbol,
  descriptor: PropertyDescriptor
) => void;
type StandardMethodDecorator = <This, Value extends AnyMethod<This>>(
  value: Value,
  context: ClassMethodDecoratorContext<This, Value>
) => void;
type WebMcpMethodDecorator = LegacyMethodDecorator & StandardMethodDecorator;

function markWebMcpClass(target: WebMcpClassTarget): void;
function markWebMcpClass<Class extends WebMcpClassTarget>(
  target: Class,
  context: ClassDecoratorContext<Class>
): void;
function markWebMcpClass(target: WebMcpClassTarget, context?: unknown) {
  void target;
  void context;
}

function webMcpClass(target: WebMcpClassTarget): void;
function webMcpClass<Class extends WebMcpClassTarget>(
  target: Class,
  context: ClassDecoratorContext<Class>
): void;
function webMcpClass(options?: WebMcpClassOptions): WebMcpClassDecorator;
function webMcpClass(targetOrOptions?: WebMcpClassTarget | WebMcpClassOptions) {
  if (typeof targetOrOptions === "function") {
    return;
  }
  return markWebMcpClass;
}

function markWebMcpTool(
  options: WebMcpToolOptions = {}
): WebMcpMethodDecorator {
  void options;
  function decorate(
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): void;
  function decorate<This, Value extends AnyMethod<This>>(
    value: Value,
    context: ClassMethodDecoratorContext<This, Value>
  ): void;
  function decorate(
    value: object,
    contextOrKey: unknown,
    descriptor?: PropertyDescriptor
  ) {
    void value;
    void contextOrKey;
    void descriptor;
  }
  return decorate;
}

export const WebMCP = Object.assign(webMcpClass, { tool: markWebMcpTool });
