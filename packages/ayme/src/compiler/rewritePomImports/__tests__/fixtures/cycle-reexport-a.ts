import { ReexportB } from "./cycle-reexport-b";

export class ReexportA {
  openB() {
    return new ReexportB();
  }
}
