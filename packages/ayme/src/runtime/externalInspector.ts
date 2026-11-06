import type { InspectorPort } from "@ayme-dev/mcp/client";

import type { InspectorContract } from "../shared";
import {
  createDocumentInspectorContract,
  type DocumentRuntime,
} from "./documentInspectorContract";
import { inspectorChannelPort } from "./inspectorChannelPort";

let served: InspectorContract | undefined;

/**
 * The document's Inspector contract as the Agent Connection relays it to an
 * Inspector outside the page. Loaded only by a session whose `inspector`
 * option has the external placement (the runtime imports it on demand),
 * so a session without it carries none of this.
 */
export function externalInspectorPort(runtime: DocumentRuntime): InspectorPort {
  return inspectorChannelPort(
    (served ??= createDocumentInspectorContract(runtime))
  );
}
