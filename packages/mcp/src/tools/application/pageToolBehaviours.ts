import type { ClientBehaviour } from "../../connection";
import { errorText } from "../domain/toolResult";

/**
 * Reports the page's tools, with each one's availability and group, when
 * the channel opens and after every change.
 */
export const publishPageTools: ClientBehaviour = ({ tools, channel }) => {
  const publish = (list: ReturnType<typeof tools.list>) =>
    void channel
      .publishTools(
        list.map(
          ({
            name,
            description,
            inputSchema,
            destructive,
            available,
            reason,
            group,
          }) => ({
            name,
            description,
            inputSchema,
            ...(destructive ? { destructive: true } : {}),
            available,
            reason,
            group,
          })
        )
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
