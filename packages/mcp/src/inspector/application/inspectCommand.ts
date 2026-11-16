import {
  INSPECTOR_INSTALL_HINT,
  inspectorUrl,
} from "../domain/externalInspector";

/**
 * What `ayme inspect` prints: the URL of the external Inspector of each
 * running Ayme MCP server, one per line, or why there is none: the
 * Inspector's optional package is not installed, or no server runs.
 * `servers` finds the running servers' WebSocket addresses.
 */
export async function inspectCommand({
  installed,
  servers,
}: {
  installed(): Promise<boolean>;
  servers(): Promise<readonly string[]>;
}): Promise<{ ok: boolean; text: string }> {
  if (!(await installed()))
    return { ok: false, text: `${INSPECTOR_INSTALL_HINT}\n` };
  const addresses = await servers();
  if (addresses.length === 0)
    return {
      ok: false,
      text: "No Ayme MCP server is running. Start your coding agent, which runs `ayme mcp`, and try again.\n",
    };
  return {
    ok: true,
    text: addresses
      .map((address) => {
        const { hostname, port } = new URL(address);
        return `${inspectorUrl(hostname, Number(port))}\n`;
      })
      .join(""),
  };
}
