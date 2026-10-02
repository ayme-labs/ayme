import { WebMCP } from "@ayme-dev/ayme";

type ArchiveOptions = {
  reason: "obsolete" | "duplicate";
  notification?: {
    channel: "email" | "in-app";
    includeLink?: boolean;
  };
};

@WebMCP
export class ObjectInputPom {
  @WebMCP.tool({
    description: "Archive with structured options.",
  })
  async archive(options: ArchiveOptions) {
    return options;
  }
}
