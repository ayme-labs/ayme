import { ayme } from "@ayme-dev/ayme";

const DESCRIPTION = "Save the name.";

@ayme
export class QuotedKeyPom {
  // prettier-ignore
  @ayme.action({ "description": DESCRIPTION })
  save() {}
}
