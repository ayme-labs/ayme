import { ayme } from "@ayme-dev/ayme";

type ArchiveOptions = {
  reason: "obsolete" | "duplicate";
  notification?: {
    channel: "email" | "in-app";
    includeLink?: boolean;
  };
};

@ayme
export class ObjectInputPom {
  @ayme.action({
    description: "Archive with structured options.",
  })
  async archive(options: ArchiveOptions) {
    return options;
  }
}
