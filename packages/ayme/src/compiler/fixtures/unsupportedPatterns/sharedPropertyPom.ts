import { ayme } from "@ayme-dev/ayme";

@ayme
export class SharedPropertyPom {
  @ayme.action({ description: "Share a property between two patterns." })
  copy({ id }: { id: string }, [id2]: [string], { id: other }: { id: string }) {
    return [id, id2, other];
  }
}
