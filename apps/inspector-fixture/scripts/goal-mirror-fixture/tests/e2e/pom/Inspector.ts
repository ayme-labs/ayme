// The panel's Page Objects, as small as check-goal-mirror's tests need.
export class RunCard {
  async run(text: string) {
    return text;
  }
}

export class Inspector {
  readonly title = { hover: async () => {} };

  async tool(name: string) {
    return name ? new RunCard() : new RunCard();
  }

  async collapse() {}
}
