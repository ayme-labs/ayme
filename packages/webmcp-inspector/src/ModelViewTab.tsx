import type { RegisteredPomTool } from "@ayme-dev/webmcp";
import type { RegisteredPom } from "@ayme-dev/webmcp/internal";
import { Badge } from "@ayme-dev/design-system/components/badge";
import { Button } from "@ayme-dev/design-system/components/button";

import { Empty, Json, Section } from "./common";
import type { PageStateView } from "./useInspector";

export function ModelViewTab({
  pageState,
  refreshPageState,
  registeredPoms,
  activeTools,
}: {
  pageState: PageStateView;
  refreshPageState: () => void;
  registeredPoms: readonly RegisteredPom[];
  activeTools: ReadonlyMap<string, RegisteredPomTool>;
}) {
  const tools = registeredTools(registeredPoms);

  return (
    <div className="grid gap-4">
      <Section
        title="Structural page state"
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={pageState.loading}
            onClick={refreshPageState}
          >
            {pageState.loading ? "Refreshing…" : "Refresh"}
          </Button>
        }
      >
        {pageState.error ? (
          <p role="alert" className="text-xs text-destructive">
            {pageState.error}
          </p>
        ) : pageState.text !== undefined ? (
          <pre
            className="max-h-96 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap"
            data-page-state
          >
            {pageState.text}
          </pre>
        ) : (
          <Empty>
            {pageState.loading
              ? "Capturing page state…"
              : "Waiting for the first page-state capture."}
          </Empty>
        )}
        {pageState.capturedAt && (
          <p className="text-xs text-muted-foreground">
            Captured {pageState.capturedAt}
          </p>
        )}
      </Section>

      <Section title={`Registered tools (${tools.length})`}>
        {tools.length ? (
          <div className="grid gap-1">
            {tools.map((tool) => (
              <details
                key={tool.name}
                className="rounded-md border p-2"
                data-registered-tool={tool.name}
              >
                <summary className="flex cursor-pointer items-center justify-between gap-2">
                  <code className="font-mono text-xs break-all">
                    {tool.name}
                  </code>
                  <Badge
                    variant={
                      activeTools.has(tool.name) ? "secondary" : "outline"
                    }
                  >
                    {activeTools.has(tool.name) ? "available" : "unavailable"}
                  </Badge>
                </summary>
                <div className="mt-2 grid gap-2">
                  <p className="text-xs whitespace-pre-wrap text-muted-foreground">
                    {tool.description}
                  </p>
                  <Json value={tool.inputSchema} />
                </div>
              </details>
            ))}
          </div>
        ) : (
          <Empty>No tools are registered.</Empty>
        )}
      </Section>
    </div>
  );
}

/** Every registered POM tool once by name, whether callable now or not. */
function registeredTools(registeredPoms: readonly RegisteredPom[]) {
  const tools = new Map<string, RegisteredPomTool>();
  for (const registration of registeredPoms) {
    for (const tool of registration.tools) {
      if (!tools.has(tool.name)) tools.set(tool.name, tool);
    }
  }
  return [...tools.values()];
}
