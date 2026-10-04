# Goals with Jev

How to let a decision model drive your page toward a goal, with the Goal Loop, your Decision Endpoint and the Handover.

## What the Goal Loop does

An agent connected to your page can hand Ayme a goal in natural language, such as "archive the oldest item", through the `goal` tool. The Goal Loop drives the page toward it in steps. Each step is one judgement by a decision model, a fast model that picks among options it is given, not by the calling agent's LLM. The model Ayme uses today is Jev, TypeSafe's System One model. When the loop stops, it hands control back to the calling agent with a Handover: why it stopped, what it did and what to do next.

## Mount the Decision Endpoint

The decision model needs your key, from TypeSafe or from OpenRouter, which must stay on your server. The Decision Endpoint is the route in your backend that adds the key to each decision model request; Ayme ships its handler:

```ts
import { createDecisionEndpoint } from "@ayme-dev/ayme/server";

const handleDecision = createDecisionEndpoint({
  provider: "typesafe", // or "openrouter"
  apiKey: process.env.TYPESAFE_API_KEY!,
  authorize(request) {
    // Required in production: authenticate the user and check they may use
    // the Goal Loop. Return to allow; throw a Response, such as a 401, to reject.
  },
});
```

### Local development, no backend needed

While you develop, mount the handler in your dev server, so you need no backend at all. In Vite, add a small plugin to `vite.config.ts`:

```ts
// vite.config.ts
import { createDecisionEndpoint } from "@ayme-dev/ayme/server";
import { defineConfig, loadEnv, type Plugin } from "vite";

function decisionEndpoint(apiKey: string): Plugin {
  const handle = createDecisionEndpoint({
    provider: "typesafe",
    apiKey,
    authorize() {},
  });
  return {
    name: "decision-endpoint",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/decisions", async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const response = await handle(
          new Request(`http://${req.headers.host}${req.url}`, {
            method: req.method,
            headers: req.headers as HeadersInit,
            body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
          })
        );
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(Buffer.from(await response.arrayBuffer()));
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    // ...your framework's plugin and ayme()
    decisionEndpoint(loadEnv(mode, process.cwd(), "").TYPESAFE_API_KEY),
  ],
}));
```

Put `TYPESAFE_API_KEY` in your `.env` file; with an OpenRouter key, set `provider: "openrouter"`. `apply: "serve"` keeps it out of production builds, and `authorize() {}` lets every request through, which is fine on your own machine only. The [Vue example](../../../apps/example-vue/README.md) runs this setup.

### In production

Mount `handleDecision` on a route of your backend. It takes a Fetch API `Request` and returns a `Response`, so it fits any server that speaks the Fetch API, such as a Next.js route handler or a Hono, Express or Nuxt server route. Use `authorize` to decide who may spend your key, such as signed-in users only.

Keep the key in a server-only environment variable; in Vite, one without the `VITE_` prefix. The [Decision Endpoint reference](../reference/decision-endpoint.md) has the full route contract.

## Turn the loop on

Pass `goalLoop` where Ayme starts. `decisionEndpoint(url)` builds the decision function that calls your route:

```ts
import { createAyme, decisionEndpoint } from "@ayme-dev/ayme";

createAyme({
  goalLoop: decisionEndpoint("/api/decisions", { credentials: "same-origin" }),
});
```

The `goal` tool is published only when `goalLoop` is set. `goalLoop` accepts any function from a `DecisionRequest` to a `Promise<DecisionResponse>`, so a test can pass a fake one.

Your own code runs the same loop with `ayme.tools.run("goal", { goal, maxSteps })`, whether or not tools are published and whether or not a WebMCP driver is present. It throws when the session is not started or has no `goalLoop`.

## What one step asks

The model decides each step on the current Structural Page State as JSON, one object per node, pruned of what it cannot target: a `generic` node with no name, props, state or pointer cursor is replaced by its children, so wrapper chains vanish and the text of their leaves is kept. The pruning affects only what the model reads; the options it is offered and the Change Record come from the full capture.

A step first asks which operation moves closest to the goal and whether the goal is met. The operations are the live Page Object Tools, Custom Tools and single-element Browser Tools. When the chosen operation takes arguments from a closed set, a Structural Ref, an enum value or a boolean, a second request asks for all of them at once, and the operation runs with the chosen values.

- The ref options are the elements the operation's filter keeps, one per element in document order; nothing is merged or ranked.
- One question offers at most 255 options. More elements are cut into chunks of at most 254 plus "none of these", asked side by side. When exactly one chunk names an element, the operation runs on it; when several do, one more question offers just those; when none does, the loop ends with `no_fitting_option`.
- An optional closed-set parameter gets an extra choice that leaves it unset.
- The model never writes a free value. An operation that needs one, such as `fill`, ends the loop with `needs_value`, so the calling agent supplies it.

## What leaves the page

Each step sends the pruned page state, the goal and the step's question from the browser to your Decision Endpoint, and from there, with your key, to the model. Nothing goes to Ayme, which has no backend.

## The Handover

`goal({ goal, maxSteps })` returns a Handover:

```ts
{
  reason:  "done" | "no_fitting_option" | "needs_value"
         | "action_failed" | "step_budget" | "decide_failed",
  next:    string,     // plain words: what the calling agent should do now
  history: {
    operation: string,   // the tool's name; a Page Object Tool's qualified name
    chosen: Record<string, { key: string, description: string }>,
    result: string,      // "ok", or the error the action failed with
    page_changed: boolean,
    did: string,         // operation(description, …), for a human skimming
  }[],
  needs?:  { tool: string, parameters: string[] },  // only with needs_value
  changes?: string,    // what the whole run changed; absent when nothing did
}
```

| Reason              | Meaning                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `done`              | The model judged the goal achieved (goal_met ≥ 0.5).                                                               |
| `no_fitting_option` | The model chose "none", as no available operation fits, or every chunk of a ref question answered "none of these". |
| `needs_value`       | The chosen operation needs values the loop cannot fill. `needs` names the tool and its parameters.                 |
| `action_failed`     | Two operations failed in a row.                                                                                    |
| `step_budget`       | `maxSteps` ran out before the goal was achieved.                                                                   |
| `decide_failed`     | The decision function failed: network, rejected or malformed.                                                      |

`history` records each operation the loop ran: the tool in `operation`; in `chosen`, per parameter asked, the key of the option the model chose and its description exactly as offered, a choice to leave it unset included; `"ok"` or an error message in `result`; whether the page changed in `page_changed`; and `did`, a one-line label such as `click(button "Add item")`. A step that hands over before acting records nothing. The model is sent the same entries as its history.

`changes` is one Change Record for the whole run: the page the calling agent last received against the page after the run, which becomes the agent's page for its next Change Record. A run that opened a dialog, closed it and archived an item hands over only the net result:

```ts
{
  reason: "done",
  next: "The goal has been achieved. Continue with your next task.",
  history: [
    { operation: "InboxPage.openDialog", chosen: {}, result: "ok",
      page_changed: true, did: "InboxPage.openDialog()" },
    { operation: "InboxPage.closeDialog", chosen: {}, result: "ok",
      page_changed: true, did: "InboxPage.closeDialog()" },
    { operation: "InboxPage.invoices.archive",
      chosen: { ref: { key: "e5",
        description: 'InboxPage.invoices[0] (listitem "Invoice 7")' } },
      result: "ok", page_changed: true,
      did: 'InboxPage.invoices.archive(InboxPage.invoices[0] (listitem "Invoice 7"))' },
  ],
  changes: `- e2 main:
  - e4 list:
    - e5 <removed> listitem: Invoice 7
  - e9 <added> paragraph: Archived Invoice 7`,
}
```
