// The panel's Page Objects, as small as check-goal-mirror's tests need.
export class RunCard {
  async run(text: string) {
    return text;
  }
}

export class DetailPane {
  get card() {
    return new RunCard();
  }
}

export class Inspector {
  get detail() {
    return new DetailPane();
  }

  async tool(name: string) {
    return name;
  }

  async collapse() {}
}
