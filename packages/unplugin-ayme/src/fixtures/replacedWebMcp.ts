// The decorators `ayme` replaced, for fixtures that check the build rejects them.
export const WebMCP = Object.assign(
  (value: unknown, context: ClassDecoratorContext) => {
    void value;
    void context;
  },
  {
    tool: (options: { description: string }) => {
      void options;
      return (value: unknown, context: ClassMethodDecoratorContext) => {
        void value;
        void context;
      };
    },
  }
);
