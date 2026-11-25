import fs from "node:fs";
import path from "node:path";

// A relative import names a path, not a package, so a pattern on its text
// cannot tell `../../../recorder/src` from a local folder named `recorder`.
// This rule resolves the path against the importing file, follows symlinks
// such as node_modules' links into the workspace, and judges the import by
// where it lands: in a folder, or in a package, by the name in its
// package.json.

/** `target` with the symlinks of its longest existing part resolved. */
function realPath(target) {
  const rest = [];
  let existing = target;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return target;
    rest.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(fs.realpathSync(existing), ...rest);
}

const packageNames = new Map();
/** The name in the nearest package.json at or above `location` that has one. */
function packageAt(location) {
  if (!packageNames.has(location)) {
    let name;
    try {
      name = JSON.parse(
        fs.readFileSync(path.join(location, "package.json"), "utf8")
      ).name;
    } catch {
      // No package.json here, or `location` is a file.
    }
    const parent = path.dirname(location);
    packageNames.set(
      location,
      name ?? (parent === location ? undefined : packageAt(parent))
    );
  }
  return packageNames.get(location);
}

/** The module an import names, when it is written out. */
function specifierOf(source) {
  if (source?.type === "Literal" && typeof source.value === "string")
    return source.value;
  if (source?.type === "TemplateLiteral" && source.expressions.length === 0)
    return source.quasis[0].value.cooked;
  return undefined;
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Refuse a relative import by the folder or package it reaches.",
    },
    schema: [
      {
        type: "object",
        properties: {
          targets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                folder: { type: "string" },
                package: { type: "string" },
                message: { type: "string" },
                allowTypeImports: { type: "boolean" },
              },
              required: ["message"],
              additionalProperties: false,
            },
          },
        },
        required: ["targets"],
        additionalProperties: false,
      },
    ],
    messages: { refused: "{{message}}" },
  },
  create(context) {
    const targets = context.options[0].targets.map((target) => ({
      ...target,
      folder: target.folder && realPath(target.folder),
      package: target.package && new RegExp(target.package),
    }));
    /** Reports `source` if it is a relative path to a refused target. A type
     * import is one that leaves nothing in the build: `import type`, `export
     * type`, or a type written as `import("…")`. */
    function check(source, typeOnly) {
      const specifier = specifierOf(source);
      if (specifier === undefined || !/^\.\.?(\/|$)/.test(specifier)) return;
      const reached = realPath(
        path.resolve(path.dirname(context.filename), specifier)
      );
      const refused = targets.find(
        (target) =>
          !(typeOnly && target.allowTypeImports) &&
          (target.folder
            ? reached === target.folder ||
              reached.startsWith(target.folder + path.sep)
            : target.package.test(packageAt(reached) ?? ""))
      );
      if (refused)
        context.report({
          node: source,
          messageId: "refused",
          data: { message: refused.message },
        });
    }
    return {
      ImportDeclaration: (node) =>
        check(node.source, node.importKind === "type"),
      ExportNamedDeclaration: (node) =>
        check(node.source, node.exportKind === "type"),
      ExportAllDeclaration: (node) =>
        check(node.source, node.exportKind === "type"),
      ImportExpression: (node) => check(node.source, false),
      TSImportType: (node) =>
        check(node.source ?? node.argument?.literal, true),
    };
  },
};

export const plugin = "relative-imports";
// One object for every block: ESLint refuses to redefine a plugin.
const relativeImportsPlugin = { rules: { "no-restricted-targets": rule } };
const ruleName = `${plugin}/no-restricted-targets`;

/**
 * Refuses, in `files`, a relative import of any kind that reaches one of
 * `targets`: `{ folder }`, an absolute path, or `{ package }`, a regex on the
 * name in the package.json of the package it lands in. `allowTypeImports`
 * lets a type import through. A later block's targets replace an earlier
 * one's for its files.
 *
 * @param {string[]} files
 * @param {{ folder?: string; package?: string; message: string; allowTypeImports?: boolean }[]} targets
 * @param {{ ignores?: string[] }} [options]
 * @returns {import('eslint').Linter.Config}
 */
export function relativeImports(files, targets, { ignores = [] } = {}) {
  return {
    files,
    ...(ignores.length ? { ignores } : {}),
    plugins: { [plugin]: relativeImportsPlugin },
    rules: { [ruleName]: ["error", { targets }] },
  };
}
