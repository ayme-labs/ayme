import type { AymeRuns, Caller } from "@ayme-dev/ayme";

/**
 * The playground's analytics events. On ayme.dev/playground/ the page loads
 * the landing's Google Tag Manager container, which reads them from
 * `dataLayer`; elsewhere nothing reads them.
 */
export type PlaygroundEvent =
  | { event: "playground_agent_panel_open" }
  | { event: "playground_agent_panel_step"; step: number; step_name: string }
  | { event: "playground_prompt_copy"; prompt: string }
  | { event: "playground_view_switch"; view: "app" | "code" }
  | {
      event: "playground_tool_run";
      tool: string;
      caller: Caller;
      status: "succeeded" | "failed";
    };

declare global {
  interface Window {
    dataLayer?: object[];
  }
}

export function track(event: PlaygroundEvent) {
  (window.dataLayer ??= []).push(event);
}

/**
 * Reports each top-level Run once it ends: who ran which tool, such as a
 * visitor from the Inspector or a browser agent through WebMCP. Child Runs
 * belong to their parent's.
 */
export function trackToolRuns(runs: AymeRuns) {
  const reported = new Set<string>();
  return runs.subscribe((list) => {
    for (const run of list) {
      if (!run.by || run.status === "running" || reported.has(run.id)) continue;
      reported.add(run.id);
      track({
        event: "playground_tool_run",
        tool: run.tool,
        caller: run.by,
        status: run.status,
      });
    }
  });
}
