import type { PageObjectConstructor } from "@ayme-dev/ayme/internal";
import type { UseAymeOptions, UseAymeResult } from "../index";

/** A test component, compiled with the Svelte 4 component API. */
type TestComponent<Props> = {
  new (options: { target: Element; props?: Props }): {
    $set(props: Partial<Props>): void;
    $destroy(): void;
  };
  render(props?: Props): { html: string };
};

type ChildProps = Record<string, unknown>;

export declare const Owner: TestComponent<{
  options?: UseAymeOptions;
  onInit?: (result: UseAymeResult) => void;
  child?: unknown;
  childProps?: ChildProps;
  shown?: boolean;
}>;
export declare const Consumer: TestComponent<{
  options?: UseAymeOptions;
  onInit?: (result: UseAymeResult) => void;
  onMounted?: (result: UseAymeResult) => void;
}>;
export declare const PageObjectUser: TestComponent<{
  model: PageObjectConstructor<object>;
  onInit?: (pageObject: object) => void;
}>;
export declare const PageObjectPair: TestComponent<{
  model: PageObjectConstructor<object>;
  showFirst?: boolean;
  showSecond?: boolean;
  onInit?: (pageObject: object) => void;
}>;
export declare const OwnerAndPageObject: TestComponent<{
  options?: UseAymeOptions;
  model: PageObjectConstructor<object>;
  onInit?: (result: UseAymeResult & { pageObject: object }) => void;
}>;
export declare const PeekUser: TestComponent<{
  count?: number;
  id?: string;
}>;
export declare const PeekUsers: TestComponent<{ counts?: number[] }>;
export declare const Status: TestComponent<Record<string, never>>;
