import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

const { createPomProgram } = vi.hoisted(() => ({
  createPomProgram: vi.fn(),
}));

vi.mock("./pomProgram", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pomProgram")>();
  createPomProgram.mockImplementation(actual.createPomProgram);
  return { ...actual, createPomProgram };
});

import { createPomTransform } from "./transformPomModule";

it("builds one TypeScript program per POM transform", () => {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/annotatedChildrenPom.ts", import.meta.url)
  );
  const source = readFileSync(fixturePath, "utf8");
  const transform = createPomTransform();

  expect(transform(source, fixturePath)).not.toBeNull();
  expect(createPomProgram).toHaveBeenCalledTimes(1);

  expect(transform(source, fixturePath)).not.toBeNull();
  expect(createPomProgram).toHaveBeenCalledTimes(2);
});

it("registers an undecorated subclass of a decorated base", () => {
  const fixturePath = fileURLToPath(
    new URL("./fixtures/decoratedBasePom.ts", import.meta.url)
  );
  const code = createPomTransform()(
    readFileSync(fixturePath, "utf8"),
    fixturePath
  )?.code;

  expect(code).toContain("registerCompiledPom(BaseMenu, {");
  expect(code).toContain("registerCompiledPom(UserMenu, {");
});

describe("a subclass in a module without the decorator", () => {
  const transformFixture = (fixture: string) => {
    const fixturePath = fileURLToPath(
      new URL(`./fixtures/crossFile/${fixture}.ts`, import.meta.url)
    );
    const source = readFileSync(fixturePath, "utf8");
    expect(source).not.toContain("@WebMCP");
    return createPomTransform()(source, fixturePath);
  };

  it("registers it when it imports a decorated base directly", () => {
    const code = transformFixture("userMenu")?.code;

    expect(code).toContain("registerCompiledPom(UserMenu, {");
    expect(code).toContain('"memberName":"signOutItem"');
    expect(code).toContain('"toolName":"UserMenu.open"');
    expect(code).not.toContain("registerCompiledPom(BaseMenu");
  });

  it("registers it when it imports a decorated base through a barrel", () => {
    const code = transformFixture("barrelUserMenu")?.code;

    expect(code).toContain("registerCompiledPom(BarrelUserMenu, {");
    expect(code).toContain('"toolName":"BarrelUserMenu.open"');
  });

  it("builds no program when its import closure has no decorated module", () => {
    createPomProgram.mockClear();

    expect(transformFixture("plainSubclass")).toBeNull();
    expect(createPomProgram).not.toHaveBeenCalled();
  });
});
