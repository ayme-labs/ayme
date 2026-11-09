// The Page Object Screen: the Page Object instances on the page, nested as
// their models nest, each declared child that is not a Page Object shown as
// its accessibility subtree, and how the screen changed. Text only: no
// Structural Ref appears in it, and an instance rooted tools act on carries
// its Instance Ref (`po<n>`).

/** One Page Object instance on the screen. */
export type ScreenObject = {
  className: string;
  /** Its Instance Ref, when rooted tools act on it. */
  ref?: string;
  children: readonly ScreenChild[];
};

/**
 * A declared child of an instance: elements, as the text after the child's
 * name and the lines below it, or the Page Objects it holds.
 */
export type ScreenChild =
  | { kind: "elements"; name: string; lines: readonly string[] }
  | { kind: "object"; name: string; object: ScreenObject }
  | { kind: "objects"; name: string; objects: readonly ScreenObject[] };

/** How many lines one declared child shows at most. */
export const MAX_CHILD_LINES = 40;
/** How many characters one line shows at most. */
export const MAX_LINE_LENGTH = 200;

/**
 * The lines of a declared child holding elements, from each element's aria
 * snapshot: one element's first line follows the child's name; a Locator
 * collection lists its elements below it, `[]` when it holds none. A child
 * longer than `MAX_CHILD_LINES` is cut and says how much was left out.
 */
export function elementLines(
  snapshots: readonly string[],
  collection: boolean
): string[] | undefined {
  const present = snapshots.filter((snapshot) => snapshot.trim());
  if (!collection && present.length === 0) return undefined;
  if (collection && present.length === 0) return ["[]"];
  let lines: string[];
  if (!collection && present.length === 1) {
    const own = present[0]!.split("\n");
    lines =
      own[0]!.startsWith("- ") && own.slice(1).every((line) => /^\s/.test(line))
        ? [own[0]!.slice(2), ...own.slice(1).map((line) => line.slice(2))]
        : ["", ...own];
  } else lines = ["", ...present.flatMap((snapshot) => snapshot.split("\n"))];
  lines = lines.map(shortLine);
  if (lines.length <= MAX_CHILD_LINES) return lines;
  const left = lines.length - MAX_CHILD_LINES;
  return [
    ...lines.slice(0, MAX_CHILD_LINES),
    `- (${left} more line${left === 1 ? "" : "s"} not shown)`,
  ];
}

const shortLine = (line: string) =>
  line.length <= MAX_LINE_LENGTH
    ? line
    : `${line.slice(0, MAX_LINE_LENGTH - 1)}…`;

const indent = (lines: readonly string[], by: number) =>
  lines.map((line) => " ".repeat(by) + line);

/** An instance's name: its class and, when it has one, its Instance Ref. */
export const objectLabel = (object: ScreenObject) =>
  object.ref ? `${object.className} [ref=${object.ref}]` : object.className;

/** The screen as `page_objects` answers it. */
export function renderPomScreen(screen: readonly ScreenObject[]): string {
  if (screen.length === 0) return "No Page Object is on the page.";
  return screen
    .flatMap((object) => [objectLabel(object), ...indent(bodyLines(object), 2)])
    .join("\n");
}

function bodyLines(object: ScreenObject): string[] {
  return object.children.flatMap(childLines);
}

function childLines(child: ScreenChild): string[] {
  switch (child.kind) {
    case "elements": {
      const [first = "", ...rest] = child.lines;
      return [`${child.name}:${first ? ` ${first}` : ""}`, ...indent(rest, 2)];
    }
    case "object":
      return [
        `${child.name}: ${objectLabel(child.object)}`,
        ...indent(bodyLines(child.object), 2),
      ];
    case "objects":
      return child.objects.length === 0
        ? [`${child.name}: []`]
        : [
            `${child.name}:`,
            ...child.objects.flatMap((object) =>
              indent(
                [`- ${objectLabel(object)}`, ...indent(bodyLines(object), 4)],
                2
              )
            ),
          ];
  }
}

/** Lines that were added: `+ ` on the first, the rest kept aligned under it. */
const added = (lines: readonly string[]) => [
  `+ ${lines[0]}`,
  ...indent(lines.slice(1), 2),
];

const sameObject = (left: ScreenObject, right: ScreenObject) =>
  left.className === right.className && left.ref === right.ref;

/**
 * How the screen changed from `before` to `after`, in the screen's own
 * notation: a changed child as `old → new`, a removed instance or child
 * marked `(removed)`, an added one shown in full after `+`. Unchanged
 * instances and children are left out. Undefined when nothing changed.
 */
export function renderScreenChanges(
  before: readonly ScreenObject[],
  after: readonly ScreenObject[]
): string | undefined {
  const lines: string[] = [];
  for (const old of before)
    if (!after.some((object) => sameObject(object, old)))
      lines.push(`- ${objectLabel(old)} (removed)`);
  for (const object of after) {
    const old = before.find((candidate) => sameObject(candidate, object));
    if (!old) {
      lines.push(
        ...added([objectLabel(object), ...indent(bodyLines(object), 2)])
      );
      continue;
    }
    const inner = objectChanges(old, object);
    if (inner.length) lines.push(objectLabel(object), ...indent(inner, 2));
  }
  return lines.length ? lines.join("\n") : undefined;
}

function objectChanges(before: ScreenObject, after: ScreenObject): string[] {
  const lines: string[] = [];
  for (const old of before.children)
    if (!after.children.some((child) => child.name === old.name))
      lines.push(removedChild(old));
  for (const child of after.children) {
    const old = before.children.find(({ name }) => name === child.name);
    lines.push(...(old ? childChanges(old, child) : added(childLines(child))));
  }
  return lines;
}

function removedChild(child: ScreenChild): string {
  switch (child.kind) {
    case "elements":
      return child.lines[0] && child.lines[0] !== "[]"
        ? `${child.name}: ${child.lines[0]} (removed)`
        : `${child.name} (removed)`;
    case "object":
      return `${child.name}: ${objectLabel(child.object)} (removed)`;
    case "objects":
      return `${child.name} (removed)`;
  }
}

function childChanges(before: ScreenChild, after: ScreenChild): string[] {
  const replaced = () => [removedChild(before), ...added(childLines(after))];
  if (before.kind === "elements" && after.kind === "elements")
    return elementChanges(after.name, before.lines, after.lines);
  if (before.kind === "object" && after.kind === "object") {
    if (!sameObject(before.object, after.object)) return replaced();
    const inner = objectChanges(before.object, after.object);
    return inner.length
      ? [`${after.name}: ${objectLabel(after.object)}`, ...indent(inner, 2)]
      : [];
  }
  if (before.kind === "objects" && after.kind === "objects") {
    const inner = itemChanges(before.objects, after.objects);
    return inner.length ? [`${after.name}:`, ...indent(inner, 2)] : [];
  }
  return replaced();
}

function elementChanges(
  name: string,
  before: readonly string[],
  after: readonly string[]
): string[] {
  if (
    before.length === after.length &&
    before.every((line, index) => line === after[index])
  )
    return [];
  if (before.length === 1 && after.length === 1 && before[0] && after[0])
    return [`${name}: ${valueChange(before[0], after[0])}`];
  return [`${name}:`, ...indent(lineChanges(before, after), 2)];
}

/**
 * One aria line's change: `key: old → new` when only the value after the
 * role, name and states changed, else the whole line `old → new`.
 */
function valueChange(before: string, after: string): string {
  const left = splitAriaLine(before);
  const right = splitAriaLine(after);
  if (left && right && left.key === right.key)
    return `${left.key}: ${left.value ?? '""'} → ${right.value ?? '""'}`;
  return `${before} → ${after}`;
}

const ARIA_LINE =
  /^((?:- )?[^\s:"[\]]+(?: "(?:[^"\\]|\\.)*")?(?: \[[^\]]*\])*)(?::(?: (.*))?)?$/;

function splitAriaLine(
  line: string
): { key: string; value?: string } | undefined {
  const match = ARIA_LINE.exec(line);
  if (!match) return undefined;
  return match[2] === undefined
    ? { key: match[1]! }
    : { key: match[1]!, value: match[2] };
}

/**
 * The lines that changed between two subtrees, by their longest common
 * subsequence: a removed line paired with the added one after it as
 * `old → new`, an unpaired removed one marked `(removed)`, an unpaired added
 * one after `+`. Unchanged lines are left out.
 */
function lineChanges(
  before: readonly string[],
  after: readonly string[]
): string[] {
  const rows = before.length;
  const columns = after.length;
  const common = Array.from({ length: rows + 1 }, () =>
    new Array<number>(columns + 1).fill(0)
  );
  for (let row = rows - 1; row >= 0; row--)
    for (let column = columns - 1; column >= 0; column--)
      common[row]![column] =
        before[row] === after[column]
          ? common[row + 1]![column + 1]! + 1
          : Math.max(common[row + 1]![column]!, common[row]![column + 1]!);
  const lines: string[] = [];
  let removed: string[] = [];
  let addedLines: string[] = [];
  const flush = () => {
    const paired = Math.min(removed.length, addedLines.length);
    for (let index = 0; index < paired; index++)
      lines.push(`${removed[index]} → ${addedLines[index]!.trimStart()}`);
    for (const line of removed.slice(paired)) lines.push(`${line} (removed)`);
    for (const line of addedLines.slice(paired)) lines.push(`+ ${line}`);
    removed = [];
    addedLines = [];
  };
  let row = 0;
  let column = 0;
  while (row < rows || column < columns) {
    if (row < rows && column < columns && before[row] === after[column]) {
      flush();
      row++;
      column++;
    } else if (
      column >= columns ||
      (row < rows && common[row + 1]![column]! >= common[row]![column + 1]!)
    )
      removed.push(before[row++]!);
    else addedLines.push(after[column++]!);
  }
  flush();
  return lines.filter((line) => line.trim());
}

/**
 * How a collection's Page Objects changed: matched by Instance Ref, or by
 * position for those without one. A removed one without a ref keeps its
 * first child, so the agent can tell which went.
 */
function itemChanges(
  before: readonly ScreenObject[],
  after: readonly ScreenObject[]
): string[] {
  const matchOf = (object: ScreenObject, index: number) =>
    object.ref
      ? before.find((old) => old.ref === object.ref)
      : before[index] &&
          !before[index].ref &&
          before[index].className === object.className
        ? before[index]
        : undefined;
  const matched = new Set(
    after.flatMap((object, index) => {
      const old = matchOf(object, index);
      return old ? [old] : [];
    })
  );
  const lines: string[] = [];
  for (const old of before)
    if (!matched.has(old)) {
      const first = old.ref ? undefined : bodyLines(old)[0];
      lines.push(
        `- ${objectLabel(old)} (removed)${first ? `, was: ${first.trim()}` : ""}`
      );
    }
  after.forEach((object, index) => {
    const old = matchOf(object, index);
    if (!old) {
      lines.push(`+ ${objectLabel(object)}`, ...indent(bodyLines(object), 4));
      return;
    }
    const inner = objectChanges(old, object);
    if (inner.length)
      lines.push(`- ${objectLabel(object)}`, ...indent(inner, 4));
  });
  return lines;
}
