import { Routes } from "@angular/router";
import { Demo, Other } from "./demo";

export const routes: Routes = [
  { path: "", component: Demo },
  { path: "other", component: Other },
];
