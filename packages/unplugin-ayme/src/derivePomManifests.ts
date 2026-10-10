import path from "node:path";

import ts from "typescript";

import type {
  JsonPrimitive,
  JsonSchema,
  PomComponentManifest,
  PomManifest,
  PomMemberAccess,
  PomMemberManifest,
  ToolManifest,
  ToolParameter,
} from "@ayme-dev/ayme";
import { createPomProgram, type PomCompilerOptions } from "./pomProgram";

export type { PomCompilerOptions } from "./pomProgram";

/** A public method of a Page Object Model that is not a Page Object Action. */
export type SkippedPomMethod = {
  /** The declaring class and the method, e.g. `RunCard.fill`. */
  name: string;
  /** Why no schema describes its parameters, when one cannot be derived. */
  unsupported?: string;
};

export type PomCompiler = {
  derivePomManifests(fileName: string): PomManifest[];
};

/**
 * Derives browser POM metadata from a TypeScript project without depending on
 * a particular bundler.
 */
export function createPomCompiler(
  options: PomCompilerOptions = {}
): PomCompiler {
  return {
    derivePomManifests: (fileName) => derivePomManifests(fileName, options),
  };
}

/**
 * Returns one manifest per marked class in the file, Page Object Children
 * included. A class that another manifest lists in `components` is a child,
 * not a top-level Page Object.
 */
export function derivePomManifests(
  fileName: string,
  options: PomCompilerOptions = {}
): PomManifest[] {
  const absoluteFileName = path.resolve(fileName);
  const program = createPomProgram(absoluteFileName, options);
  return derivePomManifestsFromProgram(absoluteFileName, program);
}

/**
 * `onSkipped` receives the public methods of this file's Page Object Models
 * and their Page Object Children that are not actions, Page Object Children
 * themselves aside.
 */
export function derivePomManifestsFromProgram(
  fileName: string,
  program: ts.Program,
  onSkipped?: (methods: SkippedPomMethod[]) => void
): PomManifest[] {
  const absoluteFileName = path.resolve(fileName);
  const sourceFile = program.getSourceFile(absoluteFileName);
  if (!sourceFile)
    throw new Error(`Could not read POM source ${absoluteFileName}.`);

  const checker = program.getTypeChecker();
  const manifests: PomManifest[] = [];
  const components = new Map<ts.ClassDeclaration, PomComponentManifest>();
  const classes = new Map<ts.ClassDeclaration, PomManifest>();

  for (const declaration of sourceFile.statements) {
    if (
      !ts.isClassDeclaration(declaration) ||
      !isPomClass(checker, declaration)
    )
      continue;
    if (!declaration.name)
      throw new Error("A Page Object Model needs a class name.");

    const className = declaration.name.text;
    // Members first: they derive the tools of the Page Object Children.
    const { members, tools } = toolsCompiledWith(program, () => ({
      members: pomMembers(checker, declaration, components),
      tools: toolsForClass(checker, declaration, components),
    }));

    const manifest: PomManifest = {
      className,
      ...classDescription(declaration),
      members,
      components: [...components.values()],
      tools,
    };
    manifests.push(manifest);
    classes.set(declaration, manifest);
  }

  if (onSkipped)
    onSkipped(
      // A class can be both a top-level Page Object and a Child.
      [...new Map([...classes, ...components])].flatMap(
        ([declaration, manifest]) =>
          skippedMethods(checker, declaration, manifest.members)
      )
    );
  return manifests;
}

function skippedMethods(
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration,
  members: readonly PomMemberManifest[]
): SkippedPomMethod[] {
  const children = new Set(members.map((member) => member.memberName));
  return classMembers(checker, declaration).flatMap((member) => {
    if (
      !isPublicInstanceMember(member) ||
      !ts.isMethodDeclaration(member) ||
      !ts.isIdentifier(member.name) ||
      toolDescription(member) ||
      children.has(member.name.text)
    )
      return [];
    // Named after the Page Object, as its tools are.
    const className = declaration.name!.text;
    const methodName = member.name.text;
    const name = `${className}.${methodName}`;
    for (const parameter of member.parameters) {
      if (!ts.isIdentifier(parameter.name))
        return [{ name, unsupported: "a parameter is destructured" }];
      try {
        toolParameter(checker, parameter, className, methodName);
      } catch (error) {
        if (!(error instanceof UnsupportedInputTypeError)) throw error;
        return [
          {
            name,
            unsupported: `parameter ${parameter.name.text} has the unsupported type ${error.typeText}`,
          },
        ];
      }
    }
    return [{ name }];
  });
}

function pomMembers(
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration,
  components: Map<ts.ClassDeclaration, PomComponentManifest>
): PomMemberManifest[] {
  return classMembers(checker, declaration).flatMap(
    (member): PomMemberManifest[] => {
      if (
        !isEligiblePomMember(member) ||
        !member.name ||
        !ts.isIdentifier(member.name)
      )
        return [];

      const memberInfo = memberValueInfo(checker, member);
      if (!memberInfo) return [];

      if (memberInfo.access === "method") {
        const component = componentCollectionType(
          checker,
          memberInfo.type,
          member.name.text
        );
        if (!component) return [];
        const componentClassName = ensureComponentManifest(
          checker,
          component.declaration,
          components
        );
        if (!componentClassName) return [];
        return [
          {
            memberName: member.name.text,
            kind: "component",
            access: memberInfo.access,
            componentClassName,
            collection: true,
          },
        ];
      }

      if (isLocatorType(memberInfo.type)) {
        return [
          {
            memberName: member.name.text,
            kind: "locator",
            access: memberInfo.access,
          },
        ];
      }

      const component = componentType(
        checker,
        memberInfo.type,
        member.name.text
      );
      if (!component) return [];
      const componentClassName = ensureComponentManifest(
        checker,
        component.declaration,
        components
      );
      if (!componentClassName) return [];
      return [
        {
          memberName: member.name.text,
          kind: "component",
          access: memberInfo.access,
          componentClassName,
          collection: false,
        },
      ];
    }
  );
}

function classMembers(
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration
): ts.ClassElement[] {
  const type = declaredClassType(checker, declaration);
  if (!type) return [];

  return checker.getPropertiesOfType(type).flatMap((property) => {
    const member = property.valueDeclaration ?? property.declarations?.[0];
    return member && ts.isClassElement(member) ? [member] : [];
  });
}

function memberValueInfo(
  checker: ts.TypeChecker,
  member: ts.ClassElement
): { access: PomMemberAccess; type: ts.Type } | undefined {
  if (ts.isPropertyDeclaration(member)) {
    return { access: "field", type: checker.getTypeAtLocation(member.name) };
  }
  if (ts.isGetAccessorDeclaration(member)) {
    const signature = checker.getSignatureFromDeclaration(member);
    return signature
      ? { access: "getter", type: checker.getReturnTypeOfSignature(signature) }
      : undefined;
  }
  if (ts.isMethodDeclaration(member)) {
    const signature = checker.getSignatureFromDeclaration(member);
    return signature
      ? { access: "method", type: checker.getReturnTypeOfSignature(signature) }
      : undefined;
  }
  return undefined;
}

function ensureComponentManifest(
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration,
  components: Map<ts.ClassDeclaration, PomComponentManifest>
) {
  const className = declaration.name?.text;
  if (!className) return undefined;

  const existing = components.get(declaration);
  if (existing) return existing.className;

  components.set(declaration, {
    className,
    ...classDescription(declaration),
    members: [],
    tools: [],
  });
  components.set(declaration, {
    className,
    ...classDescription(declaration),
    members: pomMembers(checker, declaration, components),
    tools: toolsForClass(checker, declaration, components),
  });
  return className;
}

function toolsForClass(
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration,
  components: Map<ts.ClassDeclaration, PomComponentManifest>
): ToolManifest[] {
  const className = declaration.name?.text;
  if (!className)
    throw new Error("A class with Page Object Actions needs a class name.");

  return classMembers(checker, declaration).flatMap((member) => {
    if (!isPublicInstanceMember(member) || !ts.isMethodDeclaration(member))
      return [];
    const description = toolDescription(member);
    if (!description) return [];
    if (!member.name || !ts.isIdentifier(member.name)) {
      throw new Error(
        `Page Object Action in ${className} needs an identifier method name.`
      );
    }

    const methodName = member.name.text;
    const parameters = member.parameters.map((parameter) =>
      toolParameter(checker, parameter, className, methodName)
    );
    const returnPoms = returnPomClassNames(checker, member, components);
    return [
      {
        methodName,
        toolName: `${className}.${methodName}`,
        description: toolDescriptionText(
          description.authored ?? `Run ${methodName}.`,
          returnPoms,
          parameters.find((parameter) => parameter.rest)?.name
        ),
        ...(description.authored === undefined
          ? {}
          : { authoredDescription: description.authored }),
        inputSchema: inputSchemaFor(parameters),
        parameters,
        ...(returnPoms.length === 0 ? {} : { returnPoms }),
      } satisfies ToolManifest,
    ];
  });
}

function returnPomClassNames(
  checker: ts.TypeChecker,
  declaration: ts.MethodDeclaration,
  components: Map<ts.ClassDeclaration, PomComponentManifest>
) {
  const signature = checker.getSignatureFromDeclaration(declaration);
  if (!signature) return [];

  const names = new Set<string>();
  for (const candidate of returnPomDeclarations(
    checker,
    checker.getReturnTypeOfSignature(signature)
  )) {
    const name = ensureComponentManifest(checker, candidate, components);
    if (name) names.add(name);
  }
  return [...names];
}

function returnPomDeclarations(
  checker: ts.TypeChecker,
  type: ts.Type,
  seen = new Set<ts.Type>()
): ts.ClassDeclaration[] {
  if (seen.has(type)) return [];
  seen.add(type);

  if (isNamedType(type, "Promise")) {
    const value = checker.getTypeArguments(type as ts.TypeReference)[0];
    return value ? returnPomDeclarations(checker, value, seen) : [];
  }
  if (type.isUnion()) {
    return type.types.flatMap((member) =>
      returnPomDeclarations(checker, member, seen)
    );
  }
  return pomDeclarations(checker, type);
}

function componentType(
  checker: ts.TypeChecker,
  type: ts.Type,
  memberName: string
) {
  const declaration = componentDeclaration(checker, type, memberName);
  return declaration ? { declaration } : undefined;
}

function componentCollectionType(
  checker: ts.TypeChecker,
  type: ts.Type,
  memberName: string
) {
  if (!isNamedType(type, "Promise")) return undefined;

  const promiseType = type as ts.TypeReference;
  const promiseValue = checker.getTypeArguments(promiseType)[0];
  if (!promiseValue || !checker.isArrayType(promiseValue)) return undefined;

  const arrayElement = checker.getIndexTypeOfType(
    promiseValue,
    ts.IndexKind.Number
  );
  const declaration = arrayElement
    ? componentDeclaration(checker, arrayElement, memberName)
    : undefined;
  return declaration ? { declaration } : undefined;
}

function componentDeclaration(
  checker: ts.TypeChecker,
  type: ts.Type,
  memberName: string
): ts.ClassDeclaration | undefined {
  const candidates = pomDeclarations(checker, type);
  // A subclass and its ancestor do not compete: `Sub & Base` is a `Sub`.
  const declarations = candidates.filter(
    (candidate) =>
      !candidates.some((other) => isAncestorClass(checker, candidate, other))
  );
  if (declarations.length > 1) {
    throw new Error(
      `Page Object Child "${memberName}" is ambiguous: ${declarations
        .map((declaration) => declaration.name?.text ?? "<anonymous>")
        .join(", ")}.`
    );
  }
  return declarations[0];
}

function pomDeclarations(
  checker: ts.TypeChecker,
  type: ts.Type,
  seen = new Set<ts.Type>()
): ts.ClassDeclaration[] {
  if (seen.has(type)) return [];
  seen.add(type);

  const declarations = new Set<ts.ClassDeclaration>();
  for (const symbol of [type.getSymbol(), type.aliasSymbol]) {
    for (const declaration of symbol?.declarations ?? []) {
      if (
        ts.isClassDeclaration(declaration) &&
        isPomClass(checker, declaration)
      ) {
        declarations.add(declaration);
      }
    }
  }

  if (type.isIntersection()) {
    for (const constituent of type.types) {
      for (const declaration of pomDeclarations(checker, constituent, seen)) {
        declarations.add(declaration);
      }
    }
  }

  return [...declarations];
}

function isEligiblePomMember(member: ts.ClassElement) {
  if (!isPublicInstanceMember(member) && !isNonPublicRootMember(member))
    return false;
  if (!ts.isMethodDeclaration(member)) return true;
  return (
    member.parameters.length === 0 && toolDescription(member) === undefined
  );
}

function isNonPublicRootMember(member: ts.ClassElement) {
  if (
    (!ts.isPropertyDeclaration(member) &&
      !ts.isGetAccessorDeclaration(member)) ||
    !member.name ||
    !ts.isIdentifier(member.name) ||
    member.name.text !== "root"
  )
    return false;
  const modifiers = member.modifiers ?? [];
  return (
    modifiers.some(
      (modifier) =>
        modifier.kind === ts.SyntaxKind.PrivateKeyword ||
        modifier.kind === ts.SyntaxKind.ProtectedKeyword
    ) &&
    !modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
  );
}

function isNamedType(type: ts.Type, name: string) {
  const symbol = type.getSymbol();
  return symbol?.getName() === name;
}

function isPublicInstanceMember(member: ts.ClassElement) {
  if (
    !ts.isPropertyDeclaration(member) &&
    !ts.isGetAccessorDeclaration(member) &&
    !ts.isMethodDeclaration(member)
  ) {
    return false;
  }
  if (!member.name || !ts.isIdentifier(member.name)) return false;
  return !(member.modifiers ?? []).some((modifier) =>
    [
      ts.SyntaxKind.PrivateKeyword,
      ts.SyntaxKind.ProtectedKeyword,
      ts.SyntaxKind.StaticKeyword,
    ].includes(modifier.kind)
  );
}

function isLocatorType(type: ts.Type) {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  return symbol?.getName() === "Locator";
}

/**
 * A class is a Page Object Model when it, or an ancestor class, carries
 * `@ayme`.
 */
function isPomClass(
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration
): boolean {
  return (
    findClassMarker(declaration) !== undefined ||
    baseClassDeclarations(checker, declaration).some((base) =>
      isPomClass(checker, base)
    )
  );
}

function isAncestorClass(
  checker: ts.TypeChecker,
  ancestor: ts.ClassDeclaration,
  declaration: ts.ClassDeclaration
): boolean {
  return baseClassDeclarations(checker, declaration).some(
    (base) => base === ancestor || isAncestorClass(checker, ancestor, base)
  );
}

// TypeScript rejects circular `extends`, so walking base classes terminates.
function baseClassDeclarations(
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration
): ts.ClassDeclaration[] {
  const type = declaredClassType(checker, declaration);
  if (!type?.isClassOrInterface()) return [];
  return checker
    .getBaseTypes(type)
    .flatMap((base) =>
      (base.getSymbol()?.declarations ?? []).filter(ts.isClassDeclaration)
    );
}

function declaredClassType(
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration
) {
  if (!declaration.name) return undefined;
  const symbol = checker.getSymbolAtLocation(declaration.name);
  return symbol ? checker.getDeclaredTypeOfSymbol(symbol) : undefined;
}

/**
 * The expression a decorator names: `ayme` for both `@ayme` and
 * `@ayme({ ... })`, `ayme.action` for both `@ayme.action` and
 * `@ayme.action({ ... })`.
 */
function decoratorTarget(decorator: ts.Decorator) {
  const expression = decorator.expression;
  return ts.isCallExpression(expression) ? expression.expression : expression;
}

function isMarker(decorator: ts.Decorator, name: string) {
  const target = decoratorTarget(decorator);
  return ts.isIdentifier(target) && target.text === name;
}

function isMemberMarker(decorator: ts.Decorator, name: string, member: string) {
  const target = decoratorTarget(decorator);
  return (
    ts.isPropertyAccessExpression(target) &&
    ts.isIdentifier(target.expression) &&
    target.expression.text === name &&
    target.name.text === member
  );
}

function findClassMarker(declaration: ts.ClassDeclaration) {
  return (ts.getDecorators(declaration) ?? []).find((decorator) =>
    isMarker(decorator, "ayme")
  );
}

/** The literal `description` option of a decorator, if it has one. */
function decoratorDescription(decorator: ts.Decorator) {
  if (!ts.isCallExpression(decorator.expression)) return undefined;
  const options = decorator.expression.arguments[0];
  if (!options || !ts.isObjectLiteralExpression(options)) return undefined;
  for (const property of options.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === "description" &&
      ts.isStringLiteral(property.initializer)
    )
      return property.initializer.text;
  }
  return undefined;
}

function classDescription(declaration: ts.ClassDeclaration) {
  const marker = findClassMarker(declaration);
  const description = marker && decoratorDescription(marker);
  return description === undefined ? {} : { description };
}

type ToolDescription = { authored?: string };

function toolDescription(
  declaration: ts.MethodDeclaration
): ToolDescription | undefined {
  const marker = (ts.getDecorators(declaration) ?? []).find((decorator) =>
    isMemberMarker(decorator, "ayme", "action")
  );
  if (!marker) return undefined;
  const authored = decoratorDescription(marker);
  return authored === undefined ? {} : { authored };
}

function toolDescriptionText(
  description: string,
  returnPoms: readonly string[],
  restParameter: string | undefined
) {
  const parts = [description];
  if (restParameter !== undefined)
    parts.push(
      `${restParameter} is a rest parameter: pass its arguments as a list.`
    );
  if (returnPoms.length > 0)
    parts.push(`Potential return POMs: ${returnPoms.join(", ")}.`);
  return parts.join(" ");
}

function toolParameter(
  checker: ts.TypeChecker,
  parameter: ts.ParameterDeclaration,
  className: string,
  methodName: string
): ToolParameter {
  if (!ts.isIdentifier(parameter.name)) {
    throw new Error(
      `Page Object Action ${className}.${methodName} needs identifier parameter names.`
    );
  }

  const type = checker.getTypeAtLocation(parameter);
  const rest = parameter.dotDotDotToken !== undefined;
  const schema = schemaForType(
    { checker, className, methodName, enclosing: new Set() },
    type,
    parameter.name.text
  );
  const optional =
    // A rest parameter can be left out when it takes no arguments.
    (rest && !schema.minItems) ||
    parameter.questionToken !== undefined ||
    parameter.initializer !== undefined ||
    typeIncludesUndefined(type);
  const defaultValue =
    parameter.initializer && literalDefault(parameter.initializer);
  return {
    name: parameter.name.text,
    optional,
    schema:
      defaultValue === undefined
        ? schema
        : { ...schema, default: defaultValue },
    ...(rest ? { rest: true as const } : {}),
  };
}

/** The value of a literal default (`"a"`, `3`, `-1`, `true`), if it is one. */
function literalDefault(initializer: ts.Expression): JsonPrimitive | undefined {
  if (ts.isStringLiteralLike(initializer)) return initializer.text;
  if (ts.isNumericLiteral(initializer)) return Number(initializer.text);
  if (
    ts.isPrefixUnaryExpression(initializer) &&
    initializer.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(initializer.operand)
  ) {
    return -Number(initializer.operand.text);
  }
  if (initializer.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (initializer.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

type SchemaContext = {
  checker: ts.TypeChecker;
  className: string;
  methodName: string;
  /** The object types being described, outermost first. */
  enclosing: Set<ts.Type>;
};

function schemaForType(
  context: SchemaContext,
  type: ts.Type,
  parameterName: string
): JsonSchema {
  if (type.isUnion()) return unionSchema(context, type, parameterName);
  if (type.flags & ts.TypeFlags.StringLike) return { type: "string" };
  if (type.flags & ts.TypeFlags.NumberLike) return { type: "number" };
  if (type.flags & ts.TypeFlags.BooleanLike) return { type: "boolean" };

  if (type.flags & ts.TypeFlags.Object) {
    // A recursive type is described down to its first repeat, which takes
    // any array or object.
    if (context.enclosing.has(type))
      return {
        type: context.checker.isArrayLikeType(type) ? "array" : "object",
      };
    context.enclosing.add(type);
    try {
      return objectSchemaForType(context, type, parameterName);
    } finally {
      context.enclosing.delete(type);
    }
  }

  throw unsupportedInputType(context, type, parameterName);
}

/**
 * `undefined` makes a parameter optional and is no variant of its own.
 * Literals of one type merge into an enum, and `true | false` is a boolean.
 */
function unionSchema(
  context: SchemaContext,
  type: ts.UnionType,
  parameterName: string
): JsonSchema {
  const members = type.types.filter(
    (member) => (member.flags & ts.TypeFlags.Undefined) === 0
  );
  if (members.length === 1)
    return schemaForType(context, members[0]!, parameterName);

  const variants: JsonSchema[] = [];
  const enums = new Map<string, JsonPrimitive[]>();
  for (const member of members) {
    const value = literalValue(context.checker, member);
    if (value === undefined) {
      variants.push(
        member.flags & ts.TypeFlags.Null
          ? { type: "null" }
          : schemaForType(context, member, parameterName)
      );
      continue;
    }
    const kind = jsonPrimitiveSchemaType(value);
    let values = enums.get(kind!);
    if (!values) {
      values = [];
      enums.set(kind!, values);
      variants.push({ type: kind, enum: values });
    }
    values.push(value);
  }

  const schemas = variants.map((variant) =>
    variant.type === "boolean" && variant.enum?.length === 2
      ? { type: "boolean" as const }
      : variant
  );
  return schemas.length === 1 ? schemas[0]! : { anyOf: schemas };
}

function objectSchemaForType(
  context: SchemaContext,
  type: ts.Type,
  parameterName: string
): JsonSchema {
  const { checker } = context;
  if (checker.isArrayType(type)) {
    const [item] = checker.getTypeArguments(type as ts.TypeReference);
    return {
      type: "array",
      items: schemaForType(context, item!, parameterName),
    };
  }
  if (checker.isTupleType(type))
    return tupleSchema(context, type as ts.TupleTypeReference, parameterName);
  if (
    type.getCallSignatures().length ||
    type.getConstructSignatures().length ||
    checker.getIndexInfoOfType(type, ts.IndexKind.Number)
  ) {
    throw unsupportedInputType(context, type, parameterName);
  }

  const schemaProperties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const property of checker.getPropertiesOfType(type)) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (!declaration || !ts.isPropertySignature(declaration))
      throw unsupportedInputType(context, type, parameterName);

    const propertyType = checker.getTypeOfSymbolAtLocation(
      property,
      declaration
    );
    schemaProperties[property.name] = schemaForType(
      context,
      propertyType,
      property.name
    );
    if (
      !(property.flags & ts.SymbolFlags.Optional) &&
      !typeIncludesUndefined(propertyType)
    ) {
      required.push(property.name);
    }
  }

  // An index signature, as in `Record<string, T>`, takes further properties
  // of its value type.
  const index = checker.getIndexInfoOfType(type, ts.IndexKind.String);
  if (!index)
    return {
      type: "object",
      properties: schemaProperties,
      required,
      additionalProperties: false,
    };
  return {
    type: "object",
    ...(Object.keys(schemaProperties).length
      ? { properties: schemaProperties, required }
      : {}),
    additionalProperties: schemaForType(context, index.type, parameterName),
  };
}

/** A tuple, with optional elements and a trailing rest element. */
function tupleSchema(
  context: SchemaContext,
  type: ts.TupleTypeReference,
  parameterName: string
): JsonSchema {
  const elements = context.checker.getTypeArguments(type);
  const flags = type.target.elementFlags;
  const prefixItems: JsonSchema[] = [];
  let items: JsonSchema | undefined;
  let minItems = 0;
  for (const [index, element] of elements.entries()) {
    const flag = flags[index]!;
    if (flag & ts.ElementFlags.Variable) {
      if (flag & ts.ElementFlags.Variadic || index !== elements.length - 1)
        throw unsupportedInputType(context, type, parameterName);
      items = schemaForType(context, element, parameterName);
      continue;
    }
    prefixItems.push(schemaForType(context, element, parameterName));
    if (flag & ts.ElementFlags.Required) minItems = index + 1;
  }
  return {
    type: "array",
    ...(prefixItems.length > 0 ? { prefixItems } : {}),
    ...(minItems > 0 ? { minItems } : {}),
    ...(items ? { items } : { maxItems: prefixItems.length }),
  };
}

/**
 * Thrown for a parameter type no schema describes. The build reports the
 * type for an unmarked method.
 */
class UnsupportedInputTypeError extends Error {
  constructor(
    message: string,
    readonly typeText: string
  ) {
    super(message);
  }
}

/**
 * An unsupported type is often an import the tsconfig could not resolve, so
 * the error names the tsconfig the Program was compiled with.
 */
function toolsCompiledWith<T>(program: ts.Program, deriveTools: () => T) {
  try {
    return deriveTools();
  } catch (error) {
    if (!(error instanceof UnsupportedInputTypeError)) throw error;
    const { configFilePath } = program.getCompilerOptions();
    error.message += ` Compiled with ${
      typeof configFilePath === "string"
        ? path.resolve(configFilePath)
        : "TypeScript's default options"
    }.`;
    throw error;
  }
}

function unsupportedInputType(
  context: SchemaContext,
  type: ts.Type,
  parameterName: string
) {
  const typeText = context.checker.typeToString(type);
  return new UnsupportedInputTypeError(
    `Unsupported Page Object Tool input type for ${context.className}.${context.methodName}(${parameterName}): ${typeText}.`,
    typeText
  );
}

function literalValue(
  checker: ts.TypeChecker,
  type: ts.Type
): JsonPrimitive | undefined {
  if (type.isStringLiteral()) return type.value;
  if (type.isNumberLiteral()) return type.value;
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return checker.typeToString(type) === "true";
  }
  return undefined;
}

function jsonPrimitiveSchemaType(value: JsonPrimitive): JsonSchema["type"] {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return undefined;
}

function typeIncludesUndefined(type: ts.Type) {
  return (
    type.isUnion() &&
    type.types.some((member) => (member.flags & ts.TypeFlags.Undefined) !== 0)
  );
}

function inputSchemaFor(parameters: readonly ToolParameter[]): JsonSchema {
  const properties = Object.fromEntries(
    parameters.map((parameter) => [parameter.name, parameter.schema])
  );
  const required = parameters
    .filter((parameter) => !parameter.optional)
    .map((parameter) => parameter.name);
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}
