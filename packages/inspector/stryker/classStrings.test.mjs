import { Instrumenter } from "@stryker-mutator/instrumenter";
import { describe, expect, it } from "vitest";

import { strykerPlugins } from "./classStrings.mjs";

const { value: classStrings } = strykerPlugins[0];

const quietLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  isDebugEnabled: () => false,
};

/** What Stryker would mutate in `source`, and whether the rule skips it. */
async function mutantsOf(source) {
  const { mutants } = await new Instrumenter(quietLogger).instrument(
    [{ name: "Example.tsx", mutate: true, content: source }],
    { plugins: null, excludedMutations: [], ignorers: [classStrings] }
  );
  const lines = source.split("\n");
  return mutants.map(({ location, mutatorName, status }) => ({
    mutator: mutatorName,
    text:
      location.start.line === location.end.line
        ? lines[location.start.line].slice(
            location.start.column,
            location.end.column
          )
        : undefined,
    ignored: status === "Ignored",
  }));
}

const skipped = (mutants) =>
  mutants.filter((mutant) => mutant.ignored).map((mutant) => mutant.text);

describe("classStrings", () => {
  it("skips a class string in className", async () => {
    const mutants = await mutantsOf(
      `export const A = ({ on }) => <div className={on ? "flex gap-2" : "p-1 text-xs"} />;`
    );

    expect(skipped(mutants)).toEqual(['"flex gap-2"', '"p-1 text-xs"']);
  });

  it("skips a class string in cn(...)", async () => {
    const mutants = await mutantsOf(
      `export const A = () => <div className={cn("flex", "gap-2", extra)} />;`
    );

    expect(skipped(mutants)).toEqual(['"flex"', '"gap-2"']);
  });

  it("skips a class string a same-file constant or lookup table carries to cn(...)", async () => {
    const mutants = await mutantsOf(`
      const base = "flex";
      const grip = \`\${base} cursor-ew-resize\`;
      const tones = { off: "text-muted", on: "text-foreground" };
      export const A = ({ tone }) => (
        <div className={cn(grip, tones[tone])} />
      );
    `);

    expect(skipped(mutants)).toEqual([
      '"flex"',
      "`${base} cursor-ew-resize`",
      '"text-muted"',
      '"text-foreground"',
    ]);
  });

  it("skips the class string inside a condition without skipping the condition", async () => {
    const mutants = await mutantsOf(
      `export const A = ({ open }) => <div className={cn(open && "rotate-90")} />;`
    );

    expect(skipped(mutants)).toEqual(['"rotate-90"']);
    expect(
      mutants
        .filter(
          (mutant) => !mutant.ignored && mutant.text === 'open && "rotate-90"'
        )
        .map((mutant) => mutant.mutator)
    ).toEqual([
      "ConditionalExpression",
      "ConditionalExpression",
      "LogicalOperator",
    ]);
  });

  it("skips class words that reach no className but look like Tailwind", async () => {
    const mutants = await mutantsOf(`
      export const chip = "inline-flex h-6 hover:bg-muted";
      export const press = "active:bg-[color-mix(in_oklab,var(--muted),var(--foreground)_8%)]";
    `);

    expect(skipped(mutants)).toEqual([
      '"inline-flex h-6 hover:bg-muted"',
      '"active:bg-[color-mix(in_oklab,var(--muted),var(--foreground)_8%)]"',
    ]);
  });

  it("does not skip text that merely has digits or a colon", async () => {
    const mutants = await mutantsOf(`
      export const count = "1 child";
      export const state = "agentConnection: true";
      export const key = "ayme-inspector:view";
      export const two = "step 2 done";
    `);

    expect(skipped(mutants)).toEqual([]);
    expect(mutants).toHaveLength(4);
  });

  it("does not skip an aria-label, a title or what a class condition compares", async () => {
    const mutants = await mutantsOf(`
      export const A = ({ copied, tone }) => (
        <button
          aria-label={\`Copy \${tone}\`}
          title={copied ? "Copied" : "Copy"}
          className={cn("flex gap-2", tone === "off" && "text-muted")}
        />
      );
    `);

    expect(skipped(mutants)).toEqual(['"flex gap-2"', '"text-muted"']);
    expect(
      mutants.filter((mutant) => !mutant.ignored).map((mutant) => mutant.text)
    ).toEqual(
      expect.arrayContaining(["`Copy ${tone}`", '"Copied"', '"Copy"', '"off"'])
    );
  });

  it("does not skip a template literal with a condition in it", async () => {
    const mutants = await mutantsOf(
      `export const A = ({ on }) => <div className={\`flex \${on ? "gap-2" : ""} p-1\`} />;`
    );

    const whole = mutants.find(
      (mutant) => mutant.text === '`flex ${on ? "gap-2" : ""} p-1`'
    );
    expect(whole).toMatchObject({ mutator: "StringLiteral", ignored: false });
  });
});
