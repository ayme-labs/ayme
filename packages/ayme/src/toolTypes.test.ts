import { expectTypeOf, it } from "vitest";
import type { ActionResult } from "./actionSequence";
import type { Handover } from "./goalLoop";
import type { PageContextPayload } from "./pageContext";
import type { Ayme } from "./runtime";

// Type checks only: the calls never run.
const run = (() => Promise.resolve()) as unknown as Ayme["tools"]["run"];

it("checks built-in tool inputs and results by name", () => {
  expectTypeOf(run("click", { target: "e1" })).toEqualTypeOf<
    Promise<ActionResult>
  >();
  expectTypeOf(run("fill", { target: "e1", text: "Milk" })).toEqualTypeOf<
    Promise<ActionResult>
  >();
  expectTypeOf(run("snapshot", {})).toEqualTypeOf<
    Promise<PageContextPayload>
  >();
  expectTypeOf(run("goal", { goal: "Save", maxSteps: 3 })).toEqualTypeOf<
    Promise<Handover>
  >();
  // @ts-expect-error fill requires its text.
  void run("fill", { target: "e1" });
  expectTypeOf(
    run("goal", {
      goal: "Add an item called Milk",
      maxSteps: 3,
      values: { "item name": "Milk", quantity: 2 },
    })
  ).toEqualTypeOf<Promise<Handover>>();
  // @ts-expect-error a Goal Value is a string or a number, not a boolean.
  void run("goal", { goal: "Save", maxSteps: 3, values: { confirm: true } });
  // @ts-expect-error goal requires maxSteps.
  void run("goal", { goal: "Save" });
  // @ts-expect-error click takes a target, not a ref.
  void run("click", { ref: "e1" });
});

it("accepts any other name as (string, object) and resolves with unknown", () => {
  expectTypeOf(run("TodoPage.addTodo", { title: "Milk" })).toEqualTypeOf<
    Promise<unknown>
  >();
  const name: string = "click";
  expectTypeOf(run(name, { anything: true })).toEqualTypeOf<Promise<unknown>>();
  // @ts-expect-error the input is an object.
  void run("TodoPage.addTodo", "Milk");
});
