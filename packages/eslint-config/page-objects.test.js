import assert from "node:assert/strict";
import { test } from "node:test";
import { Linter } from "eslint";
import base from "./base.js";
import { message as guideMessage, plugin } from "./page-objects.js";

const linter = new Linter();

/** What `base` reports under the page-objects policy for `code` in
 *  `filename`: "refused" for each refusal that cites the guide. */
function lint(code, filename = "ayme/pom/ListPage.ts") {
  return linter
    .verify(code, base, { filename })
    .filter((message) => message.ruleId?.startsWith(`${plugin}/`))
    .map((message) =>
      message.message === guideMessage ? "refused" : message.message
    );
}

const fieldLocator = `export class ListPage {
  constructor(readonly page) {}
  readonly addButton = this.page.getByRole("button");
}
`;

test("the refusal cites the guide", () => {
  assert.match(guideMessage, /skills\/shared\/page-object-design\.md/);
});

test("a locator or child read from this in a field initializer is refused", () => {
  assert.deepEqual(lint(fieldLocator), ["refused"]);
  assert.deepEqual(
    lint(`export class ListPage {
  constructor(readonly page) {}
  readonly dialog = new Dialog(this.page.getByRole("dialog"));
}
`),
    ["refused"]
  );
});

test("a locator or child stored by a constructor is refused", () => {
  assert.deepEqual(
    lint(`export class ListPage {
  readonly addButton;
  readonly dialog;
  constructor(page) {
    this.addButton = page.getByRole("button");
    this.dialog = new Dialog(page.getByRole("dialog"));
  }
}
`),
    ["refused", "refused"]
  );
});

test("a getter, a constructor input and plain data pass", () => {
  assert.deepEqual(
    lint(`export class ListPage {
  readonly path = "/list";
  readonly page;
  private readonly label;
  constructor(page, label) {
    this.page = page;
    this.label = label;
  }
  readonly onClose = () => this.page.close();
  get addButton() {
    return this.page.getByRole("button");
  }
}
`),
    []
  );
});

test("only page-object folders are checked, and not the compiler's fixtures", () => {
  for (const filename of [
    "src/ListPage.ts",
    "src/compiler/__tests__/fixtures/solutionStyle/src/pom/ListPage.ts",
    "src/fixtures/pom/ListPage.ts",
  ])
    assert.deepEqual(lint(fieldLocator, filename), [], filename);
  assert.deepEqual(lint(fieldLocator, "testing/pom/Inspector.ts"), ["refused"]);
});
