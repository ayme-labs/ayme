export declare const fastLaneExcludes: readonly string[];

/** Generic, so a package's config keeps its own Vite and Vitest types. */
export declare function defineFastLaneConfig<TConfig extends object>(
  baseConfig: TConfig,
  options?: { exclude?: string[] }
): TConfig;
