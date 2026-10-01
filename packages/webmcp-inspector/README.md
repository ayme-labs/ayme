# @ayme-dev/webmcp-inspector

Browser Inspector for Ayme Page Object Models. It shows the live POM classes
and their member states, a form for each generated tool, execution history,
browser traces, and the structural page state a model sees, in an isolated
open Shadow Root.

The Inspector is a React app on `@ayme-dev/design-system`. React is bundled
into the package, so a host app of any framework, or any React version, never
shares it. Its Tailwind stylesheet is compiled at build time and injected into
the Shadow Root only; the host document's head receives just the page
highlight style.

Enable it through the Vite integration:

```ts
import { aymeWebMcp } from "@ayme-dev/unplugin-webmcp/vite";

export default {
  plugins: [aymeWebMcp({ inspector: true })],
};
```

The plugin starts the Inspector before application modules run, so default and
supplied Pages are instrumented before their first Page Object is constructed.
No component props, mount call, or custom element registration is required.

`inspector: false` (the default) omits the Inspector startup module. Inspector
diagnostics work independently of WebMCP publication, so `publish: false` is a
supported combination.

The Inspector marks its body host and structural page-state capture temporarily
hides that host from the accessibility snapshot. The host is otherwise visible
and accessible, and its styles are contained by the Shadow Root.

The playground imports `withDemoFeedback` from
`@ayme-dev/webmcp-inspector/demo` to keep its teaching delay and click cue.
Applications do not need this demo-only entry point.
