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
} from "@ayme-dev/webmcp";
import { createPomProgram, type PomCompilerOptions } from "./pomProgram";

export type { PomCompilerOptions } from "./pomProgram";

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

export function derivePomManifests(
  fileName: string,
  options: PomCompilerOptions = {}
): PomManifest[] {
  const absoluteFileName = path.resolve(fileName);
  const program = createPomProgram(absoluteFileName, options);
  return derivePomManifestsFromProgram(absoluteFileName, program);
}

export function derivePomManifestsFromProgram(
  fileName: string,
  program: ts.Program
): PomManifest[] {
  const absoluteFileName = path.resolve(fileName);
  const sourceFile = program.getSourceFile(absoluteFileName);
  if (!sourceFile)
    throw new Error(`Could not read POM source ${absoluteFileName}.`);

  const checker = program.getTypeChecker();
  const manifests: PomManifest[] = [];
  const components = new Map<ts.ClassDeclaration, PomComponentManifest>();

  for (const declaration of sourceFile.statements) {
    if (
      !ts.isClassDeclaration(declaration) ||
      !isPageObjectClass(checker, declaration)
    )
      continue;
    if (!declaration.name)
      throw new Error("A WebMCP page object needs a class name.");

    const className = declaration.name.text;
    const members = pomMembers(checker, declaration, components);
    const tools = toolsForClass(checker, declaration, components);

    manifests.push({
      className,
      ...classDescription(declaration),
      members,
      components: [...components.values()],
      tools,
    });
  }

  return manifests;
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
  if (!declaration.name) return [];
  const symbol = checker.getSymbolAtLocation(declaration.name);
  if (!symbol) return [];

  return checker
    .getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol))
    .flatMap((property) => {
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
  if (!className) throw new Error("A WebMCP tool class needs a class name.");

  return classMembers(checker, declaration).flatMap((member) => {
    if (!isPublicInstanceMember(member) || !ts.isMethodDeclaration(member))
      return [];
    const description = toolDescription(member);
    if (!description) return [];
    if (!member.name || !ts.isIdentifier(member.name)) {
      throw new Error(
        `WebMCP tool in ${className} needs an identifier method name.`
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
          returnPoms
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
  return pageObjectDeclarations(checker, type);
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
  const declarations = pageObjectDeclarations(checker, type);
  if (declarations.length > 1) {
    throw new Error(
      `WebMCP component member "${memberName}" is ambiguous: ${declarations
        .map((declaration) => declaration.name?.text ?? "<anonymous>")
        .join(", ")}.`
    );
  }
  return declarations[0];
}

function pageObjectDeclarations(
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
        isPageObjectClass(checker, declaration)
      ) {
        declarations.add(declaration);
      }
    }
  }

  if (type.isIntersection()) {
    for (const constituent of type.types) {
      for (const declaration of pageObjectDeclarations(
        checker,
        constituent,
        seen
      )) {
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

/** A class is a Page Object Model when it, or an ancestor class, carries `@WebMCP`. */
function isPageObjectClass(
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration,
  seen = new Set<ts.ClassDeclaration>()
): boolean {
  if (hasWebMcpClassDecorator(declaration)) return true;
  if (seen.has(declaration)) return false;
  seen.add(declaration);

  const type = checker.getTypeAtLocation(declaration);
  if (!type.isClassOrInterface()) return false;
  return checker
    .getBaseTypes(type)
    .some((base) =>
      (base.getSymbol()?.declarations ?? []).some(
        (baseDeclaration) =>
          ts.isClassDeclaration(baseDeclaration) &&
          isPageObjectClass(checker, baseDeclaration, seen)
      )
    );
}

function hasWebMcpClassDecorator(declaration: ts.ClassDeclaration) {
  return (ts.getDecorators(declaration) ?? []).some((decorator) => {
    const expression = decorator.expression;
    return ts.isIdentifier(expression)
      ? expression.text === "WebMCP"
      : ts.isCallExpression(expression) &&
          ts.isIdentifier(expression.expression) &&
          expression.expression.text === "WebMCP";
  });
}

function classDescription(declaration: ts.ClassDeclaration) {
  for (const decorator of ts.getDecorators(declaration) ?? []) {
    if (!ts.isCallExpression(decorator.expression)) continue;
    if (
      !ts.isIdentifier(decorator.expression.expression) ||
      decorator.expression.expression.text !== "WebMCP"
    ) {
      continue;
    }
    const options = decorator.expression.arguments[0];
    if (!options || !ts.isObjectLiteralExpression(options)) return {};
    const description = options.properties.find(
      (property) =>
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === "description" &&
        ts.isStringLiteral(property.initializer)
    );
    if (!description || !ts.isPropertyAssignment(description)) return {};
    return { description: (description.initializer as ts.StringLiteral).text };
  }
  return {};
}

type ToolDescription = { authored?: string };

function toolDescription(
  declaration: ts.MethodDeclaration
): ToolDescription | undefined {
  for (const decorator of ts.getDecorators(declaration) ?? []) {
    if (!ts.isCallExpression(decorator.expression)) continue;
    const callee = decorator.expression.expression;
    if (
      !ts.isPropertyAccessExpression(callee) ||
      !ts.isIdentifier(callee.expression) ||
      callee.expression.text !== "WebMCP" ||
      callee.name.text !== "tool"
    ) {
      continue;
    }

    const options = decorator.expression.arguments[0];
    if (!options || !ts.isObjectLiteralExpression(options)) return {};
    const description = options.properties.find(
      (property) =>
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === "description"
    );
    if (
      !description ||
      !ts.isPropertyAssignment(description) ||
      !ts.isStringLiteral(description.initializer)
    ) {
      return {};
    }
    return { authored: description.initializer.text };
  }
  return undefined;
}

function toolDescriptionText(
  description: string,
  returnPoms: readonly string[]
) {
  if (returnPoms.length === 0) return description;
  return `${description} Potential return POMs: ${returnPoms.join(", ")}.`;
}

function toolParameter(
  checker: ts.TypeChecker,
  parameter: ts.ParameterDeclaration,
  className: string,
  methodName: string
): ToolParameter {
  if (!ts.isIdentifier(parameter.name)) {
    throw new Error(
      `WebMCP tool ${className}.${methodName} needs identifier parameter names.`
    );
  }

  const type = checker.getTypeAtLocation(parameter);
  const optional =
    parameter.questionToken !== undefined || typeIncludesUndefined(type);
  return {
    name: parameter.name.text,
    optional,
    schema: schemaForType(
      checker,
      type,
      className,
      methodName,
      parameter.name.text
    ),
  };
}

function schemaForType(
  checker: ts.TypeChecker,
  type: ts.Type,
  className: string,
  methodName: string,
  parameterName: string
): JsonSchema {
  const membersWithoutUndefined = type.isUnion()
    ? type.types.filter(
        (member) => (member.flags & ts.TypeFlags.Undefined) === 0
      )
    : undefined;
  if (membersWithoutUndefined && membersWithoutUndefined.length === 1) {
    return schemaForType(
      checker,
      membersWithoutUndefined[0],
      className,
      methodName,
      parameterName
    );
  }

  if (type.isUnion()) {
    const members = membersWithoutUndefined ?? [];
    const enumValues = members.map((member) => literalValue(checker, member));
    if (enumValues.every((value) => value !== undefined)) {
      const values = enumValues.filter(
        (value): value is JsonPrimitive => value !== undefined
      );
      const valueTypes = new Set(values.map((value) => typeof value));
      if (valueTypes.size === 1) {
        const type = jsonPrimitiveSchemaType(values[0]);
        if (type === "boolean" && values.length === 2) return { type };
        if (type) return { type, enum: values };
      }
    }
  }

  if (type.flags & ts.TypeFlags.StringLike) return { type: "string" };
  if (type.flags & ts.TypeFlags.NumberLike) return { type: "number" };
  if (type.flags & ts.TypeFlags.BooleanLike) return { type: "boolean" };

  if (type.flags & ts.TypeFlags.Object) {
    return objectSchemaForType(
      checker,
      type,
      className,
      methodName,
      parameterName
    );
  }

  throw unsupportedInputType(
    checker,
    type,
    className,
    methodName,
    parameterName
  );
}

function objectSchemaForType(
  checker: ts.TypeChecker,
  type: ts.Type,
  className: string,
  methodName: string,
  parameterName: string
): JsonSchema {
  if (
    checker.isArrayType(type) ||
    checker.isTupleType(type) ||
    checker.getIndexTypeOfType(type, ts.IndexKind.String)
  ) {
    throw unsupportedInputType(
      checker,
      type,
      className,
      methodName,
      parameterName
    );
  }
  if (type.getCallSignatures().length || type.getConstructSignatures().length) {
    throw unsupportedInputType(
      checker,
      type,
      className,
      methodName,
      parameterName
    );
  }

  const properties = checker.getPropertiesOfType(type);
  const schemaProperties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const property of properties) {
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (!declaration || !ts.isPropertySignature(declaration)) {
      throw unsupportedInputType(
        checker,
        type,
        className,
        methodName,
        parameterName
      );
    }

    const propertyType = checker.getTypeOfSymbolAtLocation(
      property,
      declaration
    );
    schemaProperties[property.name] = schemaForType(
      checker,
      propertyType,
      className,
      methodName,
      property.name
    );
    if (
      !(property.flags & ts.SymbolFlags.Optional) &&
      !typeIncludesUndefined(propertyType)
    ) {
      required.push(property.name);
    }
  }

  return {
    type: "object",
    properties: schemaProperties,
    required,
    additionalProperties: false,
  };
}

function unsupportedInputType(
  checker: ts.TypeChecker,
  type: ts.Type,
  className: string,
  methodName: string,
  parameterName: string
) {
  return new Error(
    `Unsupported WebMCP input type for ${className}.${methodName}(${parameterName}): ${checker.typeToString(type)}.`
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
