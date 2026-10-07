import { expectTypeOf, it } from "vitest";
import type { ActionResult } from "./actionSequence";
import type { Handover } from "./goalLoop";
import type { PageContextPayload } from "./pageContext";
import type { Ayme } from "./runtime";
import type { BuiltInCaller, Caller, CustomToolContext } from "./index";

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

it("takes any Caller name as by, keeping the built-in names for suggestions", () => {
  void run("click", { target: "e1" }, { by: "inspector" });
  void run("click", { target: "e1" }, { by: "support-assistant" });
  void run("TodoPage.addTodo", { title: "Milk" }, {});
  // @ts-expect-error a Caller name is a string.
  void run("click", { target: "e1" }, { by: 1 });
  expectTypeOf<BuiltInCaller>().toEqualTypeOf<
    "app" | "webmcp" | "ayme-mcp" | "inspector"
  >();
  // The literals survive beside any other string, so editors offer them.
  expectTypeOf<Extract<Caller, BuiltInCaller>>().toEqualTypeOf<
    "app" | "webmcp" | "ayme-mcp" | "inspector"
  >();
  expectTypeOf<string>().toExtend<Caller>();
});

it("types a Custom Tool's run as ayme.tools.run, without a Caller", () => {
  const run = (() => Promise.resolve()) as unknown as CustomToolContext["run"];
  expectTypeOf(run("click", { target: "e1" })).toEqualTypeOf<
    Promise<ActionResult>
  >();
  expectTypeOf(run("TodoPage.addTodo", { title: "Milk" })).toEqualTypeOf<
    Promise<unknown>
  >();
  // @ts-expect-error fill requires its text.
  void run("fill", { target: "e1" });
  // @ts-expect-error a child Run has its parent, not a Caller.
  void run("click", { target: "e1" }, { by: "app" });
});
