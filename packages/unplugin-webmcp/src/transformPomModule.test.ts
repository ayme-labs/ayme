import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

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
  const fixture = (name: string) => {
    const fixturePath = fileURLToPath(
      new URL(`./fixtures/crossFile/${name}.ts`, import.meta.url)
    );
    return { fixturePath, source: readFileSync(fixturePath, "utf8") };
  };

  it("registers it when it imports a decorated base directly", () => {
    const { fixturePath, source } = fixture("userMenu");
    expect(source).not.toContain("@WebMCP");
    createPomProgram.mockClear();

    const result = createPomTransform()(source, fixturePath);

    expect(result).not.toBeNull();
    expect(createPomProgram).toHaveBeenCalledTimes(1);
    expect(result?.code).toContain("registerCompiledPom(UserMenu, {");
    expect(result?.code).toContain('"memberName":"signOutItem"');
    expect(result?.code).toContain('"toolName":"UserMenu.open"');
  });

  it("registers it when it imports a decorated base through a barrel", () => {
    const { fixturePath, source } = fixture("barrelUserMenu");
    expect(source).not.toContain("@WebMCP");

    const result = createPomTransform()(source, fixturePath);

    expect(result).not.toBeNull();
    expect(result?.code).toContain("registerCompiledPom(BarrelUserMenu, {");
    expect(result?.code).toContain('"toolName":"BarrelUserMenu.open"');
  });

  it("builds no program when its import closure has no decorated module", () => {
    const { fixturePath, source } = fixture("plainSubclass");
    createPomProgram.mockClear();

    expect(createPomTransform()(source, fixturePath)).toBeNull();
    expect(createPomProgram).not.toHaveBeenCalled();
  });

  describe("tsconfig", () => {
    let root: string | undefined;
    afterEach(() => {
      if (root) rmSync(root, { recursive: true, force: true });
      root = undefined;
    });
    const writeProject = (tsconfig?: string) => {
      root = mkdtempSync(join(tmpdir(), "ayme-gate-"));
      if (tsconfig) writeFileSync(join(root, "tsconfig.json"), tsconfig);
      writeFileSync(join(root, "base.ts"), "export class Base {}\n");
      const subclass = join(root, "sub.ts");
      const source =
        'import { Base } from "./base";\nexport class Sub extends Base {}\n';
      writeFileSync(subclass, source);
      return () => createPomTransform()(source, subclass);
    };

    it("returns a subclass untouched when no tsconfig is found", () => {
      expect(writeProject()()).toBeNull();
    });

    it("reports a malformed tsconfig instead of skipping the subclass", () => {
      const transform = writeProject(
        JSON.stringify({ compilerOptions: { moduleResolution: "unknown" } })
      );
      expect(transform).toThrow("Could not read TypeScript project");
    });
  });
});
