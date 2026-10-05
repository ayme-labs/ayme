import type { ReactNode } from "react";

/** The WebMCP publication status, as the runtime reports it. */
export type PublicationStatus = Readonly<{
  state:
    "disabled" | "waiting" | "active" | "unavailable" | "failed" | "disposed";
  message: string;
}>;

const code = (text: string) => (
  <code className="rounded bg-muted px-1 font-mono text-xs">{text}</code>
);

/** Why agents can't call the tools, and how to fix it where that applies. */
const explanations: Record<
  Exclude<PublicationStatus["state"], "active">,
  (message: string) => ReactNode
> = {
  disabled: () => (
    <>
      WebMCP publishing is off, so agents can't call these tools. Set{" "}
      {code("webMCP: { enabled: true }")} where the app starts Ayme.
    </>
  ),
  waiting: () => (
    <>Waiting for WebMCP: agents can call these tools once it's ready.</>
  ),
  unavailable: () => (
    <>
      This browser has no WebMCP, so agents can't call these tools. Load the
      WebMCP polyfill, or turn on the browser's WebMCP flag.
    </>
  ),
  failed: (message) => <>WebMCP publishing failed: {message}</>,
  disposed: () => (
    <>No Ayme runtime session is running, so nothing is published.</>
  ),
};

/**
 * One quiet line under the header saying why agents can't call the panel's
 * tools, and how to fix it. Hidden while WebMCP publication is active.
 */
export function WebMcpStatus({ status }: { status: PublicationStatus }) {
  if (status.state === "active") return null;
  const explanation = explanations[status.state](status.message);
  return (
    <p
      role="status"
      aria-label="WebMCP publication"
      title={textOf(explanation)}
      className="flex-none truncate border-b bg-background px-3.5 glass:bg-transparent py-1.5 text-xs text-muted-foreground"
    >
      {explanation}
    </p>
  );
}

/** The plain text of an explanation, for its tooltip. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node)
    return textOf((node.props as { children?: ReactNode }).children);
  return "";
}
