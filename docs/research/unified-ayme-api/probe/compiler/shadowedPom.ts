// A local named ayme that is not the import, as `const { ayme } = useAyme()`
// would create in a module that also declares a Page Object Model.
const ayme = Object.assign((..._args: unknown[]) => undefined, {
  action: (..._args: unknown[]) => undefined,
});

@ayme
export class ShadowedPom {
  @ayme.action
  open() {}
}
