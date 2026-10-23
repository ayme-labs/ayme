import { ayme } from "@ayme-dev/ayme";

const KINDS = ["complete", "partial"];

@ayme
export class TemplateActionPom {
  @ayme.action({
    description: `Show one of ${KINDS.join(", ")}.`,
  })
  show(kind: string) {
    void kind;
  }
}
