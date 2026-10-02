import { Component, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { injectAyme } from "../ayme-angular";
import { Counter } from "./counter";

@Component({
  selector: "app-demo",
  imports: [Counter, RouterLink],
  template: `
    <h1>Ayme Angular probe</h1>
    <p role="status" aria-label="Publication">
      Publication: {{ webMCP.publicationStatus().state }}
    </p>
    <button (click)="visible.set(!visible())">
      {{ visible() ? "Unmount counter" : "Mount counter" }}
    </button>
    <a routerLink="/other">Other page</a>
    @if (visible()) {
      <app-counter />
    }
  `,
})
export class Demo {
  protected readonly webMCP = injectAyme().webMCP;
  protected readonly visible = signal(true);
}

@Component({
  selector: "app-other",
  imports: [RouterLink],
  template: `<h1>Other</h1>
    <a routerLink="/">Home</a>`,
})
export class Other {}
