import type { AgentConnection } from "../../connection";

/**
 * Remembers every tool name `connection` has offered, so a call to a tool
 * that went can say it is gone rather than unknown. The connection lives as
 * long as the server, so this never unsubscribes.
 */
export function rememberOfferedNames(
  connection: AgentConnection
): (name: string) => boolean {
  const names = new Set<string>();
  const remember = () => {
    for (const tool of connection.tools) names.add(tool.name);
  };
  remember();
  connection.subscribe(remember);
  return (name) => names.has(name);
}
