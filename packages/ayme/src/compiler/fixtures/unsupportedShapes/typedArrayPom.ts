import { ayme } from "@ayme-dev/ayme";

@ayme
export class TypedArrayPom {
  @ayme.action({ description: "Attach a file." })
  attach(name: string, contents: Uint8Array) {
    return `${name}: ${contents.length} bytes`;
  }
}
