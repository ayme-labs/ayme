// The Inspector an Agent App shows in its chat (MCP Apps), as `ayme mcp`
// hands it over: one page that holds the Inspector's script and the socket
// of the Session's Inspector window it connects to (ADR-0072).
import { readFile } from "node:fs/promises";

import { askSession } from "./commands";
import { escapeHtml, inspectorDocument } from "./inspectorDocument";
import { nameOf, type SessionPlace } from "./record";

/**
 * The id of the element that names the socket of the page an Agent App
 * shows, as JSON `{ "socket": url }`: the page's own address is the Agent
 * App's. The Inspector's external build reads it.
 */
const AGENT_APP_CONFIG_ID = "ayme-inspector-app";

/** The page an Agent App shows, and the origins it lets the page reach. */
export type AgentAppPage = {
  readonly html: string;
  readonly connectDomains: readonly string[];
};

/** What the page says when it cannot show the Inspector, and connects
 * nowhere. */
const notice = (name: string, why: string): AgentAppPage => ({
  html: inspectorDocument(
    name,
    `<p role="status" style="margin:0;padding:16px;font:14px system-ui,sans-serif;color-scheme:light dark">${escapeHtml(why)} Then ask your agent to show the Inspector again.</p>`
  ),
  connectDomains: [],
});

/**
 * Script text that stays inside its `<script>` element: the HTML parser
 * would end the element at `</script` and change how it reads after `<!--`.
 * Both are escaped as JavaScript and JSON read them the same, in a string,
 * a template, a regular expression or a comment.
 */
const inline = (script: string) =>
  script.replace(/<(\/script|!--)/gi, "\\u003C$1");

/**
 * The page an Agent App shows for `place`'s Session: the Inspector's built
 * `script` inside it, since an Agent App loads no script from elsewhere,
 * and the socket of the Session's window, which it may reach. Asked each
 * time the Agent App reads the page, so it follows a Session started
 * since. Without that Session, it says why.
 */
export async function agentAppPage(
  place: SessionPlace,
  script: string
): Promise<AgentAppPage> {
  const name = nameOf(place);
  const answer = await askSession(place, { inspector: { agentApp: {} } });
  if (!answer.ok) return notice(name, answer.text);
  const { socket } = answer.data as { readonly socket: string };
  let build: string;
  try {
    build = await readFile(script, "utf8");
  } catch (error) {
    return notice(
      name,
      `The Inspector's script could not be read: ${error instanceof Error ? error.message : String(error)}.`
    );
  }
  const config = JSON.stringify({ socket });
  return {
    html: inspectorDocument(
      name,
      `<script type="application/json" id="${AGENT_APP_CONFIG_ID}">${inline(config)}</script>
    <script type="module">${inline(build)}</script>`
    ),
    connectDomains: [new URL(socket).origin],
  };
}
