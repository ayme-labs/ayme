import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

import { rootlessClassRefusals } from "../page-objects/domain";
import type {
  JsonPrimitive,
  JsonSchema,
  PomComponentManifest,
  PomManifest,
  PomMemberAccess,
  PomMemberManifest,
  NamedToolParameter,
  ToolManifest,
  ToolParameter,
} from "../shared";
import { createPomProgram, type PomProjectOptions } from "./pomProgram";

/** A public method of a Page Object Model that is not a Page Object Action. */
export type SkippedPomMethod = {
  /** The declaring class and the method, e.g. `RunCard.fill`. */
  name: string;
  /** Why no schema describes its parameters, when one cannot be derived. */
  unsupported?: string;
};

/**
 * Returns one manifest per marked class in the file, Page Object Children
 * included. A class that another manifest lists in `components` is a child,
 * not a top-level Page Object.
 */
export function derivePomManifests(
  fileName: string,
  options: PomProjectOptions = {}
): PomManifest[] {
  const absoluteFileName = path.resolve(fileName);
  const program = createPomProgram(absoluteFileName, options);
  return derivePomManifestsFromProgram(absoluteFileName, program);
}

/**
 * `onSkipped` receives the public methods of this file's Page Object Models
 * and their Page Object Children that are neither actions nor declared
 * Page Object Children.
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
    const compiled = { ...manifest, components: [...components.values()] };
    const declarations = new Map(
      [declaration, ...components.keys()].map((node) => [node.name!.text, node])
    );
    const refusals = rootlessClassRefusals(
      [compiled],
      (className) =>
        rootState(checker, declarations.get(className)!) !== "undeclared"
    );
    const refusal = refusals.values().next().value;
    if (refusal) throw refusal;
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
 * a public method that is neither, or nothing Ayme reads. Markers decide:
 * `@ayme.child` and `@ayme.collection` declare a child, `@ayme.action` an
 * action, and an unmarked member is neither, whatever its type.
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

  const declaration = childDeclaration(member, memberName);
  if (declaration)
    return {
      role: "child",
      child: declaredChild(checker, member, declaration),
    };

  if (!ts.isMethodDeclaration(member)) return undefined;
  const description = toolDescription(checker, member, memberName);
  return description
    ? { role: "action", member, methodName: memberName, description }
    : { role: "method", member, methodName: memberName };
}

type ChildMarker = "child" | "collection";

/** A member's `@ayme.child` or `@ayme.collection`, and whom errors name. */
type ChildDeclaration = {
  marker: ChildMarker;
  decorator: ts.Decorator;
  memberName: string;
  /** `Page Object Child <declaring class>.<member>`. */
  owner: string;
};

function childDeclaration(
  member: ts.ClassElement,
  memberName: string
): ChildDeclaration | undefined {
  const decorated = overloadImplementation(member);
  const decorators = ts.canHaveDecorators(decorated)
    ? (ts.getDecorators(decorated) ?? [])
    : // Stryker disable next-line ArrayDeclaration: equivalent, a public member named by an identifier can always have decorators.
      [];
  const marks = decorators.flatMap((decorator) =>
    (["child", "collection"] as const)
      .filter((marker) => isMemberMarker(decorator, "ayme", marker))
      .map((marker) => ({ marker, decorator }))
  );
  const [mark] = marks;
  if (!mark) return undefined;
  const className = ts.isClassLike(member.parent)
    ? member.parent.name?.text
    : undefined;
  const owner = `Page Object Child ${className}.${memberName}`;
  if (marks.length > 1)
    throw new Error(
      `${owner} is declared more than once; mark it either @ayme.child or @ayme.collection.`
    );
  if (decorators.some((d) => isMemberMarker(d, "ayme", "action")))
    throw new Error(
      `${owner} is also marked @ayme.action; a member is either a Page Object Action or a Page Object Child.`
    );
  return { ...mark, memberName, owner };
}

/**
 * The implementation of an overloaded method, which carries its decorators;
 * any other member itself.
 */
function overloadImplementation(member: ts.ClassElement): ts.ClassElement {
  if (
    // Stryker disable next-line ConditionalExpression,LogicalOperator: equivalent, it only skips a search that finds no other implementation.
    !ts.isMethodDeclaration(member) ||
    member.body ||
    !ts.isClassLike(member.parent)
  )
    return member;
  // TypeScript allows one implementation per method name.
  return (
    member.parent.members.find(
      (other) =>
        // Stryker disable next-line ConditionalExpression: equivalent, only a method has a body here.
        ts.isMethodDeclaration(other) &&
        other.body !== undefined &&
        other.name.getText() === member.name.getText()
    ) ?? member
  );
}

/**
 * The Page Object Child a member declares. The member's type must agree
 * with the declaration: `@ayme.child` on a field or getter holding a
 * Locator or a Page Object, `@ayme.collection` on a field or getter holding
 * a Locator or on a method without parameters returning `Promise<T[]>` or
 * `readonly T[]` of a Page Object. Anything else fails the build.
 */
function declaredChild(
  checker: ts.TypeChecker,
  member: ts.ClassElement,
  { marker, decorator, memberName, owner }: ChildDeclaration
): PomChild {
  const fail = (problem: string) => new Error(`${owner} ${problem}.`);
  const { access, type, takesParameters } = memberValueInfo(checker, member)!;
  const typeText = checker.typeToString(type);
  const unresolved = () =>
    fail(`has a type the build cannot resolve (${typeText})`);
  const description = decoratorDescription(checker, decorator, owner);

  if (isUnresolvedType(type)) throw unresolved();
  const items = itemsType(checker, type);
  if (items && isUnresolvedType(items)) throw unresolved();
  const child: DeclaredChild = {
    checker,
    memberName,
    type,
    typeText,
    takesParameters,
    fail,
    unresolved,
    described: description === undefined ? {} : { description },
    collection: marker === "collection",
    itemsDeclaration: items && componentDeclaration(checker, items, memberName),
  };
  return access === "method"
    ? declaredChildMethod(child)
    : declaredChildValue(child, access);
}

/** What `declaredChild` checks a member's type against. */
type DeclaredChild = {
  checker: ts.TypeChecker;
  memberName: string;
  type: ts.Type;
  typeText: string;
  /** Whether a method's signature without arguments, if any, takes them. */
  takesParameters?: boolean;
  fail: (problem: string) => Error;
  unresolved: () => Error;
  described: { description?: string };
  collection: boolean;
  /** The Page Object the member's array or promised array holds. */
  itemsDeclaration: ts.ClassDeclaration | undefined;
};

/** A Child Collection method: `@ayme.collection` returning Page Objects. */
function declaredChildMethod({
  checker,
  memberName,
  type,
  typeText,
  takesParameters,
  fail,
  unresolved,
  described,
  collection,
  itemsDeclaration,
}: DeclaredChild): PomChild {
  if (!collection)
    throw itemsDeclaration
      ? fail(
          `is declared @ayme.child but returns many Page Objects; declare it @ayme.collection`
        )
      : fail(`is a method; @ayme.child declares a field or getter`);
  if (takesParameters)
    throw fail(
      `takes parameters; @ayme.collection declares a method without parameters`
    );
  if (isLocatorType(type))
    throw fail(
      `is a method returning a Locator; declare a Locator collection as a field or getter`
    );
  if (!itemsDeclaration?.name) {
    const value = awaitedType(checker, type);
    if (isUnresolvedType(value)) throw unresolved();
    throw componentDeclaration(checker, value, memberName)
      ? fail(
          `returns one Page Object (${typeText}); a Child Collection method returns an array of Page Objects`
        )
      : fail(`returns no Page Objects (${typeText})`);
  }
  // Returned synchronously, the array must be read-only.
  if (
    awaitedType(checker, type) === type &&
    !isNamedType(type, "ReadonlyArray")
  ) {
    const item = itemsDeclaration.name.text;
    throw fail(
      `returns a mutable array (${typeText}); a Child Collection method returns Promise<${item}[]> or readonly ${item}[]`
    );
  }
  return {
    member: {
      memberName,
      kind: "component",
      access: "method",
      componentClassName: itemsDeclaration.name.text,
      collection: true,
      ...described,
    },
    declaration: itemsDeclaration,
  };
}

/** A field or getter holding a Locator, a Locator collection or a Page Object. */
function declaredChildValue(
  {
    checker,
    memberName,
    type,
    typeText,
    fail,
    described,
    collection,
    itemsDeclaration,
  }: DeclaredChild,
  access: PomMemberAccess
): PomChild {
  if (isLocatorType(type))
    return {
      member: { memberName, kind: "locator", access, collection, ...described },
    };
  if (itemsDeclaration)
    throw collection
      ? fail(
          `holds an array of Page Objects (${typeText}); declare a method without parameters that returns them`
        )
      : fail(
          `is declared @ayme.child but holds many Page Objects (${typeText})`
        );
  const declaration = componentDeclaration(checker, type, memberName);
  if (!declaration?.name)
    throw fail(`holds neither a Locator nor a Page Object (${typeText})`);
  if (collection)
    throw fail(
      `is declared @ayme.collection but holds one Page Object (${declaration.name.text}); declare it @ayme.child`
    );
  return {
    member: {
      memberName,
      kind: "component",
      access,
      componentClassName: declaration.name.text,
      collection: false,
      ...described,
    },
    declaration,
  };
}

/**
 * A child declaration on a member of the class or an ancestor that is not a
 * public instance member fails the build: no one outside the class can read
 * it, so it cannot be a Page Object Child. So does one on a member whose name
 * is not an identifier, such as `"row"` or `["row"]`, which no Page Object
 * member is named by, and one on a setter, which holds no child to read.
 */
function rejectUnsupportedChildDeclarations(
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration
) {
  for (const member of declaration.members) {
    if (!hasChildMarker(member)) continue;
    const visibility = nonPublicVisibility(member);
    const owner = `Page Object Child ${declaration.name?.text}.${childMemberName(member)}`;
    if (visibility)
      throw new Error(
        `${owner} is ${visibility}; only a public instance member can be a Page Object Child.`
      );
    if (!member.name || !ts.isIdentifier(member.name))
      throw new Error(
        `${owner} is not named by an identifier; only a member with an identifier name can be a Page Object Child.`
      );
    if (ts.isSetAccessorDeclaration(member))
      throw new Error(
        `${owner} is a setter; only a field, getter or method can be a Page Object Child.`
      );
  }
  for (const base of baseClassDeclarations(checker, declaration))
    rejectUnsupportedChildDeclarations(checker, base);
}

/** Whether a member is marked `@ayme.child` or `@ayme.collection`. */
function hasChildMarker(member: ts.ClassElement) {
  return (
    ts.canHaveDecorators(member) ? (ts.getDecorators(member) ?? []) : []
  ).some(
    (decorator) =>
      isMemberMarker(decorator, "ayme", "child") ||
      isMemberMarker(decorator, "ayme", "collection")
  );
}

/** What keeps a member from being a public instance member, if anything. */
function nonPublicVisibility(member: ts.ClassElement) {
  if (member.name && ts.isPrivateIdentifier(member.name)) return "private";
  const modifiers = ts.canHaveModifiers(member)
    ? // Stryker disable next-line ArrayDeclaration: equivalent, no modifier matches an item that is not one.
      (ts.getModifiers(member) ?? [])
    : // Stryker disable next-line ArrayDeclaration: equivalent, a member with decorators can always have modifiers.
      [];
  return (
    [
      [ts.SyntaxKind.PrivateKeyword, "private"],
      [ts.SyntaxKind.ProtectedKeyword, "protected"],
      [ts.SyntaxKind.StaticKeyword, "static"],
    ] as const
  ).find(([kind]) => modifiers.some((m) => m.kind === kind))?.[1];
}

/**
 * A member's name as errors show it: `#row`, `"row"` or `["row"]` too. A
 * member with decorators always has one.
 */
function childMemberName(member: ts.ClassElement) {
  return member.name!.getText();
}

/** `any`, `unknown`, or a type the program could not resolve. */
function isUnresolvedType(type: ts.Type) {
  return (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;
}

/** The value a `Promise` resolves to, or the type itself. */
function awaitedType(checker: ts.TypeChecker, type: ts.Type) {
  if (!isNamedType(type, "Promise")) return type;
  return checker.getTypeArguments(type as ts.TypeReference)[0] ?? type;
}

/** The item type of an array or read-only array, awaited first. */
function itemsType(checker: ts.TypeChecker, type: ts.Type) {
  const value = awaitedType(checker, type);
  if (!checker.isArrayType(value)) return undefined;
  return checker.getIndexTypeOfType(value, ts.IndexKind.Number);
}

type RootState = "declared" | "undeclared" | "unreadable";

/**
 * Whether a class's `@ayme` options, or its ancestors', name `root`. Only
 * inline object literals are read; anything else is left to the runtime.
 */
function rootState(
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration
): RootState {
  const states: RootState[] = [];
  for (const decorator of ts.getDecorators(declaration) ?? []) {
    if (!isMarker(decorator, "ayme")) continue;
    const options = ts.isCallExpression(decorator.expression)
      ? decorator.expression.arguments[0]
      : undefined;
    if (options && !ts.isObjectLiteralExpression(options))
      states.push("unreadable");
    for (const property of options && ts.isObjectLiteralExpression(options)
      ? options.properties
      : []) {
      const name = property.name;
      const key =
        name && (ts.isIdentifier(name) || ts.isStringLiteral(name))
          ? name.text
          : undefined;
      states.push(
        key === "root"
          ? "declared"
          : key === undefined || key === "__proto__"
            ? "unreadable"
            : "undeclared"
      );
    }
  }
  const extended = declaration.heritageClauses?.find(
    (c) => c.token === ts.SyntaxKind.ExtendsKeyword
  )?.types[0]?.expression;
  if (extended) {
    // Only a class declaration the program shows is read: a call, a constant,
    // a declaration file or an ambient class may carry a root the types hide.
    const name = ts.isPropertyAccessExpression(extended)
      ? extended.name
      : extended;
    let symbol = checker.getSymbolAtLocation(name);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    const bases = symbol?.declarations ?? [];
    if (
      !bases.length ||
      !bases.every(
        (base) =>
          ts.isClassDeclaration(base) &&
          !base.getSourceFile().isDeclarationFile &&
          !isAmbient(base)
      )
    )
      states.push("unreadable");
    else
      for (const base of bases)
        states.push(rootState(checker, base as ts.ClassDeclaration));
  }
  return states.includes("declared")
    ? "declared"
    : states.includes("unreadable")
      ? "unreadable"
      : "undeclared";
}

/** Whether the node, or an enclosing namespace, is declared with `declare`. */
function isAmbient(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (
      ts.canHaveModifiers(n) &&
      ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)
    )
      return true;
  }
  return false;
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
    try {
      toolParameters(checker, role.member, className, methodName);
    } catch (error) {
      if (!(error instanceof UnsupportedParameterError)) throw error;
      return [{ name, unsupported: error.reason }];
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

  rejectUnsupportedChildDeclarations(checker, declaration);
  for (const member of classMembers(checker, declaration)) {
    const role = memberRole(checker, member);
    if (role?.role === "child") {
      members.push(role.child.member);
      if (role.child.declaration) childReferences.push(role.child.declaration);
    } else if (role?.role === "action") {
      const { member, methodName, description } = role;
      const parameters = toolParameters(checker, member, className, methodName);
      // An inherited action that returns its declaring class shows this one.
      const returnPoms = returnPomClassDeclarations(checker, member).map(
        (pom) => (pom === member.parent ? declaration : pom)
      );
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
):
  | { access: PomMemberAccess; type: ts.Type; takesParameters?: boolean }
  | undefined {
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
    const signature = callableSignature(checker, member);
    return {
      access: "method",
      type: checker.getReturnTypeOfSignature(signature),
      takesParameters: signature.parameters.length > 0,
    };
  }
  return undefined;
}

/**
 * The signature a method is called by without arguments, else its first: an
 * overloaded method is called by its overloads, not its implementation.
 */
function callableSignature(
  checker: ts.TypeChecker,
  member: ts.MethodDeclaration
) {
  const signatures = checker.getTypeAtLocation(member.name).getCallSignatures();
  return (
    signatures.find(({ parameters }) => parameters.length === 0) ??
    signatures[0]!
  );
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

/**
 * The `description` option of a decorator, if it has one. It must be a
 * constant string; `owner` names the class or action in the error otherwise.
 */
function decoratorDescription(
  checker: ts.TypeChecker,
  decorator: ts.Decorator,
  owner: string
) {
  if (!ts.isCallExpression(decorator.expression)) return undefined;
  const options = decorator.expression.arguments[0];
  if (!options || !ts.isObjectLiteralExpression(options)) return undefined;
  // The last element that sets `description` wins.
  let last: ts.ObjectLiteralElementLike | undefined;
  let readable = false;
  for (const element of options.properties) {
    const sets = setsDescription(checker, element);
    if (sets === "no") continue;
    last = element;
    readable = sets === "yes";
  }
  if (!last) return undefined;
  if (!readable)
    throw new Error(
      `The description of ${owner} may come from a spread or a computed key (${location(
        last
      )}).`
    );
  const description = ts.isPropertyAssignment(last)
    ? constantString(last.initializer)
    : undefined;
  if (description !== undefined) return description;
  throw new Error(
    `The description of ${owner} is not a constant string (${location(last)}).`
  );
}

/**
 * Whether an options element sets `description`: "maybe" for a spread whose
 * type has one and a computed key whose value the type checker can't tell.
 */
function setsDescription(
  checker: ts.TypeChecker,
  element: ts.ObjectLiteralElementLike
): "yes" | "no" | "maybe" {
  if (ts.isSpreadAssignment(element))
    return checker
      .getTypeAtLocation(element.expression)
      .getProperty("description")
      ? "maybe"
      : "no";
  const name = element.name;
  if (!name) return "no";
  if (!ts.isComputedPropertyName(name))
    return (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) &&
      name.text === "description"
      ? "yes"
      : "no";
  const key = checker.getTypeAtLocation(name.expression);
  if (key.isStringLiteral()) return key.value === "description" ? "yes" : "no";
  return key.isNumberLiteral() || key.flags & ts.TypeFlags.ESSymbolLike
    ? "no"
    : "maybe";
}

function location(node: ts.Node) {
  const source = node.getSourceFile();
  const { line } = source.getLineAndCharacterOfPosition(node.getStart());
  return `${source.fileName}:${line + 1}`;
}

/**
 * The value of a string literal, a template literal without substitutions, or
 * a `+` concatenation of those, if `expression` is one.
 */
function constantString(expression: ts.Expression): string | undefined {
  // Parentheses, `as`, `satisfies` and `!` leave the value as it is.
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  )
    return constantString(expression.expression);
  if (ts.isStringLiteralLike(expression)) return expression.text;
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = constantString(expression.left);
    const right = constantString(expression.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

/**
 * The class's description, or, when its `@ayme` declares none, the one of
 * the nearest base class that does, as `root` and `present` are inherited.
 */
function classDescription(
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration
): { description?: string } {
  const marker = findClassMarker(declaration);
  const description =
    marker &&
    decoratorDescription(
      checker,
      marker,
      `Page Object ${declaration.name?.text}`
    );
  if (description !== undefined) return { description };
  const base = extendedClassDeclaration(checker, declaration);
  return base ? classDescription(checker, base) : {};
}

/**
 * The class `declaration` extends at runtime: the one its `extends` clause
 * names, not a type-only base a merged interface adds.
 */
function extendedClassDeclaration(
  checker: ts.TypeChecker,
  declaration: ts.ClassDeclaration
) {
  const base = declaration.heritageClauses?.find(
    (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword
  )?.types[0];
  return base
    ? checker
        .getTypeAtLocation(base)
        .getSymbol()
        ?.declarations?.find(ts.isClassDeclaration)
    : undefined;
}

type ToolDescription = { authored?: string };

function toolDescription(
  checker: ts.TypeChecker,
  declaration: ts.MethodDeclaration,
  methodName: string
): ToolDescription | undefined {
  const marker = (ts.getDecorators(declaration) ?? []).find((decorator) =>
    isMemberMarker(decorator, "ayme", "action")
  );
  if (!marker) return undefined;
  const className = ts.isClassLike(declaration.parent)
    ? declaration.parent.name?.text
    : undefined;
  const authored = decoratorDescription(
    checker,
    marker,
    `Page Object Action ${className}.${methodName}`
  );
  return authored === undefined ? {} : { authored };
}

/**
 * A method's parameters, each a named parameter or a destructured one whose
 * parts are input fields. Two fields of one input never share a key.
 */
function toolParameters(
  checker: ts.TypeChecker,
  method: ts.MethodDeclaration,
  className: string,
  methodName: string
): ToolParameter[] {
  const parameters = method.parameters.map((parameter) =>
    toolParameter(checker, parameter, className, methodName)
  );
  const sources = new Map<string, string>();
  for (const [index, parameter] of parameters.entries()) {
    const declaration = method.parameters[index]!;
    const fields =
      "destructured" in parameter
        ? parameter.fields.map(({ name }) => ({
            name,
            source: `${parameter.destructured === "object" ? "property" : "binding"} ${name} of ${patternLabel(declaration)}`,
          }))
        : [{ name: parameter.name, source: `parameter ${parameter.name}` }];
    for (const { name, source } of fields) {
      const first = sources.get(name);
      if (first !== undefined)
        throw new UnsupportedParameterError(
          `Page Object Action ${className}.${methodName} takes two input fields named ${name}: ${first}, and ${source}.`,
          `two input fields are named ${name}`
        );
      sources.set(name, source);
    }
  }
  return parameters;
}

function toolParameter(
  checker: ts.TypeChecker,
  parameter: ts.ParameterDeclaration,
  className: string,
  methodName: string
): ToolParameter {
  const type = checker.getTypeAtLocation(parameter);
  const context: SchemaContext = {
    checker,
    className,
    methodName,
    parameter: parameter.name.getText(),
    declaration: parameter,
    enclosing: new Set(),
  };
  const rest =
    parameter.dotDotDotToken === undefined ? {} : { rest: true as const };
  const optional =
    parameter.questionToken !== undefined ||
    parameter.initializer !== undefined ||
    typeIncludesUndefined(type);
  if (ts.isObjectBindingPattern(parameter.name))
    return {
      destructured: "object",
      optional,
      fields: objectPatternFields(context, parameter, parameter.name, type),
      ...rest,
    };
  if (ts.isArrayBindingPattern(parameter.name))
    return {
      destructured: "array",
      optional,
      fields: arrayPatternFields(context, parameter, parameter.name, type),
      ...rest,
    };

  const schema = schemaForType(context, type, parameter.name.text);
  const defaultValue =
    parameter.initializer && literalDefault(parameter.initializer);
  return {
    name: parameter.name.text,
    optional,
    schema,
    ...rest,
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
  };
}

/** The property names an object pattern binds, a rest binding aside. */
function boundKeys(pattern: ts.ObjectBindingPattern): string[] {
  return pattern.elements.flatMap((element) => {
    if (element.dotDotDotToken) return [];
    const key = element.propertyName ?? element.name;
    return ts.isIdentifier(key) || ts.isLiteralExpression(key)
      ? [key.text]
      : [];
  });
}

/** The refusal of an object pattern whose `untyped` bindings have no type. */
function untypedBindings(
  context: SchemaContext,
  parameter: ts.ParameterDeclaration,
  untyped: readonly string[]
) {
  const names = untyped.join(", ").replace(/, ([^,]*)$/, " and $1");
  const verb = untyped.length === 1 ? "has" : "have";
  return new UnsupportedParameterError(
    `Page Object Action ${context.className}.${context.methodName}: ${names} in ${patternLabel(parameter)} ${verb} no type.${parameter.type ? "" : " Annotate the parameter."}`,
    `${names} in parameter ${patternLabel(parameter)} ${verb} no type`
  );
}

/**
 * An object pattern's fields: every property of its type, by property name,
 * whatever the pattern binds or renames, with the literal default of a
 * binding that gives one. Its type must be an object with known properties,
 * among them every one the pattern binds by name; a rest binding takes the
 * rest.
 */
function objectPatternFields(
  context: SchemaContext,
  parameter: ts.ParameterDeclaration,
  pattern: ts.ObjectBindingPattern,
  type: ts.Type
): NamedToolParameter[] {
  // An unannotated pattern has no type of its own: TypeScript 6 types it
  // `{}`, which the check below finds, and TypeScript 5 gives each binding
  // `any`.
  if (!parameter.type) {
    const untyped = boundKeys(pattern).filter((key) => {
      const property = type.getProperty(key);
      return (
        property !== undefined &&
        (context.checker.getTypeOfSymbol(property).flags & ts.TypeFlags.Any) !==
          0
      );
    });
    if (untyped.length) throw untypedBindings(context, parameter, untyped);
  }
  const schema = schemaForType(context, type, context.parameter);
  // Only an object schema closes its properties.
  if (schema.additionalProperties !== false)
    throw unsupportedInputType(context, type, context.parameter);
  const properties = schema.properties ?? {};
  const required = new Set(schema.required);
  const defaults = new Map<string, JsonPrimitive>();
  const untyped: string[] = [];
  for (const element of pattern.elements) {
    // A rest binding gathers the properties the others leave.
    if (element.dotDotDotToken) continue;
    const key = element.propertyName ?? element.name;
    if (!ts.isIdentifier(key) && !ts.isLiteralExpression(key)) continue;
    if (!Object.hasOwn(properties, key.text)) untyped.push(key.text);
    const value = element.initializer && literalDefault(element.initializer);
    if (value !== undefined) defaults.set(key.text, value);
  }
  if (untyped.length) throw untypedBindings(context, parameter, untyped);
  return Object.entries(properties).map(([name, fieldSchema]) => {
    const value = defaults.get(name);
    return {
      name,
      optional: !required.has(name),
      schema: fieldSchema,
      ...(value === undefined ? {} : { default: value }),
    };
  });
}

/**
 * An array pattern's fields: the names it binds, in order, a rest element's
 * as a list. Its type is one array or tuple, never a union of them. A tuple's optional element is optional, and so is every element
 * of a plain array, which may be shorter. Every element needs a name, and
 * every fixed element of a tuple needs binding.
 */
function arrayPatternFields(
  context: SchemaContext,
  parameter: ts.ParameterDeclaration,
  pattern: ts.ArrayBindingPattern,
  type: ts.Type
): NamedToolParameter[] {
  const { checker } = context;
  // A union, of tuples or arrays, gives its elements no one type each.
  const arrayType = checker.getNonNullableType(type);
  if (arrayType.isUnion() || !checker.isArrayLikeType(arrayType))
    throw unsupportedInputType(context, arrayType, context.parameter);
  const flags = checker.isTupleType(arrayType)
    ? (arrayType as ts.TupleTypeReference).target.elementFlags
    : undefined;
  const unnamed = (index: number, why: string) =>
    new UnsupportedParameterError(
      `Page Object Action ${context.className}.${context.methodName} needs a name for every element of ${patternLabel(parameter)}: element ${index} ${why}.`,
      `element ${index} of parameter ${patternLabel(parameter)} has no name`
    );

  const fields = pattern.elements.map((element, index): NamedToolParameter => {
    if (ts.isOmittedExpression(element)) throw unnamed(index, "is a hole");
    if (!ts.isIdentifier(element.name))
      throw unnamed(index, "is a nested pattern");
    const name = element.name.text;
    const schema = schemaForType(
      context,
      checker.getTypeAtLocation(element),
      name
    );
    if (element.dotDotDotToken)
      return { name, optional: false, schema, rest: true };
    // A plain array's element has no flags, and may be missing.
    const optional = ((flags?.[index] ?? 0) & ts.ElementFlags.Required) === 0;
    const value = element.initializer && literalDefault(element.initializer);
    return {
      name,
      optional,
      schema,
      ...(value === undefined ? {} : { default: value }),
    };
  });

  const bound = pattern.elements.some(
    (element) => ts.isBindingElement(element) && element.dotDotDotToken
  )
    ? Infinity
    : pattern.elements.length;
  const unbound = flags?.findIndex(
    (flag, index) => index >= bound && (flag & ts.ElementFlags.Fixed) !== 0
  );
  if (unbound !== undefined && unbound !== -1)
    throw unnamed(unbound, "is not bound");
  return fields;
}

/** A destructured parameter as the source declares it, e.g. `[x, y]: Point`. */
function patternLabel(parameter: ts.ParameterDeclaration) {
  return `${parameter.name.getText()}${parameter.type ? `: ${parameter.type.getText()}` : ""}`;
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
  /** The parameter being described, as its declaration names it. */
  parameter: string;
  declaration: ts.ParameterDeclaration;
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
 * Thrown for a parameter no tool input can take. The build reports `reason`
 * for an unmarked method.
 */
class UnsupportedParameterError extends Error {
  constructor(
    message: string,
    readonly reason: string
  ) {
    super(message);
  }
}

/** Thrown for a parameter type no schema describes. */
class UnsupportedInputTypeError extends UnsupportedParameterError {}

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
  const source = context.declaration.getSourceFile();
  const { line, character } = source.getLineAndCharacterOfPosition(
    context.declaration.name.getStart(source)
  );
  return new UnsupportedInputTypeError(
    `${source.fileName}:${line + 1}:${character + 1}: Unsupported Page Object Tool input type for ${context.className}.${context.methodName}(${parameterName}): ${typeText}.`,
    `parameter ${context.parameter} has the unsupported type ${typeText}`
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
