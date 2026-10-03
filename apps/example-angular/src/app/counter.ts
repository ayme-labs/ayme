import { Component, signal } from "@angular/core";
import { injectPageObject } from "@ayme-dev/angular";
import { CounterPage } from "../../playwright/pom/CounterPage";
import { SubCounterPage } from "../../playwright/pom/SubCounterPage";

@Component({
  selector: "app-counter",
  template: `
    <section aria-label="Counter">
      <p>
        Count: <output>{{ count() }}</output>
      </p>
      <button (click)="count.set(count() + 1)">Increment</button>
      <button (click)="pom.increment()">Call Page Object</button>
    </section>
  `,
})
export class Counter {
  protected readonly count = signal(0);
  protected readonly pom = injectPageObject(CounterPage);
  // Publishes the inherited tools of an undecorated subclass.
  protected readonly subPom = injectPageObject(SubCounterPage);
}
