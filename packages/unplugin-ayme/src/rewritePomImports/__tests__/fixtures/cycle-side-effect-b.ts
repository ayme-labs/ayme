import { sideEffectA } from "./cycle-side-effect-a";

export const sideEffectB = sideEffectA;
