import { Component, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { injectAyme } from "@ayme-dev/angular";
import { Counter } from "./counter";

@Component({
  selector: "app-demo",
  imports: [Counter, RouterLink],
  template: `
    <p role="status" aria-label="Publication">
      Publication: {{ webMCP.publicationStatus().state }}
    </p>
    <button (click)="webMCP.retryPublication()">Retry publication</button>
    <button (click)="visible.set(!visible())">
      {{ visible() ? "Unmount counter" : "Mount counter" }}
    </button>
    <a routerLink="/other">Other</a>
    <!-- A plain anchor: the browser loads /other as a new document. -->
    <a href="/other">Full page load</a>
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
  template: `
    <p>Other page without Page Objects.</p>
    <a routerLink="/">Home</a>
  `,
})
export class Other {}
