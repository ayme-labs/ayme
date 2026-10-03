import { ayme } from "@ayme-dev/ayme";

@ayme
export class BarePom {
  @ayme.action
  open() {}

  @ayme.action()
  close() {}
}

@ayme({ description: "A page that saves a name." })
export class DescribedPom {
  @ayme.action({ description: "Save the name." })
  save(name: string) {
    void name;
  }
}
