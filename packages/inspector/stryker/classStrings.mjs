/**
 * A Stryker ignorer that skips the strings holding Tailwind classes, which are
 * styling no test reads. It skips only the string or template literal itself:
 * a condition around it, as in `open && "rotate-90"`, is still mutated.
 *
 * A literal counts as a class string when it reaches `cn(...)` or
 * `className={...}`, directly or through a constant or lookup table of the same
 * file. Failing that, it counts when it has several words that all look like
 * Tailwind classes, at least one with a variant colon, a bracket or a digit.
 *
 * Stryker loads the module by the `strykerPlugins` it exports.
 */

const REASON = "Tailwind classes are styling, which no test reads.";

/** The function whose arguments are class names. */
const CLASS_FUNCTION = "cn";

/** A Tailwind class: a utility, with variants before it and a value after it. */
const TAILWIND_WORD =
  /^(?:[a-z0-9*&>[\]()_=,.'"%#@!-]+:)*!?-?[a-z][\w./%#()[\],='"&>*+-]*$/;
const MARKS_TAILWIND = /[:[\]0-9]/;
/** A lone word, such as `active:bg-[red]`, is a class only with both. */
const VARIANT_WITH_VALUE = /:.*\[/;

/** @param {{ node: any }} path A Babel node path. */
function shouldIgnore(path) {
  if (!isClassString(path)) return undefined;
  return REASON;
}

function isClassString(path) {
  const value = stringValue(path.node);
  if (value === undefined) return false;
  return reachesClassSink(path, new Set()) || looksLikeClasses(value);
}

/**
 * The text of a string literal, or of a template literal whose expressions are
 * only names. A template literal with a condition in one is left to Stryker:
 * skipping it would also skip the condition.
 */
function stringValue(node) {
  if (node.type === "StringLiteral") return node.value;
  if (
    node.type === "TemplateLiteral" &&
    node.expressions.every((expression) => expression.type === "Identifier")
  ) {
    // Each expression stands for a class word.
    return node.quasis.map((quasi) => quasi.value.cooked ?? "").join(" x ");
  }
  return undefined;
}

function looksLikeClasses(value) {
  const words = value.trim().split(/\s+/);
  return (
    (words.length > 1 || VARIANT_WITH_VALUE.test(words[0])) &&
    words.every((word) => TAILWIND_WORD.test(word)) &&
    words.some((word) => MARKS_TAILWIND.test(word))
  );
}

/**
 * Walks up from an expression through the nodes that pass a string on as it
 * is, and says whether it ends in `cn(...)` or a `className` attribute.
 */
function reachesClassSink(path, visited) {
  let child = path;
  for (let parent = child.parentPath; parent; parent = child.parentPath) {
    const { node } = parent;
    switch (node.type) {
      case "ConditionalExpression":
        if (node.test === child.node) return false;
        break;
      case "LogicalExpression":
        if (node.operator === "&&" && node.right !== child.node) return false;
        break;
      case "BinaryExpression":
        if (node.operator !== "+") return false;
        break;
      case "MemberExpression":
      case "OptionalMemberExpression":
        if (node.object !== child.node) return false;
        break;
      case "ObjectProperty":
        if (node.value !== child.node) return false;
        break;
      case "ArrayExpression":
      case "ObjectExpression":
      case "TemplateLiteral":
      case "SpreadElement":
      case "ParenthesizedExpression":
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
        break;
      case "CallExpression":
        return (
          node.callee.type === "Identifier" &&
          node.callee.name === CLASS_FUNCTION &&
          node.arguments.includes(child.node)
        );
      case "JSXExpressionContainer":
        return (
          parent.parentPath.node.type === "JSXAttribute" &&
          parent.parentPath.node.name.name === "className"
        );
      case "VariableDeclarator":
        return (
          node.init === child.node && constantReachesClassSink(parent, visited)
        );
      default:
        return false;
    }
    child = parent;
  }
  return false;
}

/** Whether any use of a constant, in this file, reaches a class sink. */
function constantReachesClassSink(declarator, visited) {
  const { id } = declarator.node;
  if (id.type !== "Identifier" || visited.has(declarator.node)) return false;
  visited.add(declarator.node);
  const binding = declarator.scope.getBinding(id.name);
  return (
    binding?.referencePaths.some((use) => reachesClassSink(use, visited)) ??
    false
  );
}

export const strykerPlugins = [
  {
    kind: "Ignore",
    name: "classStrings",
    value: { shouldIgnore },
  },
];
