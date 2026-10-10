import type { ClientBehaviour } from "../../connection";
import { ImageResultSchema } from "../../contract";
import { errorText } from "../domain/toolResult";

/**
 * Reports the page's tools, with each one's availability, when the channel
 * opens and after every change.
 */
export const publishPageTools: ClientBehaviour = ({ tools, channel }) => {
  const publish = (list: ReturnType<typeof tools.list>) =>
    void channel
      .publishTools(
        list.map(({ name, description, inputSchema, available, reason }) => ({
          name,
          description,
          inputSchema,
          available,
          reason,
        }))
      )
      // The channel closed; the next channel publishes again.
      .catch(() => {});
  publish(tools.list());
  return tools.subscribe(publish);
};

/**
 * Runs every call the server sends through `ayme.tools` and answers it. A
 * call whose result is an image is recorded with `recordAgentImage`, with
 * the file the server saves it to.
 */
export const answerToolCalls: ClientBehaviour = ({
  tools,
  channel,
  recordAgentImage,
}) =>
  channel.answerCalls(async ({ callId, name, input }) => {
    const startedAt = Date.now();
    let result: unknown;
    try {
      result = await tools.run(name, input);
    } catch (error) {
      return { callId, ok: false, error: errorText(error) };
    }
    const image = ImageResultSchema.safeParse(result);
    if (image.success && recordAgentImage) {
      const folder = channel.imageFolder;
      recordAgentImage({
        name,
        input,
        result: image.data,
        savedTo:
          folder === undefined ? undefined : folder + image.data.filename,
        startedAt,
        durationMs: Date.now() - startedAt,
      });
    }
    return { callId, ok: true, result };
  });
