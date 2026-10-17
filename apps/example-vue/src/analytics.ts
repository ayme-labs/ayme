/**
 * The playground's analytics events. On ayme.dev/playground/ the page loads
 * the landing's Google Tag Manager container, which reads them from
 * `dataLayer`; elsewhere nothing reads them.
 */
export type PlaygroundEvent =
  | { event: "playground_agent_panel_open" }
  | { event: "playground_agent_panel_step"; step: number; step_name: string }
  | { event: "playground_prompt_copy"; prompt: string }
  | { event: "playground_view_switch"; view: "app" | "code" };

declare global {
  interface Window {
    dataLayer?: object[];
  }
}

export function track(event: PlaygroundEvent) {
  (window.dataLayer ??= []).push(event);
}
