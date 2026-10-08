/** Where JSON text stops being JSON: a 1-based line and column, and why. */
export type JsonSyntaxError = { line: number; column: number; message: string };

/**
 * The first syntax error in JSON text, or undefined when it is JSON. Engines
 * word `JSON.parse` errors differently, and V8 gives no position for an
 * unexpected token, so this finds the position itself. Nesting too deep
 * to scan gives undefined too.
 */
export function jsonSyntaxError(text: string): JsonSyntaxError | undefined {
  let at = 0;

  const fail = (expected: string): never => {
    const found = at < text.length ? `'${text[at]}'` : "the end of the text";
    throw new SyntaxAt(at, `expected ${expected}, found ${found}`);
  };
  const space = () => {
    // Only the four characters JSON takes as whitespace, not all of \s.
    while (/[ \t\n\r]/.test(text[at] ?? "")) at++;
  };
  const take = (char: string, expected = `'${char}'`) => {
    if (text[at] !== char) fail(expected);
    at++;
  };
  const string = () => {
    take('"');
    for (;;) {
      const char = text[at];
      if (char === undefined || char < " ") fail("'\"'");
      at++;
      if (char === '"') return;
      if (char === "\\") {
        if (text[at] === "u") {
          if (!/^[\da-fA-F]{4}$/.test(text.slice(at + 1, at + 5)))
            fail("four hex digits after \\u");
          at += 5;
        } else if (/^["\\/bfnrt]$/.test(text[at] ?? "")) at++;
        else fail("an escape character");
      }
    }
  };
  const value = () => {
    space();
    const char = text[at];
    if (char === "{") {
      at++;
      space();
      if (text[at] === "}") return void at++;
      for (;;) {
        space();
        if (text[at] !== '"') fail("a property name in double quotes");
        string();
        space();
        take(":");
        value();
        space();
        if (text[at] === "}") return void at++;
        take(",", "',' or '}'");
      }
    }
    if (char === "[") {
      at++;
      space();
      if (text[at] === "]") return void at++;
      for (;;) {
        value();
        space();
        if (text[at] === "]") return void at++;
        take(",", "',' or ']'");
      }
    }
    if (char === '"') return string();
    const literal = /^(true|false|null)/.exec(text.slice(at))?.[0];
    if (literal) return void (at += literal.length);
    const number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(
      text.slice(at)
    )?.[0];
    if (number) return void (at += number.length);
    fail("a value");
  };

  try {
    value();
    space();
    if (at < text.length) fail("the end of the text");
    return undefined;
  } catch (error) {
    // Nesting deeper than the call stack: JSON.parse's own message stands.
    if (error instanceof RangeError) return undefined;
    if (!(error instanceof SyntaxAt)) throw error;
    const before = text.slice(0, error.offset).split("\n");
    return {
      line: before.length,
      column: before.at(-1)!.length + 1,
      message: error.message,
    };
  }
}

class SyntaxAt extends Error {
  constructor(
    readonly offset: number,
    message: string
  ) {
    super(message);
  }
}
