import { ayme } from "@ayme-dev/ayme";

@ayme
export class BasePage {
  @ayme.action
  save(): BasePage {
    return this;
  }

  @ayme.action
  refresh() {
    return this;
  }

  @ayme.action
  openOther(): OtherPage {
    return new OtherPage();
  }
}

@ayme
export class SettingsPage extends BasePage {}

@ayme
export class OtherPage {}
