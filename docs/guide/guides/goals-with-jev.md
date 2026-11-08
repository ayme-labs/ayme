# Goals with Jev

How to let a decision model drive your page toward a goal, with the Goal Loop, your Decision Endpoint and the Handover.

> **Experimental:** this may change in any release. See [Experimental APIs](../reference/experimental-apis.md).

## What the Goal Loop does

An agent connected to your page can hand Ayme a goal in natural language, such as "archive the oldest item", through the `goal` tool. The Goal Loop drives the page toward it in steps. In each step a decision model, a fast model that picks among options it is given, chooses at most one operation to run, not the calling agent's LLM. The model Ayme uses today is Jev, TypeSafe's System One model. When the loop stops, it hands control back to the calling agent with a Handover: why it stopped, what it did and what to do next.

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

Put `TYPESAFE_API_KEY` in your `.env` file; with an OpenRouter key, set `provider: "openrouter"`. `apply: "serve"` keeps it out of production builds, and `authorize() {}` lets every request through, which is fine on your own machine only. The [Vue example](https://github.com/ayme-labs/ayme/blob/main/apps/example-vue/README.md) runs this setup.

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

Your own code runs the same loop with `ayme.tools.run("goal", { goal, maxSteps, values })`, whether or not tools are published and whether or not a WebMCP driver is present. It throws when the session is not started or has no `goalLoop`.

## Goal Values

Text the page does not hold, such as the name to type into `fill`, the URL for `navigate` or the options for `select_option`, comes from the calling agent. It passes it with the goal as `values`: strings or numbers, each labelled in its own words.

```ts
goal({
  goal: "Rename the survey to Q4 Feedback",
  maxSteps: 6,
  values: { "survey name": "Q4 Feedback" },
});
```

The values are candidates, not instructions. At any step, a parameter the loop cannot fill from the page is offered the values whose type fits it: strings for a `string`, any number for a `number`, whole numbers for an `integer`, and the same for the items of a list. One value may be used at several steps and for several parameters. `values` takes 1 to 254 entries; anything else is refused as invalid input before the loop starts. Both stages of every step see the values as passed, in their state.

- **Required parameter.** One question offers each fitting value as `label: value`, plus "none of these". With no fitting value the loop ends with `needs_value` without asking, naming the operation and its required parameters; when the model answers "none of these", it ends with `needs_value` naming the operation and that parameter.
- **Optional parameter.** One question offers the fitting values plus "leave unset". With no fitting value it stays unset.
- **List of strings or numbers.** Each fitting value is a yes-or-no question of its own, asked in the same request; every value scored 0.5 or more is included, in the order of `values`. A select that holds one option at a time receives only the value scored highest. A required list that includes nothing ends with `needs_value`; an optional one stays unset.
- **List of enum values.** Each enum value is a yes-or-no question of its own, in the same way; Goal Values are never offered, so the list holds only enum values. A required list that includes nothing ends with `needs_value`, and `next` says none of its allowed values belongs in it.
- **Tuple.** Each slot is a parameter of its own, filled by its own rule. A tuple ends at its first slot left unset, an optional tuple that ends up empty or missing a slot it requires is left out, and a required tuple with no slot set is passed empty. A handover names the tuple, not its slot, and a step's `chosen` leaves out the slots that hold no value.
- **Union of primitives**, such as `string | boolean`. One question offers its enum values and booleans together with the values that fit its other types.
- **Map, list of booleans, list of objects, list of lists, object.** Never filled from values: a required one ends with `needs_value`, an optional one stays unset.

The history shows the value a step used as `label: value`, such as `fill(textbox "Survey name", survey name: Q4 Feedback)`. After a `needs_value`, call `goal` again with the missing value added; the steps already taken stay done, and the new run continues from the current page.

## What leaves the page

Each step sends the page state, the goal and the step's question from the browser to your Decision Endpoint, and from there, with your key, to the model. Nothing goes to Ayme, which has no backend.

## The Handover

`goal({ goal, maxSteps, values })` returns a Handover:

```ts
{
  reason:  "done" | "unverified" | "no_fitting_option" | "needs_value"
         | "action_failed" | "no_progress" | "step_budget"
         | "decide_failed" | "page_loading",
  next:    string,     // plain words: what the calling agent should do now
  history: {
    operation: string,   // the tool's name; a Page Object Tool's qualified name
    chosen: Record<string, { key: string, description: string }>,
    result: string,      // "ok", or the error the action failed with
    page_changed: boolean,
    changes?: string,    // what the step changed, cut to 400 characters; absent when nothing
    returned?: JsonValue, // what the tool returned, its JSON cut to 200 characters; absent when nothing
    did: string,         // operation(description, …), for a human skimming
  }[],
  needs?:  { tool: string, parameters: string[] },  // only with needs_value or no_progress
  loading?: string,    // only with page_loading: the URL the load started for
  changes?: string,    // what the whole run changed; absent when nothing did
}
```

| Reason              | Meaning                                                                                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `done`              | The model chose no further operation and judged the goal achieved on the page (goal_met ≥ 0.7), or, after a step that ran ok, no step of it still outstanding (goal_remaining ≤ 0.3). A goal may end in an effect the page never shows.            |
| `unverified`        | The model chose no further operation but could not tell whether the goal holds (goal_met from 0.3 up to 0.7), as when the page does not show it. Check the page with `snapshot`, or call `goal` again with the goal phrased as the action to take. |
| `no_fitting_option` | The model chose "none" and judged the goal not achieved (goal_met < 0.3), as no available operation fits, or answered "none of these" to a collection item or in every chunk of a ref.                                                             |
| `needs_value`       | The chosen operation needs values the loop cannot fill, from the page or the Goal Values. `needs` names the tool and its parameters.                                                                                                               |
| `action_failed`     | Two operations failed in a row.                                                                                                                                                                                                                    |
| `no_progress`       | The loop stopped before repeating its last step to no effect. `needs` names the tool and its parameters.                                                                                                                                           |
| `step_budget`       | `maxSteps` ran out before the goal was achieved.                                                                                                                                                                                                   |
| `decide_failed`     | The decision function failed (network, no endpoint mounted, rejected or malformed), its answer could not be used, or the page offers more operations than one decision can choose from. `next` advises a retry only when one can help.             |
| `page_loading`      | The last step started a [full page load](page-state.md#full-page-loads) of the URL in `loading`; call `snapshot` once it has loaded.                                                                                                               |

A step repeats to no effect when it has the same operation and chosen arguments as the step before, and that step did not change the page, or when it would be the third in a row even though the page changed. The loop does not run it again: `next` names the step, and tells the calling agent to perform it itself or to call `goal` again with a goal that names the element.

`history` has one entry per operation the loop ran, with the fields typed above. A step that hands over before acting records nothing. `chosen` holds, for each parameter the model was asked about, the key and description of the option it picked. That includes a choice to leave the parameter unset. Where `changes` or `returned` was cut, it ends in `… (cut)`. `returned` is the only trace of an effect the page does not show. `did` is a one-line label for a human, such as `click(button "Add item")`. The model is sent the same entries as its history.

`changes` is one Change Record for the whole run: the page the calling agent last received against the page after the run, which becomes the agent's page for its next Change Record.

Take `ProjectsPage` and `ProjectRow` from [Page Object Models](ayme-page-objects.md#aymeaction). Say the goal is "archive the Q4 survey project". The run opens the New project dialog by mistake. It closes the dialog with its Cancel button. Then it archives Q4 survey. The Handover's `changes` carries only the net result: Q4 survey removed. The dialog that came and went shows only in `history`.

```ts
{
  reason: "done",
  next: "The goal has been achieved. Continue with your next task.",
  history: [
    { operation: "ProjectsPage.openNewProjectDialog", chosen: {}, result: "ok",
      page_changed: true,
      changes: `- e2 main:
  - e4 <changed> button "New project" [active]
  - e14 <added> dialog "New project":
    - e15 <added> textbox "Project name"
    - e16 <added> button "Create"
    - e17 <added> button "Cancel"`,
      did: "ProjectsPage.openNewProjectDialog()" },
    { operation: "click",
      chosen: { target: { key: "e17", description: 'button "Cancel"' } },
      result: "ok", page_changed: true,
      changes: `- e2 main:
  - e4 <changed> button "New project"
  - e14 <removed> dialog "New project":
    - e15 <removed> textbox "Project name"
    - e16 <removed> button "Create"
    - e17 <removed> button "Cancel"`,
      did: 'click(button "Cancel")' },
    { operation: "ProjectRow.archive",
      chosen: { ref: { key: "e10",
        description: 'ProjectRow on ref "e10" (listitem): Q4 survey · Archive · Rename · Remove' } },
      result: "ok", page_changed: true,
      changes: `- e2 main:
  - e5 list:
    - e10 ProjectRow <removed>:
      - text: Q4 survey
      - e11 <removed> button "Archive"
      - e12 <removed> button "Rename"
      - e13 <removed> button "Remove"`,
      did: 'ProjectRow.archive(ProjectRow on ref "e10" (listitem): Q4 survey · Archive · Rename · Remove)' },
  ],
  changes: `- e2 main:
  - e5 list:
    - e10 ProjectRow <removed>:
      - text: Q4 survey
      - e11 <removed> button "Archive"
      - e12 <removed> button "Rename"
      - e13 <removed> button "Remove"`,
}
```
