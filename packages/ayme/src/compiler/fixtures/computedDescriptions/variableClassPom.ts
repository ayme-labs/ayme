import { ayme } from "@ayme-dev/ayme";

const DESCRIPTION = "A page that saves a name.";

@ayme({ description: DESCRIPTION })
export class VariableClassPom {
  @ayme.action
  save() {}
}
