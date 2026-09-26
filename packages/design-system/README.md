# @ayme-dev/design-system

Ayme's design system: the palette, the semantic tokens, the logos and the React
components that every Ayme surface shares. It is a private, source-only package:
consumers compile it, and nothing is published to npm. ayde and ayme-private
consume it from a git subtree of this repository at `vendor/ayme`, and never edit
it there. A change lands here first.

The logos are trademarks and are not covered by the code license. See
[TRADEMARKS.md](TRADEMARKS.md). The components and `cn()` are derived from
shadcn/ui; their upstream MIT notice is in
[THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).

## Contents

| Export            | What it is                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `globals.css`     | The stylesheet for a page that owns its document: Tailwind, `theme.css`, and base styles for `*` and `body`                |
| `theme.css`       | The design system without Tailwind's import or base styles, for a shadow root or another Tailwind entry                    |
| `palette.css`     | The palette as a Tailwind `@theme`: 10 families, 50 to 950, in OKLCH. Tailwind's other default colours are disabled        |
| `tokens.css`      | shadcn's semantic tokens (`--background`, `--primary`, …) plus `--success`, `--warning`, motion and radius, light and dark |
| `components/*`    | shadcn components: `badge`, `button`, `card`, `marker`, `popover`, `resizable`, `separator`                                |
| `lib/utils`       | `cn()`                                                                                                                     |
| `logo`            | The Ayme mark as path data, for drawing it inline                                                                          |
| `logo/*`          | The mark, the small mark, the wordmark, favicons and app icons                                                             |
| `shadow-tailwind` | A Vite plugin that compiles a Tailwind entry for a shadow root and serves it as a string module                            |

## Use

A page that owns its document (Next.js needs `transpilePackages: ["@ayme-dev/design-system"]`):

```css
@import "@ayme-dev/design-system/globals.css";
```

A panel in a shadow root keeps its own Tailwind import and scans its own sources:

```css
@import "tailwindcss" source(none);
@import "@ayme-dev/design-system/theme.css";
@source "./panel";
```

```ts
import { shadowTailwind } from "@ayme-dev/design-system/shadow-tailwind";

shadowTailwind({ entry: "/abs/path/panel.css", moduleId: "virtual:panel-css" });
```

Inside a shadow root, `@property` is ignored and `rem` follows the host page's
font size. The plugin makes Tailwind's `--tw-*` initial values apply anyway and
converts `rem` to `px`.

Components:

```tsx
import { Button } from "@ayme-dev/design-system/components/button";
```

Add more with the shadcn CLI from this package's directory; `components.json`
points its aliases here.

## Dark mode

Dark mode is a class. The `.dark` values apply to an element with that class and
everything inside it, and so does Tailwind's `dark:` variant. A page sets it on
`<html>` (for example with next-themes). An embedded panel sets it on its own root
element, from the Site's or the OS's preference.

## Fonts

The UI font is not chosen yet, so the tokens leave Tailwind's system font stack
in place. Landing pages use their own fonts under their own token names, and do
not load them from this package.
