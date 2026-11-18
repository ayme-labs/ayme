import { ayme } from "@ayme-dev/ayme";

@ayme
export class DestructiveActionsPom {
  @ayme.action({ description: "Submit the order.", destructive: true })
  submit() {}

  @ayme.action({ destructive: true as const })
  remove() {}

  @ayme.action({ destructive: false })
  preview() {}

  @ayme.action({ description: "Edit the order." })
  edit() {}

  @ayme.action
  close() {}
}

@ayme
export class InheritedDestructivePom extends DestructiveActionsPom {}
