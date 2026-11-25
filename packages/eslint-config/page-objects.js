// ESLint's unstable API, used to alias the built-in rule under a plugin name
// so this policy cannot collide with other uses of it.
import { builtinRules } from "eslint/use-at-your-own-risk";

// ayme's own page objects follow the guide ayme ships to consumers: a locator,
// or a child page object, is a getter, so it runs after `page` or `root` is
// assigned. Syntax alone cannot tell a locator from plain data, so this
// refuses what reads `this` in a field initializer, and anything but a
// constructor input stored by a constructor.
export const message =
  'Define a locator or child page object as a getter (skills/shared/page-object-design.md, "Define locators as getters").';

export const plugin = "page-objects";

export default [
  {
    name: "@ayme-dev/page-objects",
    files: ["**/pom/**/*.{ts,tsx}"],
    // The compiler's and build plugin's fixtures declare fields on purpose, to
    // test how ayme reads them.
    ignores: ["**/fixtures/**", "**/__tests__/**"],
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
        {
          selector:
            "PropertyDefinition[static=false]:not([value.type=/FunctionExpression$/]):has(ThisExpression)",
          message,
        },
        {
          selector:
            "MethodDefinition[kind='constructor'] AssignmentExpression[left.object.type='ThisExpression']:not([right.type='Identifier']):not([right.type='Literal'])",
          message,
        },
      ],
    },
  },
];
