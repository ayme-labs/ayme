import { StructuralActionIdSchema } from "./StructuralAction";

export class StructuralActionIdFactory {
  private _next = 1;

  create() {
    return StructuralActionIdSchema.parse(`interaction_${this._next++}`);
  }

  reset(): void {
    this._next = 1;
  }
}
