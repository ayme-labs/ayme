import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

import type { JsonPrimitive, JsonSchema } from "@ayme-dev/ayme";
import type {
  PomComponentManifest,
  PomManifest,
  PomMemberAccess,
  PomMemberManifest,
  ToolManifest,
  ToolParameter,
} from "@ayme-dev/ayme/internal";
import { RUNTIME_MODULE } from "./transformPomModule";
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
  // A class can be both a top-level Page Object and a Child.
  const reported = new Set<ts.ClassDeclaration>();

  for (const declaration of sourceFile.statements) {
    if (
      !ts.isClassDeclaration(declaration) ||
      !isPomClass(checker, declaration)
    )
      continue;
    if (!declaration.name)
      throw new Error("A Page Object Model needs a class name.");

    const { manifest, components } = toolsCompiledWith(program, () => {
      const { manifest, references } = classManifest(checker, declaration);
      return { manifest, components: reachableComponents(checker, references) };
    });
    rejectSameNamedClasses(declaration, components.keys());
    const { tools, ...rest } = manifest;
    // `components` before `tools`, as the manifest has always listed them.
    manifests.push({ ...rest, components: [...components.values()], tools });
    reported.add(declaration);
    for (const child of components.keys()) reported.add(child);
  }

  if (onSkipped)
    onSkipped(
      [...reported].flatMap((declaration) =>
        skippedMethods(checker, declaration)
      )
    );
  return manifests;
}

/** A Page Object Child, and the class it is an instance of. */
type PomChild = {
  member: PomMemberManifest;
  declaration?: ts.ClassDeclaration;
};

/**
 * The role of a Page Object member: a Page Object Child, a Page Object Action,
 * a public method that is neither, or nothing Ayme reads. The action marker
 * decides: a marked method is an action, never also a child.
 */
type MemberRole =
  | { role: "child"; child: PomChild }
  | {
      role: "action";
      member: ts.MethodDeclaration;
      methodName: string;
      description: ToolDescription;
    }
  | { role: "method"; member: ts.MethodDeclaration; methodName: string };

function memberRole(
  checker: ts.TypeChecker,
  member: ts.ClassElement
): MemberRole | undefined {
  if (!isPublicInstanceMember(member)) return undefined;
  if (!member.name || !ts.isIdentifier(member.name)) return undefined;
  const memberName = member.name.text;

  if (ts.isMethodDeclaration(member)) {
    const description = toolDescription(checker, member);
    if (description)
      return { role: "action", member, methodName: memberName, description };
    const child =
      member.parameters.length === 0
        ? pomChild(checker, member, memberName)
        : undefined;
    return child
      ? { role: "child", child }
      : { role: "method", member, methodName: memberName };
  }
  const child = pomChild(checker, member, memberName);
  return child && { role: "child", child };
}

function pomChild(
  checker: ts.TypeChecker,
  member: ts.ClassElement,
  memberName: string
): PomChild | undefined {
  const memberInfo = memberValueInfo(checker, member);
  if (!memberInfo) return undefined;
  const { access, type } = memberInfo;

  if (access !== "method" && isLocatorType(type))
    return { member: { memberName, kind: "locator", access } };

  const declaration =
    access === "method"
      ? componentCollectionDeclaration(checker, type, memberName)
      : componentDeclaration(checker, type, memberName);
  if (!declaration?.name) return undefined;
  // A collection item's ref is its root's element, so an item class with no
  // root in its chain has no ref to be called by. Options the compiler
  // cannot read may declare one: the runtime decides then.
  if (
    access === "method" &&
    rootDeclaration(checker, declaration) === "undeclared"
  )
    throw new Error(
      `Page Object Child "${memberName}" is a collection of ${declaration.name.text}, which declares no root; a collection item's ref needs one.`
    );
  return {
    member: {
      memberName,
      kind: "component",
      access,
      componentClassName: declaration.name.text,
      collection: access === "method",
    },
    declaration,
  };
}

/**
 * Whether `declaration`, or an ancestor class, passes `root` to `@ayme`:
 * "declared" when a `root` key the compiler can read is in the chain,
 * "unreadable" when none is but some options in the chain cannot be read
 * statically, else "undeclared". The key alone decides; the predicate is the
 * runtime's to read.
 */
type RootDeclaration = "declared" | "undeclared" | "unreadable";

function rootDeclaration(
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration
): RootDeclaration {
  const marker = findClassMarker(checker, declaration);
  const keys = marker === undefined ? new Set() : optionKeys(checker, marker);
  let declared: RootDeclaration =
    keys === "unreadable" ? keys : keys.has("root") ? "declared" : "undeclared";
  for (const base of baseClassDeclarations(checker, declaration)) {
    if (declared === "declared") break;
    const inherited = rootDeclaration(checker, base);
    if (inherited !== "undeclared") declared = inherited;
  }
  return declared;
}

function skippedMethods(
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration
): SkippedPomMethod[] {
  return classMembers(checker, declaration).flatMap((member) => {
    const role = memberRole(checker, member);
    if (role?.role !== "method") return [];
    // Named after the Page Object, as its tools are.
    const className = declaration.name!.text;
    const { methodName } = role;
    const name = `${className}.${methodName}`;
    for (const parameter of role.member.parameters) {
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

/**
 * A class's own members and tools, and the classes they reference: its
 * Page Object Children first, then the return POMs of its actions, each in
 * member order.
 */
function classManifest(
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration
): { manifest: PomComponentManifest; references: ts.ClassDeclaration[] } {
  const className = declaration.name!.text;
  const members: PomMemberManifest[] = [];
  const tools: ToolManifest[] = [];
  const childReferences: ts.ClassDeclaration[] = [];
  const returnReferences: ts.ClassDeclaration[] = [];

  for (const member of classMembers(checker, declaration)) {
    const role = memberRole(checker, member);
    if (role?.role === "child") {
      members.push(role.child.member);
      if (role.child.declaration) childReferences.push(role.child.declaration);
    } else if (role?.role === "action") {
      const { member, methodName, description } = role;
      const parameters = member.parameters.map((parameter) =>
        toolParameter(checker, parameter, className, methodName)
      );
      const returnPoms = returnPomClassDeclarations(checker, member);
      returnReferences.push(...returnPoms);
      const returnPomNames = [
        ...new Set(returnPoms.map((pom) => pom.name!.text)),
      ];
      tools.push({
        methodName,
        toolName: `${className}.${methodName}`,
        ...(description.authored === undefined
          ? {}
          : { description: description.authored }),
        parameters,
        ...(returnPomNames.length === 0 ? {} : { returnPoms: returnPomNames }),
      } satisfies ToolManifest);
    }
  }

  return {
    manifest: {
      className,
      file: declaringFile(declaration),
      ...classDescription(checker, declaration),
      members,
      tools,
    },
    references: [...childReferences, ...returnReferences],
  };
}

/**
 * The declaring file as its package's name and version plus its path in that
 * package, so the same file gets the same identity whichever directory a build
 * runs from, and files of two packages, or of two installed versions of one,
 * never share one. A build embeds no machine-specific path.
 */
function declaringFile(declaration: ts.ClassDeclaration) {
  const fileName = path.resolve(declaration.getSourceFile().fileName);
  const pkg = namedPackage(path.dirname(fileName));
  const relative = path
    .relative(pkg?.dir ?? process.cwd(), fileName)
    .split(path.sep)
    .join("/");
  if (!pkg) return relative;
  return `${pkg.name}${pkg.version ? `@${pkg.version}` : ""}/${relative}`;
}

type NamedPackage = { dir: string; name: string; version?: string } | undefined;
const namedPackages = new Map<string, NamedPackage>();

/** The nearest `package.json` with a name, at or above `dir`. */
function namedPackage(dir: string): NamedPackage {
  if (namedPackages.has(dir)) return namedPackages.get(dir);
  const manifest = path.join(dir, "package.json");
  const { name, version } = fs.existsSync(manifest)
    ? (JSON.parse(fs.readFileSync(manifest, "utf8")) as {
        name?: unknown;
        version?: unknown;
      })
    : {};
  const parent = path.dirname(dir);
  const found =
    typeof name === "string"
      ? { dir, name, ...(typeof version === "string" && { version }) }
      : parent === dir
        ? undefined
        : namedPackage(parent);
  namedPackages.set(dir, found);
  return found;
}

/**
 * Every class reachable from `references`, each listed once, in the order a
 * depth-first walk first reaches it.
 */
function reachableComponents(
  checker: ts.TypeChecker,
  references: readonly ts.ClassDeclaration[]
) {
  const components = new Map<ts.ClassDeclaration, PomComponentManifest>();
  const visit = (declarations: readonly ts.ClassDeclaration[]) => {
    for (const declaration of declarations) {
      if (components.has(declaration)) continue;
      const { manifest, references } = classManifest(checker, declaration);
      components.set(declaration, manifest);
      visit(references);
    }
  };
  visit(references);
  return components;
}

/**
 * The registry tells a Page Object's classes apart by name, so two different
 * classes with one name would share a manifest, and one member would get the
 * other class's tools.
 */
function rejectSameNamedClasses(
  page: ts.ClassDeclaration,
  components: Iterable<ts.ClassDeclaration>
) {
  const pageName = page.name!.text;
  const byName = new Map([[pageName, page]]);
  for (const declaration of components) {
    const name = declaration.name!.text;
    const other = byName.get(name);
    if (!other) byName.set(name, declaration);
    else if (other !== declaration)
      throw new Error(
        `Page Object "${pageName}" reaches two different classes named "${name}", declared in ${
          other.getSourceFile().fileName
        } and ${
          declaration.getSourceFile().fileName
        }. Ayme tells the classes of a Page Object apart by name.`
      );
  }
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

function returnPomClassDeclarations(
  checker: ts.TypeChecker,
  declaration: ts.MethodDeclaration
) {
  const signature = checker.getSignatureFromDeclaration(declaration);
  if (!signature) return [];
  return returnPomDeclarations(
    checker,
    checker.getReturnTypeOfSignature(signature)
  ).filter((candidate) => candidate.name);
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

function componentCollectionDeclaration(
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
  return arrayElement
    ? componentDeclaration(checker, arrayElement, memberName)
    : undefined;
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
    findClassMarker(checker, declaration) !== undefined ||
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

/**
 * Whether `name` is ayme's own `ayme` export. It is decided by symbol, not by
 * text: the aliases an import or a re-export leaves are followed to the
 * declaration, which must live in the runtime package or be imported (a
 * project may stand in its own module for the runtime), so `ayme` imported
 * under another name, through a barrel, or as a namespace member counts, and
 * a function that is merely named `ayme` does not. A name that resolves to no
 * symbol at all falls back to its text, and an import chain the checker cannot
 * follow to the module it names.
 */
function isAymeExport(checker: ts.TypeChecker, name: ts.Identifier) {
  let symbol = checker.getSymbolAtLocation(name);
  if (symbol === undefined) return name.text === "ayme";
  const first = symbol.declarations?.[0];
  const imported = (symbol.flags & ts.SymbolFlags.Alias) !== 0;
  while (symbol.flags & ts.SymbolFlags.Alias) {
    const target = checker.getAliasedSymbol(symbol);
    if (target === symbol) break;
    symbol = target;
  }
  const declaration = symbol.declarations?.[0];
  if (declaration === undefined) {
    return (
      first !== undefined &&
      ts.isImportSpecifier(first) &&
      (first.propertyName ?? first.name).text === "ayme" &&
      isRuntimeImport(first.parent.parent.parent)
    );
  }
  return (
    symbol.name === "ayme" &&
    (imported ||
      owningPackage(declaration.getSourceFile().fileName) === RUNTIME_MODULE)
  );
}

const packageNames = new Map<string, string | undefined>();

/** The name of the nearest package.json at or above `fileName`. */
function owningPackage(fileName: string): string | undefined {
  const directory = path.dirname(fileName);
  if (packageNames.has(directory)) return packageNames.get(directory);
  let name: string | undefined;
  try {
    name = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf8")
    ).name;
  } catch {
    const parent = path.dirname(directory);
    name =
      parent === directory ? undefined : owningPackage(path.join(parent, "_"));
  }
  packageNames.set(directory, name);
  return name;
}

function isRuntimeImport(
  declaration: ts.ImportDeclaration | ts.JSDocImportTag
) {
  return (
    ts.isStringLiteral(declaration.moduleSpecifier) &&
    declaration.moduleSpecifier.text === RUNTIME_MODULE
  );
}

/** Whether `expression` names ayme's `ayme` export: bare, or as `ns.ayme`. */
function isAymeReference(checker: ts.TypeChecker, expression: ts.Expression) {
  if (ts.isIdentifier(expression)) return isAymeExport(checker, expression);
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.name) &&
    expression.name.text === "ayme" &&
    ts.isIdentifier(expression.expression) &&
    isNamespace(checker, expression.expression) &&
    isAymeExport(checker, expression.name)
  );
}

function isNamespace(checker: ts.TypeChecker, name: ts.Identifier) {
  const symbol = checker.getSymbolAtLocation(name);
  return (
    symbol === undefined ||
    (symbol.flags & ts.SymbolFlags.Alias) !== 0 ||
    (symbol.flags & ts.SymbolFlags.Module) !== 0
  );
}

/** Whether `decorator` is ayme's class decorator, `@ayme` or `@ayme({ ... })`. */
function isAymeDecorator(checker: ts.TypeChecker, decorator: ts.Decorator) {
  return isAymeReference(checker, decoratorTarget(decorator));
}

/** Whether `decorator` is `member` of ayme's decorator, such as `@ayme.action`. */
function isMemberMarker(
  checker: ts.TypeChecker,
  decorator: ts.Decorator,
  member: string
) {
  const target = decoratorTarget(decorator);
  return (
    ts.isPropertyAccessExpression(target) &&
    target.name.text === member &&
    isAymeReference(checker, target.expression)
  );
}

function findClassMarker(
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration
) {
  return (ts.getDecorators(declaration) ?? []).find((decorator) =>
    isAymeDecorator(checker, decorator)
  );
}

/** The options object literal a decorator is called with, if it has one. */
function decoratorOptions(decorator: ts.Decorator) {
  if (!ts.isCallExpression(decorator.expression)) return undefined;
  const options = decorator.expression.arguments[0];
  return options && ts.isObjectLiteralExpression(options) ? options : undefined;
}

/**
 * The keys of the options a decorator is called with, read statically: from
 * an object literal, inline or behind a constant of the same file that
 * nothing else reads, with identifier, string and computed string literal
 * keys. "unreadable" when the options come from anywhere else, or hold a
 * spread, a `__proto__` key, which inherits keys the literal does not show,
 * or a key the compiler cannot read.
 */
function optionKeys(
  checker: ts.TypeChecker,
  decorator: ts.Decorator
): ReadonlySet<string> | "unreadable" {
  if (!ts.isCallExpression(decorator.expression)) return new Set();
  const [argument] = decorator.expression.arguments;
  if (argument === undefined) return new Set();
  const literal = optionsLiteral(checker, argument);
  if (literal === undefined) return "unreadable";
  const keys = new Set<string>();
  for (const property of literal.properties) {
    const key = propertyKey(property);
    if (key === undefined || key === "__proto__") return "unreadable";
    keys.add(key);
  }
  return keys;
}

/**
 * The object literal `expression` is: itself, or the initializer of the
 * constant of the same file it names, through an assertion, a parenthesis
 * or another constant, when nothing in the file could change the object
 * (see `untouchedConst`). Undefined when the compiler cannot see it.
 */
function optionsLiteral(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  verified = new Map<ts.VariableDeclaration, boolean>()
): ts.ObjectLiteralExpression | undefined {
  const value = unwrapped(expression);
  if (ts.isObjectLiteralExpression(value)) return value;
  if (!ts.isIdentifier(value)) return undefined;
  const declaration = constDeclarationOf(checker, value);
  if (
    declaration === undefined ||
    !untouchedConst(checker, declaration, verified)
  )
    return undefined;
  return optionsLiteral(checker, declaration.initializer, verified);
}

/**
 * The initialized `const` of its own file that `identifier` names. Not an
 * exported one: another module may change its object.
 */
function constDeclarationOf(
  checker: ts.TypeChecker,
  identifier: ts.Identifier
): InitializedConst | undefined {
  const declaration = checker.getSymbolAtLocation(identifier)?.valueDeclaration;
  return declaration !== undefined &&
    ts.isVariableDeclaration(declaration) &&
    isInitializedConst(declaration, identifier.getSourceFile())
    ? declaration
    : undefined;
}

type InitializedConst = ts.VariableDeclaration & {
  initializer: ts.Expression;
};

function isInitializedConst(
  declaration: ts.VariableDeclaration,
  file: ts.SourceFile
): declaration is InitializedConst {
  return (
    declaration.initializer !== undefined &&
    (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) !== 0 &&
    (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Export) ===
      0 &&
    declaration.getSourceFile() === file
  );
}

/**
 * Whether every reference to the const `declaration` in its file is one
 * that cannot change its object: its own name, the `ayme` decorator's
 * argument, or the initializer of another such const. Any other reference,
 * a call it is passed to, another decorator that receives it, a member read
 * or written, a shorthand property, an export, may have changed the object
 * the literal shows. A declaration `verified`
 * still holds as pending is on a cycle of initializers, which changes no
 * object.
 */
function untouchedConst(
  checker: ts.TypeChecker,
  declaration: ts.VariableDeclaration,
  verified: Map<ts.VariableDeclaration, boolean>
): boolean {
  const known = verified.get(declaration);
  if (known !== undefined) return known;
  verified.set(declaration, true);
  const symbol = checker.getSymbolAtLocation(declaration.name);
  const untouched =
    symbol !== undefined &&
    referencesTo(checker, symbol, declaration.getSourceFile()).every(
      (reference) => {
        if (reference === declaration.name) return true;
        const use = wrapping(reference);
        if (
          ts.isCallExpression(use.parent) &&
          ts.isDecorator(use.parent.parent) &&
          isAymeDecorator(checker, use.parent.parent) &&
          use.parent.arguments[0] === use
        )
          return true;
        return (
          ts.isVariableDeclaration(use.parent) &&
          use.parent.initializer === use &&
          isInitializedConst(use.parent, use.getSourceFile()) &&
          untouchedConst(checker, use.parent, verified)
        );
      }
    );
  verified.set(declaration, untouched);
  return untouched;
}

/** Every identifier in `file` that resolves to `symbol`, its declaration's name included. */
function referencesTo(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  file: ts.SourceFile
): ts.Identifier[] {
  const references: ts.Identifier[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && refersTo(checker, node, symbol))
      references.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return references;
}

/**
 * Whether `identifier` names `symbol`: directly, or as the shorthand
 * property or the export specifier the checker resolves to its own symbol.
 */
function refersTo(
  checker: ts.TypeChecker,
  identifier: ts.Identifier,
  symbol: ts.Symbol
): boolean {
  const { parent } = identifier;
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === identifier)
    return checker.getShorthandAssignmentValueSymbol(parent) === symbol;
  if (ts.isExportSpecifier(parent))
    return checker.getExportSpecifierLocalTargetSymbol(parent) === symbol;
  return checker.getSymbolAtLocation(identifier) === symbol;
}

function unwrapped(expression: ts.Expression): ts.Expression {
  let value = expression;
  while (isWrapper(value)) value = value.expression;
  return value;
}

/** The outermost assertion, parenthesis or non-null wrapper around `expression`. */
function wrapping(expression: ts.Expression): ts.Expression {
  let value = expression;
  while (isWrapper(value.parent) && value.parent.expression === value)
    value = value.parent;
  return value;
}

function isWrapper(
  node: ts.Node
): node is
  | ts.ParenthesizedExpression
  | ts.AsExpression
  | ts.SatisfiesExpression
  | ts.TypeAssertion
  | ts.NonNullExpression {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
  );
}

/** The key an object literal property declares, when the compiler can read it. */
function propertyKey(property: ts.ObjectLiteralElementLike) {
  if (ts.isSpreadAssignment(property)) return undefined;
  const { name } = property;
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  if (
    ts.isComputedPropertyName(name) &&
    ts.isStringLiteralLike(name.expression)
  )
    return name.expression.text;
  return undefined;
}

/** The literal `description` option of a decorator, if it has one. */
function decoratorDescription(decorator: ts.Decorator) {
  const options = decoratorOptions(decorator);
  if (!options) return undefined;
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

function classDescription(
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration
) {
  const marker = findClassMarker(checker, declaration);
  const description = marker && decoratorDescription(marker);
  return description === undefined ? {} : { description };
}

type ToolDescription = { authored?: string };

function toolDescription(
  checker: ts.TypeChecker,
  declaration: ts.MethodDeclaration
): ToolDescription | undefined {
  const marker = (ts.getDecorators(declaration) ?? []).find((decorator) =>
    isMemberMarker(checker, decorator, "action")
  );
  if (!marker) return undefined;
  const authored = decoratorDescription(marker);
  return authored === undefined ? {} : { authored };
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
    parameter.questionToken !== undefined ||
    parameter.initializer !== undefined ||
    typeIncludesUndefined(type);
  const defaultValue =
    parameter.initializer && literalDefault(parameter.initializer);
  return {
    name: parameter.name.text,
    optional,
    schema,
    ...(rest ? { rest: true as const } : {}),
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
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
