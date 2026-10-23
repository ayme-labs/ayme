import { ayme } from "@ayme-dev/ayme";

@ayme({ description: `A page that ` + ("saves " + "a name.") })
export class ConstantDescriptionsPom {
  @ayme.action({
    description: "Save the name, " + "then show it.",
  })
  save(name: string) {
    void name;
  }

  @ayme.action({ description: `Clear the name.` })
  clear() {}

  // prettier-ignore
  @ayme.action({ "description": ("Undo " as const) + "the last change."! })
  undo() {}

  @ayme.action({
    ...{ available: () => true },
    description: "Redo." satisfies string,
  })
  redo() {}
}
