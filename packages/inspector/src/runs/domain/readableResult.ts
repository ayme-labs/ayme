/**
 * A Run's result as Runs shows it: its JSON indented, except that a string
 * spanning lines shows as those lines, unquoted and indented under its key,
 * rather than as one line of `\n`s. That is no longer JSON, so Copy copies
 * the result itself. A result that isn't JSON shows as it is.
 */
export function readableResult(json: string): string {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return json;
  }
  return isBlock(value) ? value : readable(value, "");
}

function isBlock(value: unknown): value is string {
  return typeof value === "string" && value.includes("\n");
}

function readable(value: unknown, indent: string): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const inner = `${indent}  `;
  const entries = Array.isArray(value)
    ? value.map((item) => entry(undefined, item, inner))
    : Object.entries(value).map(([key, item]) =>
        entry(JSON.stringify(key), item, inner)
      );
  const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  if (entries.length === 0) return `${open}${close}`;
  // A block's end shows by its lines dedenting, so it takes no comma.
  const lines = entries.map(({ text, block }, index) =>
    block || index === entries.length - 1 ? text : `${text},`
  );
  return `${open}\n${lines.join("\n")}\n${indent}${close}`;
}

function entry(key: string | undefined, value: unknown, indent: string) {
  if (!isBlock(value)) {
    const label = key === undefined ? "" : `${key}: `;
    return {
      text: `${indent}${label}${readable(value, indent)}`,
      block: false,
    };
  }
  const blockIndent = key === undefined ? indent : `${indent}  `;
  const lines = value
    .split("\n")
    .map((line) => (line ? `${blockIndent}${line}` : ""));
  return {
    text: (key === undefined ? lines : [`${indent}${key}:`, ...lines]).join(
      "\n"
    ),
    block: true,
  };
}
