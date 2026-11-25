// ESLint's unstable API, used to alias the built-in rule under a plugin name
// so this policy cannot collide with other uses of it.
import { builtinRules } from "eslint/use-at-your-own-risk";

// ayme's own page objects follow the guide ayme ships to consumers: a locator,
// or a child page object, is a getter, so it runs after `page` or `root` is
// assigned. Syntax alone tells a locator or child by a decorator, a `new`, or
// a Playwright locator call; other data may stay a field.
export const message =
  'Define a locator or child page object as a getter (skills/shared/page-object-design.md, "Define locators as getters").';

export const plugin = "page-objects";

const locatorCall =
  "CallExpression[callee.property.name=/^(getBy[A-Za-z]+|locator|filter|first|last|nth|or|and)$/]";

export default [
  {
    name: "@ayme-dev/page-objects",
    files: ["**/pom/**/*.{ts,tsx}"],
    // The compiler's and build plugin's fixtures declare fields on purpose, to
    // test how ayme reads them.
    ignores: ["**/fixtures/**"],
    plugins: {
      [plugin]: {
        rules: {
          "no-restricted-syntax": builtinRules.get("no-restricted-syntax"),
        },
      },
    },
    rules: {
      [`${plugin}/no-restricted-syntax`]: [
        "error",
        // A declared member, such as `@ayme.child`, however it is assigned.
        { selector: "PropertyDefinition[decorators.0]", message },
        {
          selector: `PropertyDefinition:not([decorators.0]) > :matches(NewExpression, ${locatorCall}).value`,
          message,
        },
        {
          selector: `MethodDefinition[kind='constructor'] AssignmentExpression[left.object.type='ThisExpression'] > :matches(NewExpression, ${locatorCall}).right`,
          message,
        },
      ],
    },
  },
];
