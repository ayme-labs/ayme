import type { ClientBehaviour } from "../../connection";
import { errorText } from "../domain/toolResult";

/** Reports the page's tools when the channel opens and after every change. */
export const publishPageTools: ClientBehaviour = ({ tools, channel }) => {
  const publish = (list: Parameters<typeof channel.publishTools>[0]) =>
    void channel
      .publishTools(
        list.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        }))
      )
      // The channel closed; the next channel publishes again.
      .catch(() => {});
  publish(tools.list());
  return tools.subscribe(publish);
};

/** Runs every call the server sends through `ayme.tools` and answers it. */
export const answerToolCalls: ClientBehaviour = ({ tools, channel }) =>
  channel.answerCalls(async ({ callId, name, input }) => {
    try {
      return { callId, ok: true, result: await tools.run(name, input) };
    } catch (error) {
      return { callId, ok: false, error: errorText(error) };
    }
  });
